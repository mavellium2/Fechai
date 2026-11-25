import { prisma } from "@/lib/prisma";
import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import { findWhatsappChannel } from "@/modules/whatsapp/instances";
import {
  closeHandoffNotices,
  latestSentHandoffNotice,
  openHandoffNotice,
  returnHandoffNotices,
  transferHandoffNotice,
} from "@/modules/agent-engine/handoff-notice";
import { moveLeadToStage } from "./automatic-stage";
import { recordCrmTrail } from "./trail";

/**
 * CRM-07: transferir e devolver para a IA pelo painel, e o reflexo de cada
 * passo no grupo do WhatsApp (citando o aviso do transbordo). Assumir mora em
 * `assignments.ts`. A equipe é quem tem login de dono com o produto ligado,
 * a mesma regra de `claimCrmConversation`.
 */

const teamMember = (tenantId: string, id: string) =>
  prisma.user.findFirst({ where: { id, tenantId, role: "OWNER", usesProduct: true }, select: { id: true, name: true } });

/** Nome mostrado no grupo. Nunca o e-mail: o grupo é de conversa, não de cadastro. */
export async function teamMemberName(tenantId: string, userId: string | null | undefined): Promise<string> {
  if (!userId) return "Alguém da equipe";
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { name: true } }).catch(() => null);
  return user?.name?.trim() || "Alguém da equipe";
}

export const handoffGroupText = {
  assumed: (name: string) => `✅ ${name} assumiu pelo Fechai`,
  returned: (name: string) => `↩️ Lead devolvido para a IA por ${name}`,
  transferred: (to: string, by: string) => `🔁 Transferido para ${to} por ${by}`,
  resolved: (name: string) => `✅ ${name} resolveu pelo Fechai`,
};

/**
 * Responde no grupo citando o aviso da espera mais recente. Sem aviso enviado
 * (grupo desligado, conta só com a Meta, conversa de teste) não faz nada.
 * Nunca lança: o grupo é aviso, a ação do painel já aconteceu.
 */
export async function reflectHandoffInGroup(tenantId: string, conversationId: string, text: string): Promise<boolean> {
  try {
    const notice = await latestSentHandoffNotice(tenantId, conversationId);
    if (!notice) return false;
    const instance = await findWhatsappChannel(tenantId, "evolution");
    if (!instance?.externalId) return false;
    const provider = getWhatsAppProviderForInstance(instance);
    if (!provider.sendGroupMessage || !provider.isConfigured()) return false;
    await provider.sendGroupMessage(instance.externalId, notice.groupId, text, notice.messageId);
    return true;
  } catch (error) {
    console.error("[crm] falha ao refletir o atendimento no grupo do WhatsApp", error);
    return false;
  }
}

export type TransferResult =
  | { status: "transferred" }
  | { status: "same" | "unavailable" | "not_assigned" }
  | { status: "changed"; currentUserId: string | null };

/**
 * Passa o atendimento de quem está com ele para outra pessoa da equipe.
 * Condicional ao responsável que a tela mostrava: se alguém mudou no meio,
 * nada é gravado e a tela recebe quem está agora.
 */
export async function transferCrmConversation(input: {
  tenantId: string; conversationId: string; actorUserId: string; toUserId: string; expectedUserId: string;
}): Promise<TransferResult> {
  const { tenantId, conversationId, actorUserId, toUserId, expectedUserId } = input;
  if (toUserId === expectedUserId) return { status: "same" };
  const result = await prisma.$transaction(async (db) => {
    const [conversation, actor, target] = await Promise.all([
      db.conversation.findFirst({ where: { id: conversationId, tenantId, isTest: false }, select: { assignedUserId: true, leadId: true } }),
      teamMember(tenantId, actorUserId),
      teamMember(tenantId, toUserId),
    ]);
    if (!conversation || !actor || !target) return { status: "unavailable" as const };
    if (!conversation.assignedUserId) return { status: "not_assigned" as const };
    const assignedAt = new Date();
    const change = await db.conversation.updateMany({
      where: { id: conversationId, tenantId, assignedUserId: expectedUserId },
      data: { assignedUserId: toUserId, assignedAt, agentPaused: true, needsHuman: false },
    });
    if (!change.count) return { status: "changed" as const, currentUserId: conversation.assignedUserId };
    const row = await db.conversationAssignment.create({
      data: { tenantId, conversationId, fromUserId: expectedUserId, toUserId, actorUserId, via: "panel", createdAt: assignedAt },
      select: { id: true, createdAt: true },
    });
    return { status: "transferred" as const, row, leadId: conversation.leadId, to: target.name, by: actor.name };
  }, { isolationLevel: "ReadCommitted" });
  if (result.status !== "transferred") return result;

  // Uma espera ainda aberta fica assumida por quem recebeu; a já assumida muda de dono.
  const closed = await closeHandoffNotices(tenantId, conversationId, { status: "assumed", via: "panel", userId: toUserId }, result.row.createdAt);
  const moved = closed > 0 || await transferHandoffNotice(tenantId, conversationId, toUserId);
  await moveLeadToStage(tenantId, result.leadId, "human", "user", {
    userId: actorUserId, conversationId, reason: "human_assumed", key: result.row.id, at: result.row.createdAt,
  });
  await recordCrmTrail({
    tenantId, event: "handoff.transferred", actor: { kind: "user", userId: actorUserId }, leadId: result.leadId,
    meta: { via: "panel", conversationId, fromUserId: expectedUserId, toUserId },
  });
  // O grupo só ouve sobre o atendimento de que foi avisado (espera atual).
  if (moved) {
    await reflectHandoffInGroup(tenantId, conversationId, handoffGroupText.transferred(
      result.to?.trim() || "outra pessoa da equipe", result.by?.trim() || "Alguém da equipe"));
  }
  return { status: "transferred" };
}

