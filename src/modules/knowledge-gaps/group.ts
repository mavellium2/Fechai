import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import { findWhatsappChannel } from "@/modules/whatsapp/instances";

/**
 * Manda um texto ao grupo interno da clínica (o mesmo da transferência e das
 * perguntas sem resposta). Grupo é do número conectado por QR code: a Meta não
 * tem grupos, e sem canal o envio **espera** — nunca troca para outro número.
 *
 * Devolve `false` quando não há por onde enviar; **lança** se o envio falhou,
 * para quem chama decidir (os avisos de perguntas capturam, o relatório
 * semanal registra o motivo).
 */
export async function sendToInternalGroup(tenantId: string, groupId: string, text: string): Promise<boolean> {
  const instance = await findWhatsappChannel(tenantId, "evolution");
  if (!instance?.externalId) return false;
  const provider = getWhatsAppProviderForInstance(instance);
  if (!provider.sendGroupMessage || !provider.isConfigured()) return false;
  await provider.sendGroupMessage(instance.externalId, groupId, text);
  return true;
}
