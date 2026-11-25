import type { LeadTransitionSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockCrmAdmission } from "./admission";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";
import { crmLossOptions } from "./loss-reasons";
import { CRM_LOSS_NOTE_LIMIT } from "./limits";
import { recordCrmTrail } from "./trail";

type StageChange = {
  tenantId: string;
  leadId: string;
  stageId: string;
  source: LeadTransitionSource;
  userId?: string;
  reason?: string;
  lossReasonNote?: string;
  expectedStageId?: string;
};

type StageChangeResult = "moved" | "unchanged" | "not_found" | "conflict" | "loss_reason_required" | "loss_note_required";

export function eligibleCrmLead(tenantId: string, leadId: string): Prisma.LeadWhereInput {
  return {
    id: leadId, tenantId, isTest: false,
    OR: [{ conversation: { is: null } }, { conversation: { is: { tenantId, isTest: false } } }],
  };
}

/**
 * Serviço interno. O chamador resolve a autorização e as regras do movimento.
 * Movimento feito por uma pessoa vira um evento na trilha (CRM-11): o de perda
 * leva o motivo escolhido (nunca a justificativa, que é texto livre).
 */
export async function setLeadStage(change: StageChange): Promise<StageChangeResult> {
  const { status, moved } = await moveLead(change);
  if (status === "moved" && moved && change.source === "user" && change.userId) {
    const stages = await prisma.pipelineStage.findMany({
      where: { tenantId: change.tenantId, id: { in: [moved.fromStageId, change.stageId].filter((id): id is string => Boolean(id)) } },
      select: { id: true, name: true },
    }).catch(() => []);
    const name = (id: string | null) => stages.find((stage) => stage.id === id)?.name ?? null;
    await recordCrmTrail({
      tenantId: change.tenantId, leadId: change.leadId, actor: { kind: "user", userId: change.userId },
      event: moved.toKind === "lost" ? "crm.lost_reason_set" : "crm.stage_changed",
      meta: { fromStage: name(moved.fromStageId), toStage: name(change.stageId), ...(moved.lossLabel ? { lossReason: moved.lossLabel } : {}) },
    });
  }
  return status;
}

type Moved = { fromStageId: string | null; toKind: string | null; lossLabel?: string };

async function moveLead(change: StageChange): Promise<{ status: StageChangeResult; moved?: Moved }> {
  let moved: Moved | undefined;
  const status = await moveLeadInTransaction(change, (info) => { moved = info; });
  return { status, moved };
}

function moveLeadInTransaction(change: StageChange, onMoved: (info: Moved) => void): Promise<StageChangeResult> {
  const { tenantId, leadId, stageId, source, userId, reason, expectedStageId } = change;

  return prisma.$transaction(async (db) => {
    await lockCrmAdmission(db, tenantId, "shared");
    const eligibleLead = eligibleCrmLead(tenantId, leadId);
    const lead = await db.lead.findFirst({
      where: { ...eligibleLead, ...(expectedStageId ? { tenant: { status: "active", crmEnabled: true },
        stage: { archivedAt: null, pipeline: { key: DEFAULT_PIPELINE_KEY } } } : {}) },
      select: { stageId: true, updatedAt: true },
    });
    if (!lead) return "not_found";

    const stage = await db.pipelineStage.findFirst({
      where: { id: stageId, tenantId, archivedAt: null, ...(expectedStageId ? { pipeline: { key: DEFAULT_PIPELINE_KEY } } : {}) },
      select: { id: true, kind: true },
    });
    if (!stage) return "not_found";

    if (userId !== undefined) {
      const user = await db.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true },
      });
      if (!user) return "not_found";
    }
    if (expectedStageId) {
      if (lead.stageId === stageId) return "unchanged";
      if (lead.stageId !== expectedStageId) return "conflict";
    }
    if (source === "user" && stage.kind === "lost" && lead.stageId !== stageId) {
      const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { crmLossReasons: true } });
      const option = crmLossOptions(tenant.crmLossReasons).find(({ key }) => key === reason);
      if (!option) return "loss_reason_required";
      const note = change.lossReasonNote?.trim();
      if (!note || note.length > CRM_LOSS_NOTE_LIMIT || note.includes("\0")) return "loss_note_required";
      const written = await writeLeadStage(db, { ...change, lossReasonLabel: option.label, lossReasonNote: note }, lead);
      if (written === "moved") onMoved({ fromStageId: lead.stageId, toKind: stage.kind, lossLabel: option.label });
      return written;
    }
    const written = await writeLeadStage(db, { tenantId, leadId, stageId, source, userId, reason: stage.kind === "lost" || !expectedStageId ? reason : undefined }, lead);
    if (written === "moved") onMoved({ fromStageId: lead.stageId, toKind: stage.kind });
    return written;
  }, { isolationLevel: "ReadCommitted" });
}

export async function writeLeadStage(
  db: Prisma.TransactionClient, change: StageChange & { eventKey?: string; eventAt?: Date; lossReasonLabel?: string },
  lead: { stageId: string | null; updatedAt: Date },
): Promise<"moved" | "unchanged" | "conflict"> {
  const { tenantId, leadId, stageId, source, userId, reason, lossReasonLabel, lossReasonNote, eventKey, eventAt } = change;
  if (lead.stageId === stageId) return "unchanged";

  // O Bitrix usa Lead.updatedAt como cursor. A data do CRM mora no histórico.
  const result = await db.lead.updateMany({
    where: { ...eligibleCrmLead(tenantId, leadId), stageId: lead.stageId, updatedAt: lead.updatedAt },
    data: { stageId, updatedAt: lead.updatedAt },
  });
  if (result.count === 0) return "conflict";

  await db.leadTransition.create({
    data: { tenantId, leadId, dimension: "stage", source, fromStageId: lead.stageId, toStageId: stageId,
      userId, reason, lossReasonLabel, lossReasonNote, eventKey, eventAt, createdAt: new Date() },
  });
  return "moved";
}
