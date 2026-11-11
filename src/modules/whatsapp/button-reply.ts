import { prisma } from "@/lib/prisma";
import { appendMessage } from "@/modules/agent-engine/conversation";
import type { WhatsAppProvider } from "./provider";
export { isBlockButton } from "./block-button";

/**
 * Toque em botão de modelo que pede para parar de receber (`isBlockButton`):
 * marca o pedido, guarda o clique e confirma.
 */
const CONFIRMATION = "Tudo bem! Não vamos mais enviar mensagens por aqui.";

/**
 * Marca o pedido de parar (`followUpReason: "stop"`, a mesma regra que Disparos e
 * follow-up já respeitam), guarda o clique na conversa e confirma. Fica fora do
 * turno do agente: sem LLM e sem cota. **Nunca lança**: na falha devolve
 * `handled: false` e a mensagem segue o atendimento normal.
 */
export async function handleBlockButton(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  externalId: string;
  provider: Pick<WhatsAppProvider, "sendMessage">;
  text: string;
  messageKeyId?: string;
}): Promise<{ handled: boolean }> {
  try {
    const marked = await prisma.conversation.updateMany({
      where: { id: input.conversationId, tenantId: input.tenantId },
      data: { followUpReason: "stop" },
    });
    if (!marked.count) return { handled: false };
    await appendMessage(input.conversationId, "user", input.text, undefined, input.messageKeyId);
    try {
      const id = await input.provider.sendMessage(input.externalId, input.phone, CONFIRMATION);
      await appendMessage(input.conversationId, "assistant", CONFIRMATION, "human", id ?? undefined);
    } catch (err) {
      // O pedido já está registrado; a confirmação é cortesia.
      console.error("[whatsapp] confirmação de bloqueio não enviada", err);
    }
    return { handled: true };
  } catch (err) {
    console.error("[whatsapp] falha ao registrar o botão de bloqueio", err);
    return { handled: false };
  }
}
