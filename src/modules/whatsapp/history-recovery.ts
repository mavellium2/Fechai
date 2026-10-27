import { prisma } from "@/lib/prisma";
import { recoveryStats, type HistoryRecoveryView } from "./history-recovery-types";

/** Também usada pelo worker: desligar o QR ou a conta interrompe a recuperação. */
export async function recoveryConnection(tenantId: string) {
  const instance = await prisma.whatsappInstance.findFirst({
    where: { tenantId, provider: "evolution", tenant: { status: "active", evolutionWhatsappEnabled: true } },
    select: { externalId: true },
  });
  if (!instance?.externalId) throw new Error("Esta conta não tem um WhatsApp por QR autorizado para recuperar.");
  return instance.externalId;
}

export async function startHistoryRecovery(tenantId: string, requestedBy: string, now = new Date()) {
  const externalId = await recoveryConnection(tenantId);
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('whatsapp-history-recovery'))`;
    const active = await db.whatsappHistoryRecovery.findFirst({
      where: { tenantId, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" },
    });
    if (active) return active.id;
    const until = new Date(Math.floor(now.getTime() / 1000) * 1000);
    const run = await db.whatsappHistoryRecovery.create({ data: {
      tenantId, requestedBy, externalId, until,
      since: new Date(until.getTime() - 30 * 86_400_000), stats: recoveryStats(),
      // Dá tempo para os eventos recebidos ao vivo terminarem de gravar antes
      // de completar seu histórico. A janela continua terminando no clique.
      lockedUntil: new Date(now.getTime() + 120_000),
    } });
    return run.id;
  });
}

export async function readHistoryRecovery(tenantId: string): Promise<HistoryRecoveryView | null> {
  const row = await prisma.whatsappHistoryRecovery.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return row ? { id: row.id, status: row.status, since: row.since.toISOString(), until: row.until.toISOString(),
    total: row.sourceTotal, stats: recoveryStats(row.stats), error: row.error, updatedAt: row.updatedAt.toISOString() } : null;
}
