import type { Prisma } from "@prisma/client";
import { canonicalPhone } from "./blocklist";
import { historyPhoneAliases, type HistoryMessage } from "./evolution-history";
import type { RecoveryStats } from "./history-recovery-types";

/** Só banco. Nunca chama appendMessage, motor do agente ou qualquer envio. */
export async function importHistoryMessages(db: Prisma.TransactionClient, tenantId: string, messages: HistoryMessage[], stats: RecoveryStats, now: Date) {
  const ids = messages.map((m) => m.id);
  const surveys = await db.satisfactionSurvey.findMany({
    where: { tenantId, OR: ["ratingMsgId", "followMsgId", "thanksMsgId", "ratingInboundId", "commentInboundId"].map((field) => ({ [field]: { in: ids } })) },
    select: { ratingMsgId: true, followMsgId: true, thanksMsgId: true, ratingInboundId: true, commentInboundId: true },
  });
  const surveyIds = new Set(surveys.flatMap((s) => Object.values(s).filter((id): id is string => typeof id === "string")));
  const blocked = await db.whatsappBlockedNumber.findMany({ where: { tenantId }, select: { phone: true } });
  const blockedPhones = new Set(blocked.map((b) => b.phone));
  const groups = new Map<string, HistoryMessage[]>();
  for (const message of messages) {
    const contactKey = canonicalPhone(message.phone);
    if (blockedPhones.has(contactKey)) { stats.blocked++; continue; }
    if (surveyIds.has(message.id)) { stats.survey++; continue; }
    const group = groups.get(contactKey) ?? [];
    group.push(message);
    groups.set(contactKey, group);
  }
  // Mesma ordem de locks para todas as páginas; webhook segura só um contato.
  for (const [contactKey, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactKey}))`;
    const pending: HistoryMessage[] = [];
    for (const message of group) {
      const existing = await db.message.findFirst({
        where: { whatsappMessageId: message.id, conversation: { tenantId } }, select: { id: true },
      });
      if (existing) stats.existing++;
      else pending.push(message);
    }
    if (!pending.length) continue;
    const aliases = [...new Set(pending.flatMap((m) => historyPhoneAliases(m.phone)))];
    const leads = await db.lead.findMany({ where: { tenantId, phone: { in: aliases } }, include: { conversation: true }, take: 2 });
    if (leads.length > 1) { stats.ambiguousPhone += pending.length; continue; }
    let lead = leads[0];
    if (lead?.isTest || lead?.conversation?.isTest) { stats.test += pending.length; continue; }
    const oldest = pending.reduce((first, m) => m.at < first.at ? m : first);
    const latest = pending.reduce((last, m) => m.at > last.at ? m : last);
    let createdLead = false;
    if (!lead) {
      lead = await db.lead.create({ data: { tenantId, phone: oldest.phone,
        name: pending.find((m) => !m.fromMe && m.name)?.name, createdAt: oldest.at, updatedAt: latest.at,
        conversation: { create: { tenantId, agentPaused: true, whatsappProvider: "evolution", updatedAt: latest.at } },
      }, include: { conversation: true } });
      createdLead = true;
    } else if (lead.createdAt > oldest.at) {
      // O contato existe; corrigir a primeira data não significa atividade agora.
      await db.lead.update({ where: { id: lead.id, tenantId }, data: { createdAt: oldest.at, updatedAt: lead.updatedAt } });
    }
    let conversation = lead.conversation;
    if (!conversation) conversation = await db.conversation.create({ data: {
      tenantId, leadId: lead.id, agentPaused: true, whatsappProvider: "evolution", updatedAt: latest.at,
    } });
    const inserted = await db.message.createMany({ data: pending.map((m) => ({
      conversationId: conversation.id, role: m.fromMe ? "assistant" : "user",
      sentBy: m.fromMe ? "history" : null, content: m.text, whatsappMessageId: m.id,
      createdAt: m.at, recoveredAt: now, audioSeconds: m.audioSeconds ?? null,
    })), skipDuplicates: true });
    stats.imported += inserted.count;
    // Outra conta com o mesmo id global não vira falso "já existia nesta conta".
    stats.invalid += pending.length - inserted.count;
    const mediaIds = pending.filter((m) => m.mediaWithoutFile).map((m) => m.id);
    if (mediaIds.length) stats.mediaWithoutFile += await db.message.count({ where: {
      conversationId: conversation.id, conversation: { tenantId }, whatsappMessageId: { in: mediaIds }, recoveredAt: now,
    } });
    // Conflito global de id não deixa contato vazio criado por esta transação.
    if (!inserted.count && createdLead) await db.lead.delete({ where: { id: lead.id, tenantId } });
    if (inserted.count && conversation.updatedAt < latest.at) {
      await db.conversation.update({ where: { id: conversation.id, tenantId }, data: { updatedAt: latest.at } });
    }
    // Páginas chegam do mais recente para o mais antigo. Nunca transforma a
    // importação em nova entrada, pausa, retomada ou mudança de canal.
  }
}
