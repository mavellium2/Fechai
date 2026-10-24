import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isPhoneBlocked } from "@/modules/whatsapp/blocklist";
import { agentRepliesOn, channelProvider, findWhatsappChannel } from "@/modules/whatsapp/instances";
import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import { RATING_ROWS, numberedPrompt, type SurveySettings } from "./settings";

/**
 * Envia a primeira mensagem da pesquisa (a pergunta da nota). Segue a regra de
 * `knowledge-gaps/resume.ts` e dos Disparos:
 *
 * - **Claim antes do POST**: a linha `sending` é criada antes de falar com o
 *   WhatsApp. Erro ou timeout vira `unknown` e **nunca é repetido** — a mensagem
 *   pode ter saído antes do erro, e duas perguntas seguidas são pior do que
 *   nenhuma.
 * - **Pelo número do contato** (`Conversation.whatsappProvider`): com o número
 *   dele fora do ar, o envio espera (`waiting`), nunca troca para o outro —
 *   pelo QR seria primeiro contato; pela Meta, texto livre fora das 24h é recusado.
 * - **Nada vira `Message`**: a pesquisa mora em `SatisfactionSurvey`, para não
 *   mexer em `lastInboundAt`, na contagem de contatos atendidos nem na esteira
 *   de follow-up.
 */

export const RATING_BUTTON = "Avaliar";

export type SendSurveyResult =
  | { status: "sent" | "unknown"; surveyId: string }
  | { status: "waiting"; reason: string }
  | { status: "skipped"; reason: string };

/** Registro de qual texto saiu: hash curto dos quatro textos efetivos. */
export function surveyTextHash(settings: SurveySettings): string {
  const t = settings.texts;
  return createHash("sha256").update([t.rating, t.low, t.high, t.thanks].join("\u0000")).digest("hex").slice(0, 16);
}

export async function sendSurvey(input: {
  tenantId: string;
  conversationId: string;
  settings: SurveySettings;
  /** Envio de teste: grava `isTest`, ignora a regra de quem recebe. */
  isTest?: boolean;
}): Promise<SendSurveyResult> {
  const { tenantId, conversationId, settings } = input;
  const isTest = input.isTest === true;

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true, agentId: true, isTest: true, needsHuman: true, agentPaused: true,
      followUpReason: true, whatsappProvider: true,
      lead: { select: { phone: true, isTest: true } },
    },
  });
  if (!conv) return { status: "skipped", reason: "Conversa não encontrada." };

  // Reconfere o que pode ter mudado entre a varredura e o envio. Pedido para
  // parar e número bloqueado valem também para o envio de teste: a clínica não
  // escreve a quem pediu para não receber.
  if (conv.followUpReason === "stop") return { status: "skipped", reason: "O contato pediu para não receber mensagens." };
  if (await isPhoneBlocked(tenantId, conv.lead.phone)) return { status: "skipped", reason: "Número bloqueado na conta." };
  if (!isTest) {
    if (conv.isTest || conv.lead.isTest) return { status: "skipped", reason: "Conversa de teste." };
    if (conv.needsHuman || conv.agentPaused) return { status: "skipped", reason: "A conversa está com a equipe." };
  }
  // Sem canal gravado a escolha cairia no QR, e para quem nunca escreveu por ele
  // seria primeiro contato (bloqueio do número da clínica).
  if (!conv.whatsappProvider) return { status: "skipped", reason: "Não sabemos por qual número este contato fala com a clínica." };

  const instance = await findWhatsappChannel(tenantId, conv.whatsappProvider);
  if (!instance?.externalId) return { status: "waiting", reason: "O número deste contato está fora do ar." };
  if (!agentRepliesOn(instance)) return { status: "waiting", reason: "O agente não responde neste número." };
  const provider = getWhatsAppProviderForInstance(instance);
  if (!provider.isConfigured()) return { status: "waiting", reason: "A conexão do WhatsApp não está utilizável." };
  const channel = channelProvider(instance);

  // Claim: a linha existe antes do POST. Duas varreduras não mandam duas vezes
  // porque a segunda enxerga a pesquisa aberta (`hasOpenSurvey`).
  const survey = await prisma.satisfactionSurvey.create({
    data: {
      tenantId,
      conversationId,
      agentId: conv.agentId,
      provider: channel,
      isTest,
      status: "sending",
      textHash: surveyTextHash(settings),
    },
    select: { id: true },
  });

  let keyId: string | null;
  try {
    if (channel === "meta" && provider.sendRatingPrompt) {
      keyId = await provider.sendRatingPrompt(instance.externalId, conv.lead.phone, {
        body: settings.texts.rating,
        button: RATING_BUTTON,
        rows: RATING_ROWS,
      });
    } else {
      keyId = await provider.sendMessage(instance.externalId, conv.lead.phone, numberedPrompt(settings.texts.rating));
    }
  } catch (err) {
    console.error("[satisfaction] envio sem confirmação", survey.id, err);
    await prisma.satisfactionSurvey
      .update({ where: { id: survey.id }, data: { status: "unknown" } })
      .catch((e) => console.error("[satisfaction] não foi possível marcar como sem confirmação", survey.id, e));
    return { status: "unknown", surveyId: survey.id };
  }

  // Falhar aqui não desfaz o envio: a linha fica `sending` e a captura ainda
  // aceita a nota assim. A limpeza do worker a vira `unknown` depois de 10 min,
  // e só nesse intervalo a nota pode ser capturada.
  await prisma.satisfactionSurvey
    .update({
      where: { id: survey.id },
      data: { status: "awaiting_rating", ...(keyId ? { ratingMsgId: keyId } : {}) },
    })
    .catch((e) => console.error("[satisfaction] pesquisa enviada, mas não registrada", survey.id, e));
  return { status: "sent", surveyId: survey.id };
}
