import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockCrmAdmission } from "./admission";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(80);
export const stageEditSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("create"), name }),
  z.object({ intent: z.literal("rename"), stageId: id, name, previousName: z.string().max(200) }),
  z.object({ intent: z.literal("move"), stageId: id, neighborId: id, direction: z.enum(["up", "down"]) }),
  z.object({ intent: z.literal("archive"), stageId: id, destinationId: z.union([id, z.literal("")]) }),
]);

type StageEdit = z.infer<typeof stageEditSchema>;
type EditResult = "changed" | "unchanged" | "forbidden" | "stale" | "duplicate" | "system_stage" | "destination";
type CrmActor = { tenantId: string; userId: string };

export function editCrmStages(actor: CrmActor, edit: StageEdit): Promise<EditResult> {
  const { tenantId } = actor;

  return prisma.$transaction(async (db): Promise<EditResult> => {
    // A mesma trava protege a ativação, a entrada e a movimentação de leads.
    await lockCrmAdmission(db, tenantId, "exclusive");
    const pipeline = await db.pipeline.findUnique({
      where: { tenantId_key: { tenantId, key: DEFAULT_PIPELINE_KEY }, tenant: { crmEnabled: true, status: "active" } },
      select: { id: true },
    });
    if (!pipeline) return "forbidden";
    const scope = { tenantId, pipelineId: pipeline.id, archivedAt: null };
    const stages = await db.pipelineStage.findMany({
      where: scope,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, name: true, position: true },
    });

    if (edit.intent === "create" || edit.intent === "rename") {
      const normalized = edit.name.toLocaleLowerCase("pt-BR");
      const exists = stages.some((stage) => stage.id !== (edit.intent === "rename" ? edit.stageId : undefined)
        && stage.name.trim().toLocaleLowerCase("pt-BR") === normalized);
      if (exists) return "duplicate";
    }
    if (edit.intent === "create") {
      await db.pipelineStage.create({
        data: { tenantId, pipelineId: pipeline.id, name: edit.name, color: "#6B7280", position: (stages.at(-1)?.position ?? -1) + 1 },
      });
      return "changed";
    }

    const index = stages.findIndex((stage) => stage.id === edit.stageId);
    const stage = stages[index];
    if (!stage) return "stale";
    const stageKey = { tenantId_id: { tenantId, id: stage.id } };

    if (edit.intent === "rename") {
      if (stage.name === edit.name) return "unchanged";
      if (stage.name !== edit.previousName) return "stale";
      await db.pipelineStage.update({ where: stageKey, data: { name: edit.name } });
      return "changed";
    }
    if (edit.intent === "move") {
      const offset = edit.direction === "up" ? -1 : 1;
      const nextIndex = index + offset;
      if (stages[index - offset]?.id === edit.neighborId) return "unchanged";
      if (stages[nextIndex]?.id !== edit.neighborId) return "stale";

      [stages[index], stages[nextIndex]] = [stages[nextIndex], stage];
      for (const [position, current] of stages.entries()) {
        if (current.position === position) continue;
        await db.pipelineStage.update({ where: { tenantId_id: { tenantId, id: current.id } }, data: { position } });
      }
      return "changed";
    }

    if (stage.kind !== null) return "system_stage";
    const destination = stages.find((candidate) => candidate.id === edit.destinationId && candidate.id !== stage.id);
    if (edit.destinationId && (!destination || destination.kind === "lost")) return "destination";
    const leadScope = {
      tenantId, stageId: stage.id, isTest: false,
      OR: [{ conversation: { is: null } }, { conversation: { is: { tenantId, isTest: false } } }],
    } satisfies Prisma.LeadWhereInput;
    if (destination) {
      await migrateArchivedStageLeads(db, actor, stage.id, destination.id, leadScope);
    } else if (await db.lead.findFirst({ where: leadScope, select: { id: true } })) {
      return "destination";
    }

    await db.pipelineStage.update({ where: stageKey, data: { archivedAt: new Date() } });
    return "changed";
  }, { isolationLevel: "ReadCommitted", timeout: 30_000 });
}

async function migrateArchivedStageLeads(
  db: Prisma.TransactionClient, { tenantId, userId }: CrmActor, fromStageId: string, toStageId: string, where: Prisma.LeadWhereInput,
) {
  for (;;) {
    const leads = await db.lead.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: 500 });
    if (!leads.length) return;

    // O timestamp operacional é o cursor do Bitrix. A data do CRM fica no evento.
    const moved = await db.$queryRaw<{ id: string }[]>`
      UPDATE "Lead" SET "stageId" = ${toStageId}
      WHERE "tenantId" = ${tenantId} AND "stageId" = ${fromStageId} AND NOT "isTest"
        AND id = ANY(${leads.map(({ id }) => id)}::text[])
      RETURNING id
    `;
    await db.leadTransition.createMany({
      data: moved.map(({ id }) => ({
        tenantId, leadId: id, fromStageId, toStageId, userId, dimension: "stage", source: "user", reason: "stage_archived",
      })),
    });
  }
}
