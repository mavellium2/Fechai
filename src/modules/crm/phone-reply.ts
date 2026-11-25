import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { identifyPhoneHandoff } from "@/modules/agent-engine/handoff-notice";
import { claimCrmConversation, type AssumeResult } from "./assignments";
import { reflectHandoffInGroup, teamMemberName } from "./handoff-panel";

/**
 * CRM-09: resposta da equipe pelo celular (ou WhatsApp Web) da clínica.
 *
 * O número é da clínica e compartilhado: a mensagem não diz quem digitou. Com
 * responsável na conversa, a resposta é dele; sem, fica "humano não
 * identificado" até alguém dizer que foi ele ("Fui eu" no card, "assumo" no
 * grupo). Só as respostas do **atendimento atual** mudam de autor: as que
 * vieram depois da última resposta da IA (antes dela era outro atendimento).
 */

export const phoneReplyGroupText = {
  unknown: () => "📱 Alguém respondeu pelo celular da clínica. Quem foi? Responda *assumo*",
  known: (name: string) => `📱 ${name} respondeu pelo celular da clínica.`,
};

type Db = Prisma.TransactionClient | typeof prisma;

/** Atribui a `userId` as respostas pelo celular sem autor do atendimento atual. */
export async function attributePhoneReplies(db: Db, tenantId: string, conversationId: string, userId: string): Promise<number> {
  const lastAgentReply = await db.message.findFirst({
    where: { conversationId, conversation: { tenantId }, role: "assistant", sentBy: "agent" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  const attributed = await db.message.updateMany({
    where: {
      conversationId, conversation: { tenantId }, sentVia: "phone", sentByUserId: null,
      ...(lastAgentReply ? { createdAt: { gt: lastAgentReply.createdAt } } : {}),
    },
    data: { sentByUserId: userId },
  });
  return attributed.count;
}

/**
 * A última resposta humana da conversa foi pelo celular e ninguém se
 * identificou: é o que faz o card mostrar o aviso e o botão "Fui eu".
 */
export function unidentifiedPhoneReply(
  conversation: { assignedUserId: string | null },
  lastHumanMessage: { sentVia: string | null; sentByUserId: string | null } | null | undefined,
): boolean {
  return !conversation.assignedUserId && lastHumanMessage?.sentVia === "phone" && !lastHumanMessage.sentByUserId;
}

export type ItWasMeResult = AssumeResult | "identified";

/**
 * "Fui eu": quem respondeu pelo celular se identifica pelo card. Assume a
 * conversa (o mesmo Assumir do CRM, condicional), fica com as respostas pelo
 * celular do atendimento atual e com a espera que o celular fechou, e o grupo,
 * que tinha perguntado "quem foi?", fica sabendo.
 */
export async function claimPhoneReplies(input: {
  tenantId: string; leadId: string; conversationId: string; userId: string;
}): Promise<ItWasMeResult> {
  const { tenantId, conversationId, userId } = input;
  const claim = await claimCrmConversation(input);
  if (claim === "unavailable" || claim === "assigned_elsewhere") return claim;
  await attributePhoneReplies(prisma, tenantId, conversationId, userId);
  if (await identifyPhoneHandoff(tenantId, conversationId, userId)) {
    await reflectHandoffInGroup(tenantId, conversationId, phoneReplyGroupText.known(await teamMemberName(tenantId, userId)));
  }
  return "identified";
}
