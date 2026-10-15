import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { isPhoneBlocked } from "@/modules/whatsapp/blocklist";
import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import { agentRepliesOn, channelProvider, findWhatsappChannel, setConversationChannel } from "@/modules/whatsapp/instances";
import { sendAgentReply } from "@/modules/whatsapp/send-agent-reply";
import { resolveAgent, runAgentTurn } from "./orchestrator";

export type PendingRecovery =
  | { status: "none" }
  | { status: "sent" }
  | { status: "in_progress" }
  | { status: "failed"; error: string };

/**
 * A reativação recupera apenas a última fala real que segue sem resposta.
 * A trava compartilhada impede dois cliques de gerar duas respostas. Depois
 * que o agente grava uma resposta, ela própria bloqueia qualquer nova tentativa
 * automática, inclusive se o WhatsApp tiver aceitado antes de um timeout.
 */
export async function recoverPendingAgentReply(
  tenantId: string,
  conversationId: string,
  agentId: string,
): Promise<PendingRecovery> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      leadId: true,
      isTest: true,
      lastInboundAt: true,
      whatsappProvider: true,
      lead: { select: { phone: true, isTest: true } },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, role: true, content: true, audioUrl: true },
      },
    },
  });
  if (!conversation || conversation.isTest || conversation.lead.isTest) return { status: "none" };

  const pending = conversation.messages[0];
  if (!pending || pending.role !== "user") return { status: "none" };
  const phone = conversation.lead.phone;
  if (phone.startsWith("web:") || phone.startsWith("sandbox:")) return { status: "none" };
  if (await isPhoneBlocked(tenantId, phone)) {
    return { status: "failed", error: "Este contato está bloqueado. A mensagem não foi enviada." };
  }

  const channel = await findWhatsappChannel(tenantId, conversation.whatsappProvider);
  if (!channel?.externalId) {
    return { status: "failed", error: "O número desta conversa está desconectado. Reconecte-o antes de responder." };
  }
  if (!agentRepliesOn(channel)) {
    return { status: "failed", error: "O agente não responde por este número. Responda à mão pela conversa." };
  }
  const providerName = channelProvider(channel);
  if (providerName === "meta" && (!conversation.lastInboundAt || Date.now() - conversation.lastInboundAt.getTime() >= 24 * 60 * 60 * 1000)) {
    return { status: "failed", error: "A janela de resposta da Meta terminou. Responda com um template aprovado." };
  }
  if (providerName === "evolution" && (!conversation.lastInboundAt || Date.now() - conversation.lastInboundAt.getTime() >= 7 * 24 * 60 * 60 * 1000)) {
    return { status: "failed", error: "A última mensagem é antiga demais para uma retomada automática." };
  }

  const provider = getWhatsAppProviderForInstance(channel);
  if (!provider.isConfigured()) {
    return { status: "failed", error: "A conexão do WhatsApp precisa ser configurada novamente." };
  }

  const lockKey = `conversation:recover:${tenantId}:${conversationId}:${pending.id}`;
  try {
    if (await redis.set(lockKey, "1", "EX", 300, "NX") !== "OK") {
      return { status: "in_progress" };
    }
  } catch (error) {
    console.error("[conversation recovery] trava indisponível", error);
    return { status: "failed", error: "Não foi possível iniciar a resposta agora. Tente mais tarde." };
  }

  try {
    const latest = await prisma.message.findFirst({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latest?.id !== pending.id) return { status: "none" };

    const agent = await resolveAgent(tenantId, agentId);
    if (!agent?.enabled) {
      return { status: "failed", error: "O agente atribuído não está ativo." };
    }

    const result = await runAgentTurn({
      tenantId,
      conversationId,
      leadId: conversation.leadId,
      agentId,
      userMessage: pending.content,
      existingUserMessageId: pending.id,
      incomingWasAudio: Boolean(pending.audioUrl),
    });
    if (result.status !== "ok" || !result.reply) {
      return { status: "failed", error: "O agente não conseguiu responder agora. A conversa foi sinalizada para a equipe." };
    }

    await sendAgentReply({
      tenantId,
      conversationId,
      phone,
      externalId: channel.externalId,
      provider,
      reply: result.reply,
      replyMessageId: result.replyMessageId,
      incomingWasAudio: Boolean(pending.audioUrl),
      agent,
    });
    await setConversationChannel(conversation, providerName, { onlyIfUnset: true });
    return { status: "sent" };
  } catch (error) {
    console.error("[conversation recovery] falha ao responder mensagem pendente", error);
    await prisma.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { needsHuman: true },
    }).catch(() => {});
    return { status: "failed", error: "A resposta do agente não foi confirmada. Confira o WhatsApp antes de tentar outra ação." };
  }
}
