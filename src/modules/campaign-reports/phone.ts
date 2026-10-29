import { prisma } from "@/lib/prisma";
import { isPhoneBlocked } from "@/modules/whatsapp/blocklist";
import { contactPhoneAliases } from "@/modules/whatsapp/contact-phone";

/**
 * O relatório pode ser mandado a este número pelo QR code da clínica? Não, se ele
 * é de um contato que a clínica não pode procurar por aqui:
 * - **bloqueado** na conta;
 * - pediu para **parar** (`followUpReason: "stop"`);
 * - fala com a clínica pela **API oficial da Meta**: "por onde falar com um
 *   contato é o número em que ele escreveu", e pelo QR seria primeiro contato.
 *
 * Quem digita o próprio celular, que nunca foi contato, passa. Nunca lança: na
 * dúvida de leitura o envio é recusado (o inverso do bloqueio no webhook), porque
 * aqui o erro é mandar mensagem a quem não deve.
 */
export async function isPhoneRefused(tenantId: string, phone: string): Promise<boolean> {
  try {
    if (await isPhoneBlocked(tenantId, phone)) return true;
    const conversations = await prisma.conversation.findMany({
      where: { tenantId, isTest: false, lead: { phone: { in: contactPhoneAliases(phone) } } },
      select: { whatsappProvider: true, followUpReason: true },
    });
    return conversations.some((c) => c.followUpReason === "stop" || c.whatsappProvider === "meta");
  } catch (err) {
    console.error("[campanhas] não foi possível conferir o número do destino", err);
    return true;
  }
}
