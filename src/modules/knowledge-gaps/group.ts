import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import { findWhatsappChannel } from "@/modules/whatsapp/instances";

/**
 * Envios internos (a equipe ou a própria pessoa), sempre pelo **número conectado
 * por QR code**: a Meta não tem grupos e recusa texto livre fora das 24h. Sem
 * canal o envio **espera** — nunca troca para outro número.
 *
 * Todos devolvem `false` quando não há por onde enviar e **lançam** se o envio
 * falhou, para quem chama decidir (os avisos de perguntas capturam, o relatório
 * semanal registra o motivo).
 */

/** O QR conectado da conta, ou `null`. Nunca devolve a Meta. */
async function qrChannel(tenantId: string) {
  const instance = await findWhatsappChannel(tenantId, "evolution");
  if (!instance?.externalId) return null;
  const provider = getWhatsAppProviderForInstance(instance);
  return provider.isConfigured() ? { externalId: instance.externalId, provider } : null;
}

/** Manda um texto ao grupo interno da clínica (o mesmo da transferência e das perguntas sem resposta). */
export async function sendToInternalGroup(tenantId: string, groupId: string, text: string): Promise<boolean> {
  const channel = await qrChannel(tenantId);
  if (!channel?.provider.sendGroupMessage) return false;
  await channel.provider.sendGroupMessage(channel.externalId, groupId, text);
  return true;
}

/**
 * Manda um texto a um número interno (o da própria pessoa que recebe os
 * relatórios). Quem chama decide antes se o destino pode ser procurado
 * (bloqueado, "pare", contato da Meta); aqui só se envia.
 */
export async function sendToInternalPhone(tenantId: string, phone: string, text: string): Promise<boolean> {
  const channel = await qrChannel(tenantId);
  if (!channel) return false;
  await channel.provider.sendMessage(channel.externalId, phone, text);
  return true;
}

export type InternalDocument = { base64: string; mimetype: string; fileName: string; caption: string };

/** Manda um arquivo (PDF) ao grupo interno, como documento com legenda. */
export async function sendDocumentToInternalGroup(tenantId: string, groupId: string, document: InternalDocument): Promise<boolean> {
  const channel = await qrChannel(tenantId);
  if (!channel?.provider.sendDocument) return false;
  if (!/^\d[\d-]*@g\.us$/.test(groupId)) throw new Error("ID de grupo inválido.");
  await channel.provider.sendDocument(channel.externalId, groupId, document);
  return true;
}

/** Manda um arquivo (PDF) a um número interno, como documento com legenda. */
export async function sendDocumentToInternalPhone(tenantId: string, phone: string, document: InternalDocument): Promise<boolean> {
  const channel = await qrChannel(tenantId);
  if (!channel?.provider.sendDocument) return false;
  await channel.provider.sendDocument(channel.externalId, phone, document);
  return true;
}
