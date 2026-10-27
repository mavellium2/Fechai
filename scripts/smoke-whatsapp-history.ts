import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { importHistoryMessages } from "../src/modules/whatsapp/history-recovery-import";
import { recoveryStats } from "../src/modules/whatsapp/history-recovery-types";
import type { HistoryMessage } from "../src/modules/whatsapp/evolution-history";

/** Banco LOCAL, transação desfeita integralmente. Não envia nem chama IA. */
async function main() {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "Use somente o banco local");
  const rollback = new Error("ROLLBACK_SMOKE");
  const tag = randomUUID();
  const at = new Date("2026-10-10T11:26:00Z");
  const now = new Date("2026-10-26T12:00:00Z");
  try {
    await prisma.$transaction(async (db) => {
      const tenant = await db.tenant.create({ data: { name: `Smoke histórico ${tag}` } });
      const other = await db.tenant.create({ data: { name: `Smoke isolado ${tag}` } });
      const lead = await db.lead.create({ data: { tenantId: tenant.id, phone: "5511987654321", createdAt: new Date("2026-10-15T00:00:00Z"),
        conversation: { create: { tenantId: tenant.id, agentPaused: false, needsHuman: true, whatsappProvider: "meta", lastInboundAt: at, followUpReason: "stop", followUpStep: 3 } },
      }, include: { conversation: true } });
      const conversation = lead.conversation!;
      const message: HistoryMessage = { sourceId: `${tag}-source`, id: `${tag}-wa`, phone: "551187654321", name: "Contato de teste", text: "Mensagem histórica", fromMe: false, at, mediaWithoutFile: false };
      const stats = recoveryStats();
      await importHistoryMessages(db, tenant.id, [message], stats, now);
      assert.equal(stats.imported, 1);
      await importHistoryMessages(db, tenant.id, [message], stats, now);
      assert.equal(stats.imported, 1); assert.equal(stats.existing, 1);
      const saved = await db.message.findFirstOrThrow({ where: { whatsappMessageId: message.id, conversation: { tenantId: tenant.id } } });
      assert.equal(saved.createdAt.toISOString(), at.toISOString()); assert.equal(saved.recoveredAt?.toISOString(), now.toISOString());
      const preserved = await db.conversation.findFirstOrThrow({ where: { id: conversation.id, tenantId: tenant.id } });
      for (const field of ["agentPaused", "needsHuman", "whatsappProvider", "followUpReason", "followUpStep"] as const) assert.equal(preserved[field], conversation[field]);
      assert.equal(preserved.lastInboundAt?.toISOString(), at.toISOString());
      assert.equal(await db.lead.count({ where: { tenantId: tenant.id } }), 1);
      assert.equal((await db.lead.findFirstOrThrow({ where: { id: lead.id, tenantId: tenant.id } })).createdAt.toISOString(), at.toISOString());
      await importHistoryMessages(db, other.id, [message], recoveryStats(), now);
      assert.equal(await db.message.count({ where: { conversation: { tenantId: other.id } } }), 0);
      await db.whatsappBlockedNumber.create({ data: { tenantId: tenant.id, phone: "1187651111" } });
      await importHistoryMessages(db, tenant.id, [{ ...message, id: `${tag}-blocked`, phone: "5511987651111" }], stats, now);
      assert.equal(stats.blocked, 1);
      await db.satisfactionSurvey.create({ data: { tenantId: tenant.id, conversationId: conversation.id, provider: "evolution", ratingInboundId: `${tag}-survey` } });
      await importHistoryMessages(db, tenant.id, [{ ...message, id: `${tag}-survey` }], stats, now);
      assert.equal(stats.survey, 1);
      await importHistoryMessages(db, tenant.id, [{ ...message, id: `${tag}-outbound`, phone: "5511966667777", fromMe: true }], stats, now);
      const created = await db.message.findFirstOrThrow({ where: { whatsappMessageId: `${tag}-outbound`, conversation: { tenantId: tenant.id } }, include: { conversation: true } });
      assert.equal(created.sentBy, "history"); assert.equal(created.conversation.agentPaused, true); assert.equal(created.conversation.lastInboundAt, null);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal(await prisma.tenant.count({ where: { name: { contains: tag } } }), 0);
  console.log("OK: datas, idempotência real, aliases, isolamento, bloqueios, pesquisa e estados preservados; rollback confirmado.");
}
main().catch(() => { console.error("Falha na verificação local da recuperação."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
