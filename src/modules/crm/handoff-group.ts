import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import type { IncomingMessage, WhatsAppProvider } from "@/modules/whatsapp/provider";
import { moveLeadToStage } from "./automatic-stage";
import { returnToAiAndReply, teamMemberName } from "./handoff-panel";
import { attributePhoneReplies } from "./phone-reply";
import { recordCrmTrail, secondsBetween } from "./trail";
import { resolveGroupMember, type GroupMember } from "./team-whatsapp";

/**
 * CRM-08: o grupo de transbordo como painel da equipe. Responder ao aviso com
 * "assumo" (ou "eu", "pego", "deixa comigo") ou reagir 👍 nele faz a pessoa
 * responsável; "#ia" devolve para a IA. Só vale o que está **ligado a um aviso**
 * (`HandoffNotice.messageId`) pela citação ou pelo alvo da reação. Nenhuma
 * outra mensagem do grupo é lida, gravada ou respondida.
 */

export type HandoffGroupCommand = "assume" | "return";

const ASSUME_WORDS = new Set(["assumo", "eu assumo", "eu", "pego", "eu pego", "deixa comigo"]);

/** Comando de uma mensagem ou reação do grupo; `null` para todo o resto. Pura. */
export function parseHandoffGroupCommand(text: string, isReaction: boolean): HandoffGroupCommand | null {
  if (isReaction) {
    // 👍 com qualquer tom de pele (e o seletor de variação que alguns teclados põem).
    return text.replace(/[\u{1F3FB}-\u{1F3FF}️]/gu, "").trim() === "👍" ? "assume" : null;
  }
  const words = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ").trim();
  if (words === "#ia") return "return";
  return ASSUME_WORDS.has(words) ? "assume" : null;
}

/** Final do número para a mensagem no grupo: nunca o número inteiro. */
function phoneTail(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? ` (final ${digits.slice(-4)})` : "";
}

export const handoffGroupReplies = {
  assumed: (name: string) => `✅ ${name} assumiu este lead.`,
  assumedUnlinked: (phone: string | null | undefined) =>
    `✅ Assumido por um número ainda não ligado ao Fechai${phoneTail(phone)}. `
    + "Para aparecer com o seu nome, vincule o seu WhatsApp em Configurações › Seu WhatsApp na equipe.",
  taken: (name: string) => `Este lead já está com ${name}.`,
  takenUnlinked: (phone: string | null | undefined) => `Este lead já foi assumido por um número não vinculado${phoneTail(phone)}.`,
  closed: () => "Este aviso já foi encerrado: o lead voltou para a IA.",
  alreadyAi: () => "Este lead já está com a IA.",
  noAgent: () => "Não há agente ativo para devolver este lead. Ative um agente em Agentes, no Fechai.",
};

type Notice = { id: string; conversationId: string; messageId: string; createdAt: Date };

/**
 * Evento de grupo da Evolution. `handled: true` quando o grupo é de transbordo
 * (configurado na ação ou com aviso já enviado): a mensagem **nunca** segue
 * para conversa, cadastro ou agente, mesmo com "ignorar grupos" desligado.
 * Roda antes desse filtro, então também funciona com ele ligado.
 * **Nunca lança.**
 */
