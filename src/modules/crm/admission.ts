import type { Prisma } from "@prisma/client";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";

/** A chave de 64 bits é independente dos locks de dois inteiros por telefone. */
export async function lockCrmAdmission(db: Prisma.TransactionClient, tenantId: string, mode: "shared" | "exclusive") {
  if (mode === "shared") {
    await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${tenantId}, 312023))`;
  } else {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 312023))`;
  }
}

/** Chamar dentro da criação do lead, com o lock compartilhado da conta. */
export async function newLeadCrmFields(db: Prisma.TransactionClient, tenantId: string): Promise<Pick<Prisma.LeadUncheckedCreateInput, "stageId" | "transitions">> {
  const stage = await db.pipelineStage.findFirst({
    where: {
      tenantId,
      kind: "new",
      archivedAt: null,
      pipeline: {
        key: DEFAULT_PIPELINE_KEY,
        tenant: { OR: [{ crmEnabled: true }, { status: "active", crmActivationToken: { not: null } }] },
      },
    },
    select: { id: true },
  });
  if (!stage) return {};

  return {
    stageId: stage.id,
    transitions: { create: { dimension: "stage", source: "system", toStageId: stage.id, reason: "lead_created" } },
  };
}
