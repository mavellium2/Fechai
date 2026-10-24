import { prisma } from "@/lib/prisma";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";
import { UNTRANSCRIBED_AUDIO } from "@/modules/voice/received-audio";
import { isLowRating, type SurveySettings } from "./settings";
import { getSurveySettings } from "./settings-store";
import { isOptOutText, parseRating } from "./rating";
import { OPEN_STATUSES, SURVEY_WINDOW_HOURS } from "./eligibility";

/**
 * Captura a resposta do contato à pesquisa, **no webhook, fora do turno do
 * agente**: não chama o LLM, não consome cota, não cria `Message` e não mexe em
 * `lastInboundAt` (ver o comentário de `SatisfactionSurvey`).
 *
 * Retorna `handled: true` quando a mensagem foi da pesquisa — o webhook para
 * aí. Retorna `false` para tudo que não é resposta (o contato escreveu outra
 * coisa): a mensagem segue o atendimento normal, como se a pesquisa nem
 * existisse. **Nunca lança**: na dúvida, `handled: false` e o agente atende.
 */

/** Resposta curta ao "pare" durante a pesquisa. */
export const STOP_CONFIRMATION = "Tudo bem! Não vamos mais enviar mensagens por aqui.";

export type SurveyReplyInput = {
  tenantId: string;
  conversationId: string;
  phone: string;
  /** Instância e provedor do PRÓPRIO webhook: a resposta sai pelo número em que o contato escreveu. */
  externalId: string;
  provider: Pick<WhatsAppProvider, "sendMessage">;
  /** Texto da mensagem (transcrição, no áudio). */
  text: string;
  /** Id da opção escolhida na lista da Meta. */
  replyId?: string;
  /** key.id da mensagem do contato — idempotência da reentrega. */
  messageKeyId?: string;
  hasAudio?: boolean;
  audioUrl?: string | null;
  now?: Date;
};

const COMMENT_MAX = 2000;
const HOUR = 3_600_000;

async function say(input: SurveyReplyInput, text: string): Promise<string | null> {
  try {
    return await input.provider.sendMessage(input.externalId, input.phone, text);
  } catch (err) {
    console.error("[satisfaction] resposta da pesquisa não enviada", err);
    return null;
  }
}

async function note(surveyId: string, data: { followMsgId?: string; thanksMsgId?: string }) {
  await prisma.satisfactionSurvey
    .update({ where: { id: surveyId }, data })
    .catch((e) => console.error("[satisfaction] id da mensagem não registrado", surveyId, e));
}

export async function handleSurveyReply(input: SurveyReplyInput): Promise<{ handled: boolean }> {
  try {
    return await capture(input);
  } catch (err) {
    console.error("[satisfaction] falha ao capturar a resposta", err);
    return { handled: false };
  }
}