export type ReturnResult = { status: "returned"; agentId: string } | { status: "unavailable" | "no_agent" };

/**
 * Devolver para a IA: despausa, tira o "precisa de você" e o responsável,
 * leva o card para a etapa da IA e encerra a espera como `returned`. A resposta
 * à mensagem pendente fica com quem chama (`recoverPendingAgentReply`).
 */
export async function returnConversationToAi(input: {
  tenantId: string; conversationId: string; actorUserId: string | null;
  /** Por onde voltou: botão do painel, "#ia" no grupo (CRM-08) ou o prazo da devolução automática (CRM-12). */
  via?: "panel" | "group" | "auto";
  /** Quem mandou "#ia" sem estar vinculado: só o final do número vai para a trilha. */
  actorPhone?: string | null;
}): Promise<ReturnResult> {
  const { tenantId, conversationId, actorUserId } = input;
  const via = input.via ?? "panel";
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { leadId: true, isTest: true, assignedUserId: true, agentPaused: true, needsHuman: true,
      agent: { select: { id: true, enabled: true, archived: true } } },
  });
  if (!conversation) return { status: "unavailable" };
  const agentId = conversation.agent?.enabled && !conversation.agent.archived
    ? conversation.agent.id
    : (await prisma.agent.findFirst({
        where: { tenantId, enabled: true, archived: false },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      }))?.id;
  if (!agentId) return { status: "no_agent" };

  const at = new Date();
  const res = await prisma.conversation.updateMany({
    where: { id: conversationId, tenantId },
    data: { agentId, agentPaused: false, needsHuman: false, assignedUserId: null, assignedAt: null },
  });
  if (res.count === 0) return { status: "unavailable" };
  if (conversation.assignedUserId && actorUserId && !conversation.isTest) {
    await prisma.conversationAssignment.create({
      data: { tenantId, conversationId, fromUserId: conversation.assignedUserId, toUserId: null, actorUserId, via, createdAt: at },
    }).catch((error) => console.error("[crm] devolução sem registro no histórico de responsáveis", error));
  }
  const returned = await returnHandoffNotices(tenantId, conversationId, at, via);
  // Trilha (CRM-11): só quando havia atendimento humano para encerrar.
  if (!conversation.isTest && (returned > 0 || conversation.agentPaused || conversation.needsHuman || conversation.assignedUserId)) {
    await recordCrmTrail({
      tenantId, event: "handoff.returned_to_ai", leadId: conversation.leadId,
      actor: via === "auto" || !actorUserId && via !== "group"
        ? { kind: "system" }
        : via === "group" ? { kind: "group", userId: actorUserId, phone: input.actorPhone } : { kind: "user", userId: actorUserId! },
      meta: { via, conversationId, fromUserId: conversation.assignedUserId },
    });
  }
  if (!conversation.isTest) {
    await moveLeadToStage(tenantId, conversation.leadId, "ai", via === "group" ? "group" : via === "auto" ? "system" : "user", {
      userId: actorUserId ?? undefined, conversationId, reason: "returned_to_ai", at,
    });
    // Só quando havia um atendimento em curso: reativar uma conversa antiga não
    // reabre o assunto no grupo. A devolução automática (CRM-12) avisa com o próprio texto.
    if (returned > 0 && via !== "auto") {
      await reflectHandoffInGroup(tenantId, conversationId, handoffGroupText.returned(await teamMemberName(tenantId, actorUserId)));
    }
  }
  return { status: "returned", agentId };
}

/** Quem está com a conversa agora, para a tela dizer "já está com Fulana". */
export async function currentAssigneeName(tenantId: string, conversationId: string): Promise<string | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId }, select: { assignedUserId: true },
  }).catch(() => null);
  return conversation?.assignedUserId ? teamMemberName(tenantId, conversation.assignedUserId) : null;
}

/**
 * Devolver e já responder a mensagem que ficou pendente. Se a resposta falhar,
 * a conversa volta a pedir alguém da equipe, para não ficar sem ninguém.
 */
export async function returnToAiAndReply(input: {
  tenantId: string; conversationId: string; actorUserId: string | null; via?: "panel" | "group" | "auto"; actorPhone?: string | null;
}) {
  const result = await returnConversationToAi(input);
  if (result.status !== "returned") return result;
  const recovery = await replyPendingAfterReturn(input.tenantId, input.conversationId, result.agentId);
  return { status: "returned" as const, recovery };
}

/**
 * Depois de devolver, a IA responde a mensagem do contato que ficou pendente.
 * Se falhar, a conversa volta a pedir alguém da equipe, com uma espera nova.
 */
export async function replyPendingAfterReturn(tenantId: string, conversationId: string, agentId: string) {
  const { recoverPendingAgentReply } = await import("@/modules/agent-engine/recover-pending");
  const recovery = await recoverPendingAgentReply(tenantId, conversationId, agentId);
  if (recovery.status === "failed") {
    await prisma.conversation.updateMany({ where: { id: conversationId, tenantId }, data: { needsHuman: true } });
    // Volta a "precisa de você" com uma espera aberta, como qualquer transbordo.
    await openHandoffNotice({ tenantId, conversationId, trigger: "agent", reason: "A IA não conseguiu responder depois da devolução" });
  }
  return recovery;
}