export async function handleHandoffGroupEvent(input: {
  tenantId: string;
  incoming: IncomingMessage;
  provider: WhatsAppProvider;
}): Promise<{ handled: boolean }> {
  const { tenantId, incoming, provider } = input;
  if (provider.name !== "evolution" || !incoming.isGroup) return { handled: false };
  const groupId = `${incoming.fromPhone}@g.us`;
  try {
    const targetId = incoming.isReaction ? incoming.reactionTargetId : incoming.quotedMessageId;
    const notice = targetId
      ? await prisma.handoffNotice.findFirst({
          where: { tenantId, groupId, messageId: targetId },
          select: { id: true, conversationId: true, messageId: true, createdAt: true },
        })
      : null;
    if (!notice && !(await isHandoffGroup(tenantId, groupId))) return { handled: false };

    // Daqui em diante o evento é do grupo da equipe. O eco das nossas próprias
    // respostas (`fromMe`) e qualquer conversa solta param aqui, sem gravar nada.
    if (!notice?.messageId || incoming.isFromMe || incoming.hasAudio) return { handled: true };
    const command = parseHandoffGroupCommand(incoming.text, Boolean(incoming.isReaction));
    if (!command) return { handled: true };

    // Reentrega da Evolution não repete o comando; rajada do mesmo número também não.
    if (incoming.messageKeyId && !(await rateLimit("crm:handoff-group:msg", incoming.messageKeyId, 1, 86_400)).allowed) {
      return { handled: true };
    }
    const sender = incoming.groupSender;
    if (!(await rateLimit("crm:handoff-group", `${tenantId}:${sender?.phone ?? sender?.lid ?? "?"}`, 20, 300)).allowed) {
      return { handled: true };
    }

    const member = await findMember(tenantId, sender);
    const linked = { ...notice, messageId: notice.messageId };
    const text = command === "assume"
      ? await assumeFromGroup(tenantId, linked, member, sender?.phone ?? null)
      : await returnFromGroup(tenantId, linked, member, sender?.phone ?? null);
    if (text) await reply(provider, incoming.instanceExternalId, groupId, text, notice.messageId);
  } catch (error) {
    console.error("[crm] falha ao ler o comando do grupo de transbordo", error);
  }
  return { handled: true };
}

/** O grupo escolhido na ação de transbordo de algum agente, ou um grupo que já recebeu aviso. */
async function isHandoffGroup(tenantId: string, groupId: string): Promise<boolean> {
  const configured = await prisma.tenantAction.findFirst({
    where: { tenantId, key: "handoff_human", config: { path: ["groupId"], equals: groupId } },
    select: { id: true },
  });
  if (configured) return true;
  return Boolean(await prisma.handoffNotice.findFirst({ where: { tenantId, groupId }, select: { id: true } }));
}

async function findMember(tenantId: string, sender: IncomingMessage["groupSender"]): Promise<GroupMember | null> {
  const byPhone = sender?.phone ? await resolveGroupMember(tenantId, sender.phone) : null;
  if (byPhone) return byPhone;
  return sender?.lid ? resolveGroupMember(tenantId, `${sender.lid}@lid`) : null;
}

class TakenMeanwhile extends Error {}

/**
 * "assumo"/👍: o primeiro vence. A espera (`waiting`) é a trava: só um comando
 * a fecha, e a conversa só muda se o responsável ainda é o que foi lido.
 * Quem não está ligado a ninguém da equipe também assume (a IA pausa e o card
 * fica como "humano não identificado"), e o número fica na espera.
 */
