import { prisma } from "@/lib/prisma";
import { STOP_CONFIRMATION } from "./capture";
import { numberedPrompt } from "./settings";
import { getSurveySettings } from "./settings-store";

/**
 * A Evolution devolve como `fromMe` tudo que a própria instância enviou. Uma
 * mensagem `fromMe` que não está em `Message.whatsappMessageId` é lida como
 * "a equipe respondeu pelo celular" e **pausa o agente** — e a pesquisa não
 * grava `Message`. Por isso o webhook pergunta aqui antes: este envio é da
 * pesquisa?
 *
 * Dois caminhos, porque o eco pode chegar antes de o id ser gravado (o POST
 * volta depois do webhook): o id conhecido, ou — numa janela curta depois da
 * última movimentação da pesquisa da conversa — o texto idêntico a um dos
 * textos que ela envia. **Nunca lança**: na dúvida devolve `false` e vale o
 * comportamento de antes.
 */

/** Quanto tempo depois de a pesquisa se mexer um eco de texto igual ainda é dela. */
export const ECHO_WINDOW_MS = 60_000;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

export async function isSurveyOutbound(
  tenantId: string,
  conversationId: string,
  keyId: string | undefined,
  text: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    if (keyId) {
      const hit = await prisma.satisfactionSurvey.findFirst({
        where: { tenantId, OR: [{ ratingMsgId: keyId }, { followMsgId: keyId }, { thanksMsgId: keyId }] },
        select: { id: true },
      });
      if (hit) return true;
    }
    const wanted = normalize(text);
    if (!wanted) return false;

    const recent = await prisma.satisfactionSurvey.findFirst({
      where: { tenantId, conversationId, updatedAt: { gte: new Date(now.getTime() - ECHO_WINDOW_MS) } },
      select: { id: true },
    });
    if (!recent) return false;

    const { texts } = await getSurveySettings(tenantId);
    return [numberedPrompt(texts.rating), texts.low, texts.high, texts.thanks, STOP_CONFIRMATION]
      .map(normalize)
      .includes(wanted);
  } catch (err) {
    console.error("[satisfaction] não foi possível conferir o eco", err);
    return false;
  }
}
