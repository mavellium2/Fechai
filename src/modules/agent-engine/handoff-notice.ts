import type { HandoffAssumedVia } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leadOfConversation, recordCrmTrail } from "@/modules/crm/trail";

/**
 * Aviso de transbordo (CRM-06): o registro de cada espera da equipe, do momento
 * em que a conversa passa para humano até alguém assumir ou devolver para a IA.
 *
 * Só uma espera fica aberta (`waiting`) por conversa. Um novo transbordo com
 * ela aberta não manda outro aviso ao grupo: só conta a repetição e guarda o
 * motivo mais recente. Por isso **todo caminho que tira a conversa da espera
 * fecha o aviso** (`closeHandoffNotices`) — um aviso esquecido em aberto
 * calaria o próximo transbordo daquele contato. `tests/handoff-aviso.test.ts`
 * confere os arquivos que zeram `needsHuman`.
 *
 * Nada aqui lança: o transbordo já aconteceu quando estas funções rodam, e no
 * webhook uma exceção viraria 500 e reentrega em laço.
 */

export type HandoffTrigger = "agent" | "reaction" | "unanswered" | "campaign";

export type HandoffClose =
  | { status: "assumed"; via: HandoffAssumedVia; userId?: string | null }
  | { status: "returned" | "expired" };

const MAX_REASON = 300;

function cleanReason(reason?: string) {
  const line = (reason ?? "").replace(/\s+/g, " ").trim();
  return line ? line.slice(0, MAX_REASON) : null;
}

/**
 * Abre a espera da conversa ou reaproveita a que já está aberta. `created`
 * diz se é uma espera nova (e, portanto, se o grupo deve ser avisado). A
 * conversa é travada na transação para dois transbordos simultâneos não
 * abrirem duas esperas. `null` quando o banco falhou.
 */
export async function openHandoffNotice(input: {
  tenantId: string;
  conversationId: string;
  trigger: HandoffTrigger;
  reason?: string;
}): Promise<{ id: string; created: boolean } | null> {
  const { tenantId, conversationId, trigger } = input;
  const reason = cleanReason(input.reason);
  try {
    const result = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const open = await db.handoffNotice.findFirst({
        where: { tenantId, conversationId, status: "waiting" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (open) {
        await db.handoffNotice.updateMany({
          where: { id: open.id, tenantId },
          data: { repeatCount: { increment: 1 }, ...(reason ? { reason } : {}) },
        });
        return { id: open.id, created: false };
      }
      const notice = await db.handoffNotice.create({
        data: { tenantId, conversationId, trigger, reason },
        select: { id: true },
      });
      return { id: notice.id, created: true };
    });
    // Trilha (CRM-11): um evento por espera nova. O motivo não vai: é texto livre.
    if (result.created) {
      await recordCrmTrail({
        tenantId, event: "handoff.requested", leadId: await leadOfConversation(tenantId, conversationId),
        actor: trigger === "reaction" ? { kind: "phone", userId: null } : { kind: "system" },
        meta: { trigger, conversationId, noticeId: result.id },
      });
    }
    return result;
  } catch (error) {
    console.error("[handoff] falha ao registrar o aviso de transbordo", error);
    return null;
  }
}

/** Guarda grupo e mensagem do aviso enviado: é o que liga a mensagem do grupo ao lead. */
export async function recordHandoffNoticeSent(
  tenantId: string,
  noticeId: string,
  sent: { groupId: string; messageId: string | null; at?: Date },
): Promise<void> {
  try {
    await prisma.handoffNotice.updateMany({
      where: { id: noticeId, tenantId },
      data: { groupId: sent.groupId, messageId: sent.messageId, sentAt: sent.at ?? new Date() },
    });
  } catch (error) {
    console.error("[handoff] aviso enviado sem registro da mensagem", error);
  }
}

/**
 * Fecha a espera aberta da conversa: alguém assumiu (pelo painel, pelo grupo
 * ou respondendo pelo celular), a conversa voltou para a IA ou a espera
 * expirou. Devolve quantas fechou (0 quando não havia espera aberta).
 */
export async function closeHandoffNotices(
  tenantId: string,
  conversationId: string,
  close: HandoffClose,
  at = new Date(),
): Promise<number> {
  return (await closeHandoffNoticesTimed(tenantId, conversationId, close, at)).closed;
}

/**
 * O mesmo fechamento, devolvendo também desde quando a espera estava aberta:
 * é o "tempo até assumir" da trilha (CRM-11). Nunca lança.
 */
export async function closeHandoffNoticesTimed(
  tenantId: string,
  conversationId: string,
  close: HandoffClose,
  at = new Date(),
): Promise<{ closed: number; since: Date | null }> {
  try {
    const open = await prisma.handoffNotice.findMany({
      where: { tenantId, conversationId, status: "waiting" },
      select: { id: true, createdAt: true },
    });
    if (!open.length) return { closed: 0, since: null };
    const data = close.status === "assumed"
      ? { status: "assumed" as const, assumedVia: close.via, assumedAt: at, closedAt: at, assignedUserId: close.userId ?? null }
      : { status: close.status, closedAt: at };
    const closed = await prisma.handoffNotice.updateMany({
      where: { tenantId, conversationId, status: "waiting", id: { in: open.map(({ id }) => id) } },
      data,
    });
    const since = open.reduce<Date | null>((first, { createdAt }) => (!first || createdAt < first ? createdAt : first), null);
    return { closed: closed.count, since: closed.count ? since : null };
  } catch (error) {
    console.error("[handoff] falha ao fechar o aviso de transbordo", error);
    return { closed: 0, since: null };
  }
}

/**
 * A 1ª resposta humana (painel ou celular) depois do transbordo em curso fica
 * na espera: é a base da mediana até a 1ª resposta (CRM-11). Grava uma vez só,
 * na espera mais recente ainda aberta ou assumida. Nunca lança.
 */
export async function markHandoffFirstReply(tenantId: string, conversationId: string, at = new Date()): Promise<void> {
  try {
    const latest = await prisma.handoffNotice.findFirst({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    });
    if (!latest || (latest.status !== "waiting" && latest.status !== "assumed")) return;
    await prisma.handoffNotice.updateMany({
      where: { id: latest.id, tenantId, firstReplyAt: null, createdAt: { lte: at } },
      data: { firstReplyAt: at },
    });
  } catch (error) {
    console.error("[handoff] 1ª resposta do transbordo não registrada", error);
  }
}

/**
 * Devolver para a IA encerra a espera da conversa como `returned`: a que está
 * aberta e a última já assumida (o atendimento humano dela terminou aqui).
 * Avisos antigos ficam como estavam. Nunca lança.
 */
export async function returnHandoffNotices(
  tenantId: string,
  conversationId: string,
  at = new Date(),
  via: "panel" | "group" | "auto" = "panel",
): Promise<number> {
  try {
    // Só a espera mais recente conta: uma assumida antiga, de um atendimento
    // que já terminou, não é reaberta nem reescrita.
    const latest = await prisma.handoffNotice.findFirst({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    });
    const current = latest?.status === "assumed" ? [{ id: latest.id, status: "assumed" as const }] : [];
    const returned = await prisma.handoffNotice.updateMany({
      where: { tenantId, conversationId, OR: [{ status: "waiting" }, ...current] },
      data: { status: "returned", closedAt: at, returnedVia: via },
    });
    return returned.count;
  } catch (error) {
    console.error("[handoff] falha ao devolver o aviso de transbordo", error);
    return 0;
  }
}

/**
 * Transferir muda quem responde pela espera já assumida, só se ela é a mais
 * recente da conversa (uma antiga, de um atendimento já devolvido, fica como
 * estava). Devolve se mudou. Nunca lança.
 */
export async function transferHandoffNotice(tenantId: string, conversationId: string, userId: string): Promise<boolean> {
  try {
    const latest = await prisma.handoffNotice.findFirst({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    });
    if (latest?.status !== "assumed") return false;
    const changed = await prisma.handoffNotice.updateMany({ where: { id: latest.id, tenantId, status: "assumed" }, data: { assignedUserId: userId } });
    return changed.count > 0;
  } catch (error) {
    console.error("[handoff] falha ao transferir o aviso de transbordo", error);
    return false;
  }
}

/**
 * O aviso da espera mais recente, só se ele chegou ao grupo: é ele que as
 * respostas do painel citam. Um aviso antigo nunca é citado no lugar de uma
 * espera nova que não foi ao grupo.
 */
export async function latestSentHandoffNotice(tenantId: string, conversationId: string) {
  try {
    const notice = await prisma.handoffNotice.findFirst({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, groupId: true, messageId: true },
    });
    return notice?.groupId && notice.messageId ? { id: notice.id, groupId: notice.groupId, messageId: notice.messageId } : null;
  } catch (error) {
    console.error("[handoff] falha ao ler o aviso de transbordo", error);
    return null;
  }
}

