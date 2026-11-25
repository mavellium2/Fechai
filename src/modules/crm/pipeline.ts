import type { CrmStageKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DEFAULT_PIPELINE_KEY = "default";

const DENTAL_STAGES = [
  { kind: "new", name: "Novo lead", color: "#6B7280" },
  { kind: "ai", name: "Atendimento IA", color: "#4B3CF0" },
  { kind: "waiting_human", name: "Aguardando humano", color: "#F59E0B" },
  { kind: "human", name: "Em atendimento humano", color: "#2563EB" },
  { kind: "scheduled", name: "Agendado", color: "#0891B2" },
  { kind: "attended", name: "Compareceu", color: "#059669" },
  { kind: "won", name: "Fechado", color: "#1FC8A3" },
  { kind: "lost", name: "Perdido", color: "#DC2626" },
] satisfies { kind: CrmStageKind; name: string; color: string }[];

/** Provisiona o modelo sem sobrescrever edições já feitas pela conta. */
export function provisionDentalPipeline(tenantId: string) {
  return prisma.$transaction((db) => ensureDentalPipeline(db, tenantId), { isolationLevel: "ReadCommitted" });
}

export async function ensureDentalPipeline(db: Prisma.TransactionClient, tenantId: string) {
  await db.pipeline.createMany({
    data: { tenantId, key: DEFAULT_PIPELINE_KEY, name: "Pipeline odontológico", niche: "odontologia" },
    skipDuplicates: true,
  });
  const pipeline = await db.pipeline.findUniqueOrThrow({
    where: { tenantId_key: { tenantId, key: DEFAULT_PIPELINE_KEY } },
  });
  await db.pipelineStage.createMany({
    data: DENTAL_STAGES.map((stage, position) => ({ ...stage, tenantId, pipelineId: pipeline.id, position })),
    skipDuplicates: true,
  });
  return pipeline;
}
