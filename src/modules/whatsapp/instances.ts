import { prisma } from "@/lib/prisma";
import type { WhatsAppProviderName } from "./index";
import { WHATSAPP_PROVIDER_SELECT, type WhatsappProviderInstance } from "./meta-config";

/**
 * Uma conta pode ter as duas conexões de pé ao mesmo tempo — a Evolution (QR
 * code) e a API oficial da Meta, cada uma com o seu número. Este arquivo é o
 * único lugar que decide **por qual** delas se fala com um contato: quem envia
 * não pergunta "qual é o provedor da conta" (não existe mais uma resposta só),
 * pergunta "por onde este contato fala com a gente".
 *
 * Regra que sustenta tudo: o contato só conhece o número em que escreveu. Sair
 * pelo outro é primeiro contato — no QR isso leva ao bloqueio do número da
 * clínica, e na Meta o texto livre é recusado fora da janela de 24h. Por isso
 * não há "tentar a outra" quando a conexão do contato está fora do ar: o envio
 * automático espera, e o manual mostra o motivo.
 */

/** Linha de conexão com o que os consumidores precisam para escolher e enviar. */
export type WhatsappChannel = WhatsappProviderInstance & { status: string; agentReplies: boolean };

export const WHATSAPP_CHANNEL_SELECT = {
  status: true,
  agentReplies: true,
  ...WHATSAPP_PROVIDER_SELECT,
} as const;

/**
 * O agente pode escrever sozinho por esta conexão? Desligado, o número só
 * recebe (a Meta fica só para Disparos). Linha sem o campo vale como ligada.
 */
export function agentRepliesOn(row: { agentReplies?: boolean | null }): boolean {
  return row.agentReplies !== false;
}

export function isWhatsappProviderName(value: unknown): value is WhatsAppProviderName {
  return value === "evolution" || value === "meta";
}

/**
 * Qual adapter atende a linha. Mesmo critério de `getWhatsAppProviderForInstance`:
 * o que não é `meta` é Evolution (a coluna nasce assim e linhas antigas não a
 * tinham) — escolher por um critério e enviar por outro mandaria a mensagem
 * pelo número errado.
 */
export function channelProvider(row: { provider?: string | null }): WhatsAppProviderName {
  return row.provider === "meta" ? "meta" : "evolution";
}

/** As conexões da conta, no máximo uma por provedor (`@@unique([tenantId, provider])`). */
export async function listWhatsappChannels(tenantId: string): Promise<WhatsappChannel[]> {
  return prisma.whatsappInstance.findMany({
    where: { tenantId },
    select: WHATSAPP_CHANNEL_SELECT,
    orderBy: { provider: "asc" },
  });
}

/** Conectada e com identificador: a linha que existe mas está parada não envia. */
export function isReadyChannel(row: { status: string; externalId: string | null }): boolean {
  return row.status === "connected" && Boolean(row.externalId);
}

/**
 * Escolhe a conexão para falar com um contato.
 *
 * - `preferred` é `Conversation.whatsappProvider` (por onde ele falou por
 *   último). Conexão desse provedor fora do ar devolve `null`: nunca cruza.
 * - Sem `preferred` (conversa antiga, do site, contato recém-cadastrado), vale a
 *   única conexão de pé; com as duas, a Evolution — era a conexão de todas as
 *   contas antes da Meta existir, e é ela que atende a rotina.
 */
export function pickWhatsappChannel<T extends { provider?: string | null; status: string; externalId: string | null }>(
  channels: readonly T[],
  preferred?: string | null,
): T | null {
  const ready = channels.filter(isReadyChannel);
  if (isWhatsappProviderName(preferred)) {
    return ready.find((c) => channelProvider(c) === preferred) ?? null;
  }
  return ready.find((c) => channelProvider(c) === "evolution") ?? ready[0] ?? null;
}

/** Atalho de `listWhatsappChannels` + `pickWhatsappChannel` para quem envia uma mensagem só. */
export async function findWhatsappChannel(
  tenantId: string,
  preferred?: string | null,
): Promise<WhatsappChannel | null> {
  return pickWhatsappChannel(await listWhatsappChannels(tenantId), preferred);
}

export type WhatsappStatus = "connected" | "pending_qr" | "disconnected";

/**
 * O estado da conta quando só cabe uma palavra (início, onboarding, admin):
 * conectada se QUALQUER conexão atende — a outra parada não faz a conta cair.
 */
export function summarizeWhatsappStatus(rows: readonly { status: string }[]): WhatsappStatus {
  if (rows.some((r) => r.status === "connected")) return "connected";
  if (rows.some((r) => r.status === "pending_qr")) return "pending_qr";
  return "disconnected";
}

/** O estado da conta em uma palavra, direto do banco (ver `summarizeWhatsappStatus`). */
export async function getWhatsappStatus(tenantId: string): Promise<WhatsappStatus> {
  return summarizeWhatsappStatus(
    await prisma.whatsappInstance.findMany({ where: { tenantId }, select: { status: true } }),
  );
}

/**
 * Grava por onde a conversa está falando. `onlyIfUnset` é para quem escreve
 * primeiro (Disparos): não pode roubar a conversa de quem já fala pelo QR, mas
 * também não deixa uma conversa nascida na Meta sem dono. **Nunca lança**: é
 * anotação do que já aconteceu, não pode derrubar o atendimento.
 */
export async function setConversationChannel(
  conversation: { id: string; whatsappProvider?: string | null },
  provider: WhatsAppProviderName,
  options: { onlyIfUnset?: boolean } = {},
): Promise<void> {
  if (conversation.whatsappProvider === provider) return;
  if (options.onlyIfUnset && conversation.whatsappProvider) return;
  try {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { whatsappProvider: provider },
    });
  } catch (err) {
    console.error("[whatsapp] não foi possível registrar o canal da conversa", conversation.id, err);
  }
}

/**
 * Conversas anteriores à segunda conexão não dizem por onde falaram
 * (`whatsappProvider` null). Enquanto a conta tinha UMA linha, ela era a
 * resposta certa para todas — então, na hora em que a segunda vai nascer, as
 * conversas sem canal ficam com o provedor da que já existe. Depois disso, quem
 * decide é o próximo contato, pelo webhook.
 *
 * Só age com exatamente uma linha (duas já é o estado novo) e deixa de fora o
 * chat do site (`web:`) e o de teste, que não são WhatsApp. **Nunca lança.**
 */
export async function stampLegacyConversations(tenantId: string): Promise<void> {
  try {
    const rows = await prisma.whatsappInstance.findMany({
      where: { tenantId },
      select: { provider: true },
    });
    if (rows.length !== 1 || !isWhatsappProviderName(rows[0].provider)) return;
    await prisma.conversation.updateMany({
      where: {
        tenantId,
        isTest: false,
        whatsappProvider: null,
        lead: { phone: { not: { startsWith: "web:" } } },
      },
      data: { whatsappProvider: rows[0].provider },
    });
  } catch (err) {
    console.error("[whatsapp] não foi possível marcar as conversas antigas", tenantId, err);
  }
}
