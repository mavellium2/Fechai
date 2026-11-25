import { createHash } from "node:crypto";
import type { CrmStageKind, LeadTransitionSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockCrmAdmission } from "./admission";
import { eligibleCrmLead, writeLeadStage } from "./lead-stage";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";

type EventStage = CrmStageKind | "booking_canceled";
type StageEvent = {
  reason: "agent_reply" | "handoff" | "human_assumed" | "human_reply" | "returned_to_ai" | "appointment_booked" | "appointment_attended"
    | "appointment_canceled" | "disqualified" | "declared_loss";
  key?: string;
  at?: Date;
  conversationId?: string;
  appointmentId?: string;
  userId?: string;
};

const order: Record<CrmStageKind, number> = {
  new: 0, ai: 1, waiting_human: 2, human: 3, scheduled: 4, attended: 5, won: 6, lost: 6,
};

function canAdvance(current: CrmStageKind | "custom" | null, target: CrmStageKind, source: LeadTransitionSource) {
  if (current === null) return true;
  if (current === "custom" || current === "won") return target === "scheduled" || (target === "waiting_human" && source !== "system");
  if (current === "lost") return target === "scheduled";
  return order[target] > order[current];
}

/** Efeito secundário do atendimento. Nunca impede a operação que originou o evento. */
export async function moveLeadToStage(
  tenantId: string, leadId: string | null, kind: EventStage, source: LeadTransitionSource, meta: StageEvent,
): Promise<"moved" | "ignored" | "failed"> {
  const eventAt = meta.at ?? new Date();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { crmEnabled: true, status: true } });
    if (!tenant?.crmEnabled || tenant.status !== "active") return "ignored";

    return await prisma.$transaction(async (db): Promise<"moved" | "ignored" | "failed"> => {
      await lockCrmAdmission(db, tenantId, "shared");
      const appointment = meta.appointmentId ? await db.appointment.findFirst({
        where: { id: meta.appointmentId, tenantId }, select: { leadId: true, conversationId: true },
      }) : null;
      if (meta.appointmentId && (!appointment?.leadId || (leadId && leadId !== appointment.leadId))) return "ignored";

      const conversationId = meta.conversationId ?? appointment?.conversationId;
      const conversation = conversationId ? await db.conversation.findFirst({
        where: { id: conversationId, tenantId, isTest: false }, select: { leadId: true },
      }) : null;
      const id = leadId ?? appointment?.leadId ?? conversation?.leadId;
      if (!id || (conversationId && conversation?.leadId !== id)) return "ignored";

      // Serializa o cálculo de origem/destino de eventos simultâneos para o mesmo lead.
      await db.$queryRaw`SELECT id FROM "Lead" WHERE "tenantId" = ${tenantId} AND id = ${id} FOR UPDATE`;
      if (meta.appointmentId) {
        const live = await db.appointment.findFirst({ where: { id: meta.appointmentId, tenantId, leadId: id },
          select: { status: true, attendance: true } });
        if (!live || !appointmentMatches(live, kind)) return "ignored";
      }
      const lead = await db.lead.findFirst({
        where: { ...eligibleCrmLead(tenantId, id), tenant: { crmEnabled: true, status: "active" } },
        select: { stageId: true, updatedAt: true, stage: { select: { kind: true } },
          conversation: { select: { agentPaused: true } } },
      });
      if (!lead) return "ignored";

      const current = lead.stage ? lead.stage.kind ?? "custom" : null;
      const target = kind === "booking_canceled"
        ? await canceledBookingDestination(db, tenantId, id, current, lead.conversation)
        : kind === "ai" && meta.reason === "returned_to_ai"
          // Única volta de etapa automática: a equipe devolveu o atendimento à IA.
          ? (current === "waiting_human" || current === "human" ? "ai" : null)
          : canAdvance(current, kind, source) ? kind : null;
      if (!target) return "ignored";

      const eventKey = meta.key ? createHash("sha256").update(JSON.stringify([id, meta.reason, meta.key])).digest("hex") : undefined;
      if (eventKey && await db.leadTransition.findUnique({ where: { tenantId_eventKey: { tenantId, eventKey } }, select: { id: true } })) return "ignored";
      const latest = await db.leadTransition.findFirst({ where: { tenantId, leadId: id, dimension: "stage", toStageId: lead.stageId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { eventAt: true, createdAt: true, reason: true } });
      // Preenchimento inicial e admissão são apenas pontos de partida da etapa.
      if (latest && latest.reason !== "initial_backfill" && latest.reason !== "lead_created"
        && eventAt < (latest.eventAt ?? latest.createdAt)) return "ignored";

      const stage = await db.pipelineStage.findFirst({ where: { tenantId, kind: target, archivedAt: null,
        pipeline: { key: DEFAULT_PIPELINE_KEY } }, select: { id: true } });
      if (!stage) return "ignored";
      const result = await writeLeadStage(db, { tenantId, leadId: id, stageId: stage.id, source, userId: meta.userId,
        reason: meta.reason, eventAt, eventKey }, lead);
      return result === "moved" ? "moved" : "ignored";
    }, { isolationLevel: "ReadCommitted", maxWait: 750, timeout: 2_000 });
  } catch {
    console.error("[crm] movimentação automática não registrada", meta.reason);
    return "failed";
  }
}

function appointmentMatches(appointment: { status: string; attendance: string }, kind: EventStage) {
  if (kind === "booking_canceled") return appointment.status === "canceled";
  if (appointment.status !== "scheduled") return false;
  return kind !== "attended" || appointment.attendance === "attended";
}

async function canceledBookingDestination(db: Prisma.TransactionClient, tenantId: string, leadId: string,
  current: CrmStageKind | "custom" | null, conversation: { agentPaused: boolean } | null) {
  if (current !== "scheduled") return null;
  const another = await db.appointment.findFirst({ where: { tenantId, leadId, status: "scheduled", startsAt: { gt: new Date() } }, select: { id: true } });
  if (another) return null;
  return conversation?.agentPaused ? "human" : "ai";
}