async function capture(input: SurveyReplyInput): Promise<{ handled: boolean }> {
  const { tenantId, conversationId, messageKeyId } = input;
  const now = input.now ?? new Date();

  // Uma consulta só para a rotina de TODA mensagem que chega: as pesquisas
  // abertas da conversa e a que já registrou esta mesma mensagem (reentrega).
  const candidates = await prisma.satisfactionSurvey.findMany({
    where: {
      tenantId,
      conversationId,
      OR: [
        { status: { in: [...OPEN_STATUSES] } },
        ...(messageKeyId ? [{ ratingInboundId: messageKeyId }, { commentInboundId: messageKeyId }] : []),
      ],
    },
    orderBy: { sentAt: "desc" },
    take: 3,
    select: { id: true, status: true, sentAt: true, ratedAt: true, ratingInboundId: true, commentInboundId: true },
  });
  // Reentrega do mesmo webhook: já foi capturada, não responde de novo.
  if (messageKeyId && candidates.some((c) => c.ratingInboundId === messageKeyId || c.commentInboundId === messageKeyId)) {
    return { handled: true };
  }
  const survey = candidates.find((c) => (OPEN_STATUSES as readonly string[]).includes(c.status));
  if (!survey) return { handled: false };

  const settings = await getSurveySettings(tenantId);
  const text = (input.text ?? "").trim();

  if (survey.status === "awaiting_comment") {
    const since = survey.ratedAt ?? survey.sentAt;
    if (now.getTime() - since.getTime() > SURVEY_WINDOW_HOURS * HOUR) {
      // A nota ficou sem comentário: encerra, e a mensagem segue o atendimento.
      await prisma.satisfactionSurvey.updateMany({ where: { id: survey.id, status: "awaiting_comment" }, data: { status: "completed" } });
      return { handled: false };
    }
    return captureComment(input, survey.id, text, settings);
  }

  // sending | awaiting_rating
  if (now.getTime() - survey.sentAt.getTime() > SURVEY_WINDOW_HOURS * HOUR) {
    await prisma.satisfactionSurvey.updateMany({ where: { id: survey.id, status: { in: ["sending", "awaiting_rating"] } }, data: { status: "no_reply" } });
    return { handled: false };
  }

  if (isOptOutText(text)) return optOut(input, survey.id);

  const rating = parseRating(text, input.replyId);
  if (rating === null) {
    // Escreveu outra coisa: a pesquisa fica sem resposta e o atendimento segue.
    await prisma.satisfactionSurvey.updateMany({ where: { id: survey.id, status: { in: ["sending", "awaiting_rating"] } }, data: { status: "no_reply" } });
    return { handled: false };
  }

  const claim = await prisma.satisfactionSurvey.updateMany({
    where: { id: survey.id, status: { in: ["sending", "awaiting_rating"] } },
    data: { status: "awaiting_comment", rating, ratedAt: now, ...(messageKeyId ? { ratingInboundId: messageKeyId } : {}) },
  });
  // Outra entrega já registrou a nota: nada a fazer, e o agente também não responde.
  if (!claim.count) return { handled: true };

  const followId = await say(input, isLowRating(rating) ? settings.texts.low : settings.texts.high);
  if (followId) await note(survey.id, { followMsgId: followId });
  return { handled: true };
}

async function captureComment(input: SurveyReplyInput, surveyId: string, text: string, settings: SurveySettings) {
  if (isOptOutText(text)) {
    await prisma.satisfactionSurvey.updateMany({ where: { id: surveyId, status: "awaiting_comment" }, data: { status: "completed" } });
    return optOut(input, surveyId);
  }
  const untranscribed = text === UNTRANSCRIBED_AUDIO;
  const claim = await prisma.satisfactionSurvey.updateMany({
    where: { id: surveyId, status: "awaiting_comment" },
    data: {
      status: "completed",
      comment: !text || untranscribed ? null : text.slice(0, COMMENT_MAX),
      commentAudioUrl: input.hasAudio ? input.audioUrl ?? null : null,
      commentAt: input.now ?? new Date(),
      ...(input.messageKeyId ? { commentInboundId: input.messageKeyId } : {}),
    },
  });
  if (!claim.count) return { handled: true };

  const thanksId = await say(input, settings.texts.thanks);
  if (thanksId) await note(surveyId, { thanksMsgId: thanksId });
  return { handled: true };
}

/** "Pare" durante a pesquisa: regra existente (`followUpReason = stop`) e uma confirmação curta. */
async function optOut(input: SurveyReplyInput, surveyId: string) {
  await prisma.conversation.updateMany({
    where: { id: input.conversationId, tenantId: input.tenantId },
    data: { followUpReason: "stop" },
  });
  await prisma.satisfactionSurvey.updateMany({
    where: { id: surveyId, status: { in: ["sending", "awaiting_rating"] } },
    data: { status: "no_reply" },
  });
  await say(input, STOP_CONFIRMATION);
  return { handled: true };
}
