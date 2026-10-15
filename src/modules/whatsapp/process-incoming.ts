import { prisma } from "@/lib/prisma";
import { recordReportEvent } from "@/modules/reports/events";
import { rateLimit } from "@/lib/rate-limit";
import {
  appendMessage,
  getOrCreateConversation,
} from "@/modules/agent-engine/conversation";
import { notifyHandoffGroup } from "@/modules/agent-engine/handoff";
import {
  resolveAgent,
  runAgentTurn,
} from "@/modules/agent-engine/orchestrator";
import { transcribeAudio } from "@/modules/ai/transcribe";
import { storeVoiceMessage } from "@/modules/voice/storage";
import { audioDurationSeconds, UNTRANSCRIBED_AUDIO } from "@/modules/voice/received-audio";
import { isPhoneBlocked } from "./blocklist";
import { agentRepliesOn, isWhatsappProviderName, setConversationChannel } from "./instances";
import type { IncomingMessage, WhatsAppProvider } from "./provider";
import { shouldPauseAgentForReaction } from "./reactions";
import { sendAgentReply } from "./send-agent-reply";

export type IncomingWebhookResult = {
  body: Record<string, unknown>;
  status?: number;
};
const ok = (body: Record<string, unknown>): IncomingWebhookResult => ({ body });

async function receiveAudio(input: {
  incoming: IncomingMessage;
  provider: WhatsAppProvider;
  tenantId: string;
  conversationId: string;
  transcribe: boolean;
}): Promise<{ audioUrl: string | null; transcript: string | null; seconds: number | null }> {
  const { incoming, provider, tenantId, conversationId } = input;
  // A Evolution já informa a duração; a Meta não, e ela sai do arquivo baixado.
  let seconds = incoming.audioSeconds ?? null;
  const mediaKey = incoming.mediaId ?? incoming.messageKeyId;
  if (!mediaKey) return { audioUrl: null, transcript: null, seconds };

  let audioUrl: string | null = null;
  try {
    const { base64, mime } = await provider.getMediaAsBase64(
      incoming.instanceExternalId,
      mediaKey,
    );
    const audio = Buffer.from(base64, "base64");
    if (audio.length === 0) throw new Error("áudio vazio");
    seconds ??= audioDurationSeconds(audio);
    audioUrl = await storeVoiceMessage({
      tenantId,
      conversationId,
      audio,
      mime,
    });
    const transcript = input.transcribe
      ? await transcribeAudio(base64, mime)
      : null;
    return { audioUrl, transcript, seconds };
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar áudio", err);
    return { audioUrl, transcript: null, seconds };
  }
}