/**
 * A espera mais recente foi fechada por uma resposta pelo celular sem autor
 * (CRM-09): quem se identificou ("Fui eu", "assumo") passa a ser quem assumiu.
 * Devolve se mudou. Nunca lança.
 */
export async function identifyPhoneHandoff(tenantId: string, conversationId: string, userId: string): Promise<boolean> {
  try {
    const latest = await prisma.handoffNotice.findFirst({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!latest) return false;
    const changed = await prisma.handoffNotice.updateMany({
      where: { id: latest.id, tenantId, status: "assumed", assumedVia: "phone", assignedUserId: null },
      data: { assignedUserId: userId },
    });
    return changed.count > 0;
  } catch (error) {
    console.error("[handoff] falha ao identificar quem respondeu pelo celular", error);
    return false;
  }
}

/**
 * Instrução do turno depois da devolução automática (CRM-12): a espera mais
 * recente voltou para a IA pelo prazo sem resposta humana e a IA ainda não
 * respondeu desde então. Vazio em qualquer outro caso. Nunca lança.
 */
export async function autoReturnTurnInstruction(tenantId: string, conversationId: string): Promise<string> {
  try {
    const latest = await prisma.handoffNotice.findFirst({
      where: { tenantId, conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true, returnedVia: true, closedAt: true },
    });
    if (latest?.status !== "returned" || latest.returnedVia !== "auto" || !latest.closedAt) return "";
    const answered = await prisma.message.findFirst({
      where: { conversationId, conversation: { tenantId }, role: "assistant", sentBy: "agent", createdAt: { gt: latest.closedAt } },
      select: { id: true },
    });
    return answered ? "" : AUTO_RETURN_INSTRUCTION;
  } catch (error) {
    console.error("[handoff] instrução da devolução automática indisponível", error);
    return "";
  }
}

export const AUTO_RETURN_INSTRUCTION =
  "O contato aguardou alguém da equipe e ninguém respondeu a tempo, então você voltou a atender. "
  + "Comece pedindo desculpas pela demora, em uma frase curta, e retome o atendimento de onde parou. "
  + "Não prometa que a equipe vai responder.";