async function assumeFromGroup(tenantId: string, notice: Notice, member: GroupMember | null, senderPhone: string | null) {
  const at = new Date();
  const result = await prisma.$transaction(async (db) => {
    const conversation = await db.conversation.findFirst({
      where: { id: notice.conversationId, tenantId },
      select: { leadId: true, isTest: true, assignedUserId: true },
    });
    if (!conversation || conversation.isTest) return { status: "unavailable" as const };
    const before = conversation.assignedUserId;
    if (before && before !== member?.userId) return { status: "taken" as const, userId: before };

    const gate = await db.handoffNotice.updateMany({
      where: { id: notice.id, tenantId, status: "waiting" },
      data: {
        status: "assumed", assumedVia: "group", assumedAt: at, closedAt: at,
        assignedUserId: member?.userId ?? null, assumedByPhone: member ? null : senderPhone,
      },
    });
    // CRM-09: alguém respondeu pelo celular sem se identificar e o grupo
    // perguntou "quem foi?". Quem responde "assumo" é essa pessoa (o número não
    // vinculado só fica registrado, sem sobrescrever outro).
    const phoneAnswer = gate.count ? 0 : (await db.handoffNotice.updateMany({
      where: { id: notice.id, tenantId, status: "assumed", assumedVia: "phone", assignedUserId: null, ...(member ? {} : { assumedByPhone: null }) },
      data: member ? { assignedUserId: member.userId } : { assumedByPhone: senderPhone },
    })).count;
    if (!gate.count && !phoneAnswer) return { status: "closed" as const };

    const change = await db.conversation.updateMany({
      where: { id: notice.conversationId, tenantId, assignedUserId: before },
      data: { ...(member ? { assignedUserId: member.userId, assignedAt: at } : {}), agentPaused: true, needsHuman: false },
    });
    // Alguém assumiu pelo painel entre a leitura e a escrita: desfaz a espera também.
    if (!change.count) throw new TakenMeanwhile();
    if (member && phoneAnswer) await attributePhoneReplies(db, tenantId, notice.conversationId, member.userId);
    const row = member && !before
      ? await db.conversationAssignment.create({
          data: { tenantId, conversationId: notice.conversationId, toUserId: member.userId, actorUserId: member.userId, via: "group", createdAt: at },
          select: { id: true },
        })
      : null;
    return { status: "assumed" as const, leadId: conversation.leadId, key: row?.id ?? notice.id, waited: Boolean(gate.count) };
  }, { isolationLevel: "ReadCommitted" }).catch((error) => {
    if (error instanceof TakenMeanwhile) return { status: "taken_meanwhile" as const };
    throw error;
  });

  if (result.status === "unavailable") return null;
  if (result.status === "taken") return handoffGroupReplies.taken(await teamMemberName(tenantId, result.userId));
  if (result.status === "taken_meanwhile" || result.status === "closed") return describeClosed(tenantId, notice);

  // Trilha (CRM-11): quem assumiu pelo grupo, ou o número mascarado de quem não está vinculado.
  await recordCrmTrail({
    tenantId, event: "handoff.assumed", actor: { kind: "group", userId: member?.userId ?? null, phone: senderPhone }, leadId: result.leadId,
    meta: {
      via: "group", action: result.waited ? "claim" : "identify", conversationId: notice.conversationId,
      waitSeconds: result.waited ? secondsBetween(notice.createdAt, at) : null,
    },
  });
  await moveLeadToStage(tenantId, result.leadId, "human", "group", {
    userId: member?.userId, conversationId: notice.conversationId, reason: "human_assumed", key: result.key, at,
  });
  return member
    ? handoffGroupReplies.assumed(await teamMemberName(tenantId, member.userId))
    : handoffGroupReplies.assumedUnlinked(senderPhone);
}

/** Resposta para um "assumo" que chegou depois: diz com quem o lead está. */
async function describeClosed(tenantId: string, notice: Notice): Promise<string> {
  const [conversation, current] = await Promise.all([
    prisma.conversation.findFirst({ where: { id: notice.conversationId, tenantId }, select: { assignedUserId: true } }),
    prisma.handoffNotice.findFirst({ where: { id: notice.id, tenantId }, select: { status: true, assumedByPhone: true } }),
  ]);
  if (conversation?.assignedUserId) return handoffGroupReplies.taken(await teamMemberName(tenantId, conversation.assignedUserId));
  if (current?.status === "assumed") return handoffGroupReplies.takenUnlinked(current.assumedByPhone);
  return handoffGroupReplies.closed();
}

/** "#ia": a mesma devolução do painel (CRM-07), que já responde no grupo citando o aviso. */
async function returnFromGroup(tenantId: string, notice: Notice, member: GroupMember | null, senderPhone: string | null) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: notice.conversationId, tenantId },
    select: { isTest: true, agentPaused: true, needsHuman: true, assignedUserId: true },
  });
  if (!conversation || conversation.isTest) return null;
  if (!conversation.agentPaused && !conversation.needsHuman && !conversation.assignedUserId) return handoffGroupReplies.alreadyAi();
  const result = await returnToAiAndReply({ tenantId, conversationId: notice.conversationId, actorUserId: member?.userId ?? null, via: "group", actorPhone: senderPhone });
  return result.status === "no_agent" ? handoffGroupReplies.noAgent() : null;
}

async function reply(provider: WhatsAppProvider, externalId: string, groupId: string, text: string, quoted: string) {
  try {
    await provider.sendGroupMessage?.(externalId, groupId, text, quoted);
  } catch (error) {
    console.error("[crm] falha ao responder no grupo de transbordo", error);
  }
}
