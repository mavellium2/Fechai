import { prisma } from "@/lib/prisma";
import { moveLeadToStage } from "@/modules/crm/automatic-stage";
import { recordReportEvent } from "@/modules/reports/events";
import { rateLimit } from "@/lib/rate-limit";
import {
  appendMessage,
  getOrCreateConversation,
} from "@/modules/agent-engine/conversation";
import { notifyHandoffGroup } from "@/modules/agent-engine/handoff";
import { closeHandoffNoticesTimed, markHandoffFirstReply } from "@/modules/agent-engine/handoff-notice";
import { recordCrmTrail, secondsBetween } from "@/modules/crm/trail";
import {
  resolveAgent,
  runAgentTurn,
} from "@/modules/agent-engine/orchestrator";
import { transcribeAudio } from "@/modules/ai/transcribe";
import { storeVoiceMessage } from "@/modules/voice/storage";
import { audioDurationSeconds, UNTRANSCRIBED_AUDIO } from "@/modules/voice/received-audio";
import { isPhoneBlocked } from "./blocklist";
import { agentRepliesOn, isWhatsappProviderName, setConversationChannel } from "./instances";
import { contactWhatsappInbound } from "./inbound-proof";
import type { IncomingMessage, WhatsAppProvider } from "./provider";
import { shouldPauseAgentForReaction } from "./reactions";
import { sendAgentReply } from "./send-agent-reply";
import { handleSurveyReply } from "@/modules/satisfaction/capture";
import { handleBlockButton, isBlockButton } from "./button-reply";
import { isSurveyOutbound } from "@/modules/satisfaction/echo";
import { isOwnReminderEcho } from "./automated-echo";
import { recordLeadAdOrigin } from "@/modules/campaign-reports/record";
import { handleHandoffGroupEvent } from "@/modules/crm/handoff-group";
import { reflectHandoffInGroup, teamMemberName } from "@/modules/crm/handoff-panel";
import { phoneReplyGroupText } from "@/modules/crm/phone-reply";
import { handleTeamLinkCommand } from "@/modules/crm/team-whatsapp-command";
import { learnTeamMemberLid } from "@/modules/crm/team-whatsapp";

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
      tenant: { select: { whatsappIgnoreGroups: true, evolutionWhatsappEnabled: true } },
    },
  });
  if (!instance || (instance.status && instance.status !== "connected")) {
    return ok({ ignored: "instância desconhecida ou desconectada" });
  }
  // QR desligado pelo admin: a sessão segue de pé no provedor e ainda entrega
  // eventos. 200 `ignored`, como o resto — erro faria a Evolution reentregar.
  if (provider.name === "evolution" && instance.tenant?.evolutionWhatsappEnabled === false) {
    return ok({ ignored: "whatsapp por QR desligado pelo administrador" });
  }

  const tenantId = instance.tenantId;
  if (
    !incoming.isGroup &&
    (await isPhoneBlocked(tenantId, incoming.fromPhone))
  ) {
    return ok({ ignored: "número bloqueado" });
  }
  // `#vincular CÓDIGO` da equipe (CRM-05) vem antes de "ignorar grupos": essa
  // regra é sobre o agente responder em grupo, não sobre ler um comando. O
  // comando nunca abre conversa nem cadastro.
  if ((await handleTeamLinkCommand({ tenantId, incoming, provider })).handled) {
    return ok({ ok: true, silent: "whatsapp da equipe" });
  }
  // Evento de grupo com o número e o LID de quem escreveu ensina o LID de quem
  // é da equipe (nunca lança). Só número já confirmado é atualizado.
  if (incoming.isGroup && incoming.groupSender?.phone && incoming.groupSender.lid) {
    await learnTeamMemberLid(tenantId, incoming.groupSender.phone, incoming.groupSender.lid);
  }
  // Grupo de transbordo (CRM-08): "assumo"/👍/"#ia" no aviso. Antes de
  // "ignorar grupos" pelo mesmo motivo do `#vincular`, e sempre calado para o
  // agente: nada desse grupo vira conversa, cadastro ou turno.
  if ((await handleHandoffGroupEvent({ tenantId, incoming, provider })).handled) {
    return ok({ ok: true, silent: "grupo de transbordo" });
  }
  if (incoming.isGroup && instance.tenant?.whatsappIgnoreGroups)
    return ok({ ignored: "grupo" });

  // Reentrega de lote não consome a proteção de rajada dos eventos ainda novos.
  if (!incoming.isReaction && incoming.messageKeyId) {
    const existing = await prisma.message.findUnique({
      where: { whatsappMessageId: incoming.messageKeyId },
      select: { id: true },
    });
    if (existing) return ok({ ok: true, silent: "mensagem já registrada" });
  }

  // Meta só para Disparos não é uma segunda entrada do atendimento. O mesmo
  // número pode estar no QR e os ids dos dois provedores não coincidem.
  // Interromper antes de mídia, conversa e canal também evita que um eco da
  // Meta pause o agente ou tome o atendimento do QR.
  if (provider.name === "meta" && !agentRepliesOn(instance)) {
    // O pedido explícito para parar precisa valer mesmo sem importar conversas.
    if (!incoming.isFromMe && !incoming.isReaction && !incoming.isGroup &&
        incoming.viaButton && isBlockButton(incoming.text)) {
      const { conversation } = await getOrCreateConversation(
        tenantId, incoming.fromPhone, incoming.fromName,
      );
      const blocked = await handleBlockButton({
        tenantId, conversationId: conversation.id, phone: incoming.fromPhone,
        externalId: incoming.instanceExternalId, provider,
        text: incoming.text, messageKeyId: incoming.messageKeyId,
      });
      return blocked.handled
        ? ok({ ok: true, silent: "pediu para parar (botão)" })
        : { body: { error: "falha ao registrar pedido para parar" }, status: 500 };
    }
    return ok({ ok: true, ignored: "Meta somente para disparos" });
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
        const at = new Date();
        const marked = await prisma.conversation
          .update({
            where: { id: conversation.id },
            data: { agentPaused: true, needsHuman: true },
          })
          .catch(() => null);
        if (marked && !lead.isTest) {
          await moveLeadToStage(tenantId, lead.id, "waiting_human", "user", {
            reason: "handoff", conversationId: conversation.id, key: incoming.messageKeyId ?? undefined, at,
          });
        }
        await notifyHandoffGroup(tenantId, reactionAgent.id, conversation.id, {
          isTest: lead.isTest,
          reason: "Atendente assumiu a conversa por reação no WhatsApp.",
          trigger: "reaction",
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
    // Lembrete enviado pela conta cujo histórico o worker ainda não gravou:
    // não é a equipe escrevendo e não pausa o agente (nem cria cadastro).
    if (await isOwnReminderEcho(tenantId, incoming.messageKeyId)) {
      return ok({ ok: true, silent: "fromMe eco" });
    }

    const { conversation } = await getOrCreateConversation(
      tenantId,
      incoming.fromPhone,
      incoming.fromName,
      incoming.isGroup ? undefined : { originChannel: "manual" },
    );
    // O que a pesquisa de satisfação envia não é `Message`: sem este
    // reconhecimento o eco viraria "atendente respondeu pelo celular" e
    // pausaria o agente.
    if (await isSurveyOutbound(tenantId, conversation.id, incoming.messageKeyId, incoming.text)) {
      return ok({ ok: true, silent: "pesquisa de satisfação" });
    }
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

    // CRM-09: o número é da clínica e compartilhado, então a mensagem não diz
    // quem digitou. Com responsável na conversa, a resposta é dele; sem, fica
    // "humano não identificado" até alguém se identificar (card ou grupo).
    const responsible = conversation.isTest ? null : conversation.assignedUserId ?? null;
    const sent = await appendMessage(
      conversation.id,
      "assistant",
      received?.transcript ?? (incoming.hasAudio ? UNTRANSCRIBED_AUDIO : incoming.text),
      "human",
      incoming.messageKeyId,
      received?.audioUrl,
      received?.seconds,
      undefined,
      { via: "phone", userId: responsible },
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needsHuman: false, agentPaused: true },
    });
    // Alguém da equipe respondeu pelo celular: a espera acabou.
    const repliedAt = sent?.createdAt ?? new Date();
    const wait = await closeHandoffNoticesTimed(tenantId, conversation.id, { status: "assumed", via: "phone", userId: responsible }, repliedAt);
    const closed = wait.closed;
    if (!conversation.isTest) {
      await markHandoffFirstReply(tenantId, conversation.id, repliedAt);
      // Trilha (CRM-11): a resposta que encerrou a espera é a assunção pelo celular.
      if (closed > 0) {
        await recordCrmTrail({
          tenantId, event: "handoff.assumed", actor: { kind: "phone", userId: responsible }, leadId: conversation.leadId,
          meta: { via: "phone", action: "reply", conversationId: conversation.id, waitSeconds: secondsBetween(wait.since, repliedAt) },
        });
      }
      await moveLeadToStage(tenantId, null, "human", "user", { reason: "human_reply", conversationId: conversation.id,
        key: incoming.messageKeyId ?? sent?.id, at: sent?.createdAt });
      // O grupo foi avisado deste transbordo: fica sabendo da resposta e, sem
      // responsável, é perguntado quem foi. Só na resposta que encerrou a espera.
      if (closed > 0) {
        await reflectHandoffInGroup(tenantId, conversation.id, responsible
          ? phoneReplyGroupText.known(await teamMemberName(tenantId, responsible))
          : phoneReplyGroupText.unknown());
      }
    }
    return ok({ ok: true, silent: "manual pelo whatsapp" });
  }

  if (incoming.isReaction) return ok({ ok: true, silent: "reação do cliente" });

  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    incoming.fromPhone,
    incoming.fromName,
    incoming.isGroup ? undefined : {
      originChannel: incoming.adOrigin ? "ad" : provider.name === "meta" ? "whatsapp_meta" : "whatsapp_qr",
    },
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
  // De qual anúncio o contato veio (nunca lança; o primeiro anúncio do lead vence).
  if (incoming.adOrigin && !incoming.isGroup && !lead.isTest) {
    await recordLeadAdOrigin({
      tenantId,
      leadId: lead.id,
      origin: incoming.adOrigin,
      at: incoming.occurredAt ?? new Date(),
      via: "webhook",
    });
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
  // Resposta à pesquisa de satisfação (nota ou comentário): fica FORA do turno
  // — sem LLM, sem cota, sem `Message` e sem mexer em `lastInboundAt`. Quem
  // escreve outra coisa não é capturado e segue o atendimento normal.
  const survey = await handleSurveyReply({
    tenantId,
    conversationId: conversation.id,
    phone: incoming.fromPhone,
    externalId: incoming.instanceExternalId,
    provider,
    text: userMessage,
    replyId: incoming.replyId,
    messageKeyId: incoming.messageKeyId,
    hasAudio: incoming.hasAudio,
    audioUrl: received?.audioUrl,
  });
  if (survey.handled) return ok({ ok: true, silent: "pesquisa de satisfação" });

  // Toque em "Bloquear" (botão do modelo): pedido de parar, fora do turno do agente.
  if (incoming.viaButton && !incoming.isGroup && isBlockButton(userMessage)) {
    const blocked = await handleBlockButton({
      tenantId,
      conversationId: conversation.id,
      phone: incoming.fromPhone,
      externalId: incoming.instanceExternalId,
      provider,
      text: userMessage,
      messageKeyId: incoming.messageKeyId,
    });
    if (blocked.handled) return ok({ ok: true, silent: "pediu para parar (botão)" });
  }

  // QR com resposta automática desligada ainda registra o atendimento humano.
  // A Meta somente para Disparos foi interrompida antes de abrir a conversa.
  const whatsappInbound = contactWhatsappInbound(tenantId, provider.name, incoming);
  if (!agentRepliesOn(instance)) {
    await appendMessage(
      conversation.id,
      "user",
      userMessage,
      undefined,
      incoming.messageKeyId,
      received?.audioUrl,
      received?.seconds,
      whatsappInbound,
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
      whatsappInbound,
    );
    return ok({
      ok: true,
      silent: agent?.listenAudio
        ? "áudio sem transcrição"
        : "áudio: opção desligada",
    });
  }
  try {
    const { reply, status, replyMessageId, media } = await runAgentTurn({
      tenantId,
      conversationId: conversation.id,
      leadId: lead.id,
      agentId: conversation.agentId ?? undefined,
      userMessage,
      incomingWasAudio: incoming.hasAudio,
      incomingAudioUrl: received?.audioUrl,
      incomingAudioSeconds: received?.seconds,
      incomingMessageKeyId: incoming.messageKeyId,
      whatsappInbound,
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
      media,
    });
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar turno", err);
    return { body: { error: "falha" }, status: 500 };
  }

  return ok({ ok: true });
}
