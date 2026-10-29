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

/**
 * Manda um texto a um número interno (o da própria pessoa que recebe os
 * relatórios). Sai pelo **número conectado por QR code** e nunca pela Meta: texto
 * livre fora das 24h é recusado lá. Sem canal, o envio **espera** — nunca troca
 * de número. Quem chama decide antes se o destino pode ser procurado (bloqueado,
 * "pare", contato da Meta); aqui só se envia.
 *
 * Devolve `false` quando não há por onde enviar; **lança** se o envio falhou.
 */
export async function sendToInternalPhone(tenantId: string, phone: string, text: string): Promise<boolean> {
  const instance = await findWhatsappChannel(tenantId, "evolution");
  if (!instance?.externalId) return false;
  const provider = getWhatsAppProviderForInstance(instance);
  if (!provider.isConfigured()) return false;
  await provider.sendMessage(instance.externalId, phone, text);
  return true;
}
