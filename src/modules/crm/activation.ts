import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { lockCrmAdmission } from "./admission";
import { fillInitialCrmStages } from "./backfill";
import { ensureDentalPipeline } from "./pipeline";

type ActivationResult = "changed" | "unchanged" | "not_found" | "inactive" | "superseded";

export async function setCrmEnabled(tenantId: string, enabled: boolean): Promise<ActivationResult> {
  const token = randomUUID();
  const attempt = await prisma.$transaction(async (db) => {
    await lockCrmAdmission(db, tenantId, "exclusive");
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { status: true, crmEnabled: true, crmActivationToken: true } });
    if (!tenant) return "not_found";
    if (!enabled) {
      if (tenant.crmEnabled || tenant.crmActivationToken) {
        await db.tenant.update({ where: { id: tenantId }, data: { crmEnabled: false, crmActivationToken: null } });
      }
      return tenant.crmEnabled ? "changed" : "unchanged";
    }
    if (tenant.status !== "active") return "inactive";
    if (tenant.crmEnabled) return "unchanged";

    const pipeline = await ensureDentalPipeline(db, tenantId);
    const stages = await db.pipelineStage.count({
      where: { tenantId, pipelineId: pipeline.id, kind: { not: null }, archivedAt: null },
    });
    if (stages !== 8) throw new Error("O pipeline não tem as oito etapas de sistema ativas.");
    await db.tenant.update({ where: { id: tenantId }, data: { crmActivationToken: token } });
    return pipeline;
  }, { isolationLevel: "ReadCommitted" });
  if (typeof attempt === "string") return attempt;

  const preparing = { id: tenantId, status: "active", crmActivationToken: token };
  try {
    for (;;) {
      const count = await prisma.$transaction(async (db) => {
        await lockCrmAdmission(db, tenantId, "shared");
        const current = await db.tenant.findFirst({ where: preparing, select: { id: true } });
        return current ? fillInitialCrmStages(db, tenantId, attempt.id) : null;
      }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
      if (count === null) return "superseded";
      if (count === 0) break;
    }

    return await prisma.$transaction(async (db): Promise<ActivationResult> => {
      await lockCrmAdmission(db, tenantId, "exclusive");
      const current = await db.tenant.findFirst({ where: preparing, select: { id: true } });
      if (!current) return "superseded";
      const missing = await db.lead.findFirst({
        where: {
          tenantId, stageId: null, isTest: false,
          OR: [{ conversation: { is: null } }, { conversation: { is: { isTest: false } } }],
        },
        select: { id: true },
      });
      // As criações normais compartilham o lock e já entram em `new` durante o preparo.
      if (missing) throw new Error("Existem leads sem etapa inicial. Tente ativar novamente.");
      const result = await db.tenant.updateMany({ where: preparing, data: { crmEnabled: true, crmActivationToken: null } });
      return result.count ? "changed" : "superseded";
    }, { isolationLevel: "ReadCommitted" });
  } finally {
    try {
      await prisma.tenant.updateMany({ where: { id: tenantId, crmActivationToken: token }, data: { crmActivationToken: null } });
    } catch {
      console.error("[crm] não foi possível limpar a tentativa de ativação", tenantId);
    }
  }
}
