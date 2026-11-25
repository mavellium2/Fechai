import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { dayKeyInZone } from "@/modules/scheduling/time";
import { CRM_TIME_ZONE } from "./board-filters";

/** Versão de leitura, sem dados dos contatos. */
export async function crmBoardVersion(tenantId: string) {
  const [leads, stage, change, message, origin, tags, leadTags, task] = await Promise.all([
    prisma.lead.aggregate({ where: { tenantId, isTest: false }, _max: { updatedAt: true }, _count: { _all: true } }),
    prisma.pipelineStage.findFirst({ where: { tenantId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, id: true } }),
    prisma.leadTransition.findFirst({ where: { tenantId, dimension: "stage" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }),
    prisma.message.aggregate({ where: { conversation: { tenantId, isTest: false } }, _max: { createdAt: true } }),
    prisma.leadAdOrigin.aggregate({ where: { tenantId }, _max: { createdAt: true } }),
    prisma.tag.aggregate({ where: { tenantId }, _max: { createdAt: true } }),
    prisma.leadTag.aggregate({ where: { tenantId }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.leadTask.aggregate({ where: { tenantId }, _max: { createdAt: true, completedAt: true } }),
  ]);
  return createHash("sha256").update(JSON.stringify([leads._count._all, leads._max.updatedAt, stage, change,
    message._max.createdAt, origin._max.createdAt, tags._max.createdAt, leadTags, task, dayKeyInZone(new Date(), CRM_TIME_ZONE)])).digest("hex");
}
