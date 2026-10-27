import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { readEvolutionHistoryPage, readHistoryMessage } from "./evolution-history";
import { recoveryConnection } from "./history-recovery";
import { importHistoryMessages } from "./history-recovery-import";
import { recoveryStats } from "./history-recovery-types";

const FAILURE = "A recuperação parou antes de concluir. O que já foi recuperado permanece salvo. Tente novamente.";
const CHANGED = "O histórico da origem mudou ou veio incompleto. Execute novamente para conferir o restante.";

/** Uma página por conta/rodada, com claim condicional e commit junto do cursor. */
export async function scanWhatsappHistoryRecovery(now = new Date()) {
  const runs = await prisma.whatsappHistoryRecovery.findMany({
    where: { status: { in: ["queued", "running"] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { updatedAt: "asc" }, take: 4,
  });
  let imported = 0;
  for (const run of runs) {
    const token = randomUUID();
    const claimed = await prisma.whatsappHistoryRecovery.updateMany({
      where: { id: run.id, tenantId: run.tenantId, status: { in: ["queued", "running"] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { status: "running", leaseToken: token, lockedUntil: new Date(now.getTime() + 120_000) },
    });
    if (!claimed.count) continue;
    let failure = FAILURE;
    try {
      if (await recoveryConnection(run.tenantId) !== run.externalId) throw new Error("connection changed");
      const page = await readEvolutionHistoryPage(run.externalId, run.since, run.until, run.page);
      if ((run.sourceTotal !== null && run.sourceTotal !== page.total) ||
        (page.total > 0 && page.records.length === 0)) { failure = CHANGED; throw new Error("source changed"); }
      const count = await prisma.$transaction(async (db) => {
        // O claim pode ter expirado enquanto a origem demorava: perde a vez sem gravar.
        const ownership = await db.whatsappHistoryRecovery.updateMany({
          where: { id: run.id, tenantId: run.tenantId, leaseToken: token, status: "running" },
          data: { lockedUntil: new Date(Date.now() + 120_000) },
        });
        if (!ownership.count) return 0;
        const allowed = await db.whatsappInstance.findFirst({ where: {
          tenantId: run.tenantId, provider: "evolution", externalId: run.externalId,
          tenant: { status: "active", evolutionWhatsappEnabled: true },
        }, select: { id: true } });
        if (!allowed) throw new Error("connection disabled");
        const stats = recoveryStats(run.stats);
        const before = stats.imported;
        const messages = [];
        for (const raw of page.records) {
          const sourceId = raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : null;
          if (!sourceId) { failure = CHANGED; throw new Error("missing source id"); }
          const registered = await db.whatsappHistoryRecoveryItem.createMany({ data: [{ recoveryId: run.id, sourceId }], skipDuplicates: true });
          if (!registered.count) continue;
          stats.scanned++;
          const result = readHistoryMessage(raw, run.externalId, run.since, run.until);
          if ("skipped" in result) stats[result.skipped]++;
          else messages.push(result.message);
        }
        await importHistoryMessages(db, run.tenantId, messages, stats, new Date());
        const done = run.page >= page.pages;
        // Ties de timestamp, repetição de página e mudanças na paginação não
        // podem anunciar cobertura completa só por chegar à última página.
        const complete = !done || stats.scanned === page.total;
        await db.whatsappHistoryRecovery.update({ where: { id: run.id, tenantId: run.tenantId }, data: {
          page: run.page + 1, sourceTotal: page.total, stats,
          status: done ? complete ? "completed" : "failed" : "queued",
          error: complete ? null : CHANGED, completedAt: done ? new Date() : null,
          leaseToken: null, lockedUntil: null,
        } });
        return stats.imported - before;
      }, { timeout: 60_000 });
      imported += count;
    } catch {
      await prisma.whatsappHistoryRecovery.updateMany({
        where: { id: run.id, tenantId: run.tenantId, leaseToken: token, status: "running" },
        data: { status: "failed", error: failure, leaseToken: null, lockedUntil: null },
      });
    }
  }
  return { scanned: runs.length, imported };
}