/** Fluxo comum depois que cada provedor autenticou e converteu seu webhook. */
export async function processIncomingWhatsapp(
  incoming: IncomingMessage,
  provider: WhatsAppProvider,
): Promise<IncomingWebhookResult> {
  const instance = await prisma.whatsappInstance.findFirst({
    where: { externalId: incoming.instanceExternalId, provider: provider.name },
    select: {
      tenantId: true,
      status: true,
      agentReplies: true,
      tenant: { select: { whatsappIgnoreGroups: true } },
    },
  });
  if (!instance || (instance.status && instance.status !== "connected")) {
    return ok({ ignored: "instância desconhecida ou desconectada" });
  }

  if (incoming.isGroup && instance.tenant?.whatsappIgnoreGroups)
    return ok({ ignored: "grupo" });
  const tenantId = instance.tenantId;
  if (
    !incoming.isGroup &&
    (await isPhoneBlocked(tenantId, incoming.fromPhone))
  ) {
    return ok({ ignored: "número bloqueado" });
  }

  // Reentrega de lote não consome a proteção de rajada dos eventos ainda novos.
  if (!incoming.isReaction && incoming.messageKeyId) {
    const existing = await prisma.message.findUnique({
      where: { whatsappMessageId: incoming.messageKeyId },
      select: { id: true },
    });
    if (existing) return ok({ ok: true, silent: "mensagem já registrada" });
  }

  const rateKey = `${provider.name}:${incoming.instanceExternalId}`;
  const burst = await rateLimit("whatsapp:instance", rateKey, 120, 60);
  if (!burst.allowed) {
    console.warn(
      `[whatsapp webhook] limite de taxa atingido na instância ${rateKey}`,
    );
    return provider.name === "meta"
      ? { body: { error: "limite de taxa" }, status: 429 }
      : ok({ ignored: "limite de taxa" });
  }

  // Com as duas conexões de pé, a conversa lembra por qual o contato fala: é
  // desse número que saem a resposta manual, o follow-up e o lembrete.
  const trackChannel = (conversation: { id: string; whatsappProvider?: string | null }) =>
    isWhatsappProviderName(provider.name)
      ? setConversationChannel(conversation, provider.name)
      : Promise.resolve();

  if (incoming.isFromMe) {
    if (incoming.isGroup) {
      return ok({ ok: true, silent: "fromMe ignorado" });
    }

    if (incoming.isReaction) {
      const existing = await prisma.lead.findFirst({
        where: { tenantId, phone: incoming.fromPhone },
        select: { conversation: { select: { agentId: true } } },
      });
      const reactionAgent = await resolveAgent(tenantId, existing?.conversation?.agentId ?? undefined);
      if (
        reactionAgent &&
        shouldPauseAgentForReaction({
          isReaction: incoming.isReaction,
          isFromMe: incoming.isFromMe,
          stopOnEmoji: reactionAgent.stopOnEmoji,
        })
      ) {
        const { lead, conversation } = await getOrCreateConversation(
          tenantId,
          incoming.fromPhone,
          incoming.fromName,
        );
        await trackChannel(conversation);
        await prisma.conversation
          .update({
            where: { id: conversation.id },
            data: { agentPaused: true, needsHuman: true },
          })
          .catch(() => {});
        await notifyHandoffGroup(tenantId, reactionAgent.id, conversation.id, {
          isTest: lead.isTest,
          reason: "Atendente assumiu a conversa por reação no WhatsApp.",
        });
        await recordReportEvent({ tenantId, conversationId: conversation.id, kind: "handoff",
          sourceKey: incoming.messageKeyId });
      }
      return ok({ ok: true, silent: "reação do atendente" });
    }

    // Respostas geradas pelo app também voltam como fromMe. Deduplicar antes
    // de baixar a mídia evita outro upload e outra bolha no histórico.
    if (incoming.messageKeyId) {
      const echo = await prisma.message.findUnique({
        where: { whatsappMessageId: incoming.messageKeyId },
        select: { id: true },
      });
      if (echo) return ok({ ok: true, silent: "fromMe eco" });
    }

    const { conversation } = await getOrCreateConversation(
      tenantId,
      incoming.fromPhone,
      incoming.fromName,
    );
    if (!incoming.hasAudio) {
      const recentEcho = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          role: "assistant",
          sentBy: "agent",
          content: incoming.text,
          createdAt: { gte: new Date(Date.now() - 15_000) },
        },
        select: { id: true },
      });
      if (recentEcho) return ok({ ok: true, silent: "fromMe eco" });
    }
    // Depois dos ecos: só o atendente escrevendo pelo próprio celular muda o canal.
    await trackChannel(conversation);

    const received = incoming.hasAudio
      ? await receiveAudio({
          incoming,
          provider,
          tenantId,
          conversationId: conversation.id,
          transcribe: true,
        })
      : null;

    await appendMessage(
      conversation.id,
      "assistant",
      received?.transcript ?? (incoming.hasAudio ? UNTRANSCRIBED_AUDIO : incoming.text),
      "human",
      incoming.messageKeyId,
      received?.audioUrl,
      received?.seconds,
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needsHuman: false, agentPaused: true },
    });
    return ok({ ok: true, silent: "manual pelo whatsapp" });
  }

  if (incoming.isReaction) return ok({ ok: true, silent: "reação do cliente" });

  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    incoming.fromPhone,
    incoming.fromName,
  );
  await trackChannel(conversation);
  const agent = await resolveAgent(tenantId, conversation.agentId ?? undefined);
  if (incoming.messageKeyId) {
    const existing = await prisma.message.findUnique({
      where: { whatsappMessageId: incoming.messageKeyId },
      select: { id: true },
    });
    if (existing) return ok({ ok: true, silent: "mensagem já registrada" });
  }
  const received = incoming.hasAudio
    ? await receiveAudio({
        incoming,
        provider,
        tenantId,
        conversationId: conversation.id,
        transcribe: Boolean(agent?.listenAudio),
      })
    : null;
  const userMessage =
    received?.transcript ?? (incoming.hasAudio ? UNTRANSCRIBED_AUDIO : incoming.text);
  // Número só de recebimento (ex.: Meta usada só para Disparos): a mensagem
  // entra em Conversas para a equipe e o agente não é chamado nem cobrado.
  if (!agentRepliesOn(instance)) {
    await appendMessage(
      conversation.id,
      "user",
      userMessage,
      undefined,
      incoming.messageKeyId,
      received?.audioUrl,
      received?.seconds,
    );
    return ok({ ok: true, silent: "agente não responde neste número" });
  }
  if (incoming.hasAudio && (!agent?.listenAudio || !received?.transcript)) {
    await appendMessage(
      conversation.id,
      "user",
      userMessage,
      undefined,
      incoming.messageKeyId,
      received?.audioUrl,
      received?.seconds,
    );
    return ok({
      ok: true,
      silent: agent?.listenAudio
        ? "áudio sem transcrição"
        : "áudio: opção desligada",
    });
  }
  try {
    const { reply, status, replyMessageId } = await runAgentTurn({
      tenantId,
      conversationId: conversation.id,
      leadId: lead.id,
      agentId: conversation.agentId ?? undefined,
      userMessage,
      incomingWasAudio: incoming.hasAudio,
      incomingAudioUrl: received?.audioUrl,
      incomingAudioSeconds: received?.seconds,
      incomingMessageKeyId: incoming.messageKeyId,
    });
    if (status !== "ok" || !reply) return ok({ ok: true, silent: status });

    await sendAgentReply({
      tenantId,
      conversationId: conversation.id,
      phone: incoming.fromPhone,
      externalId: incoming.instanceExternalId,
      provider,
      reply,
      replyMessageId,
      incomingWasAudio: incoming.hasAudio,
      agent,
    });
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar turno", err);
    return { body: { error: "falha" }, status: 500 };
  }

  return ok({ ok: true });
}
