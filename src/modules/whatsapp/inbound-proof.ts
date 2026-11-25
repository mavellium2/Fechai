import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isWhatsappProviderName } from "./instances";
import type { IncomingMessage } from "./provider";

export type WhatsappInboundProof = {
  provider: "meta" | "evolution";
  externalId: string;
  sender: string;
  receiver: string | null;
};

export type WhatsappContactInbound = { tenantId: string; at: Date; proof: WhatsappInboundProof };
const isPhone = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{7,14}$/.test(value);

export function contactWhatsappInbound(
  tenantId: string, provider: string, incoming: IncomingMessage, now = new Date(),
): WhatsappContactInbound | undefined {
  if (incoming.isFromMe || incoming.isReaction || incoming.isGroup || !incoming.messageKeyId ||
    !isWhatsappProviderName(provider) || !incoming.instanceExternalId || !isPhone(incoming.fromPhone)) return;
  const occurredAt = incoming.occurredAt;
  const validTime = occurredAt && Number.isFinite(+occurredAt) && +occurredAt <= +now;
  const receiver = provider === "meta" ? (validTime ? incoming.instanceExternalId : null) :
    isPhone(incoming.receiverPhone) ? incoming.receiverPhone : null;
  return { tenantId, at: validTime ? occurredAt : now, proof: {
    provider, receiver, externalId: incoming.instanceExternalId, sender: incoming.fromPhone,
  } };
}

export function parseWhatsappInboundProof(value: Prisma.JsonValue | null): WhatsappInboundProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { provider, receiver, externalId, sender } = value;
  if (!isWhatsappProviderName(provider) || typeof externalId !== "string" || !externalId || !isPhone(sender)) return null;
  if (provider === "evolution" ? !isPhone(receiver) : receiver !== externalId) return null;
  return { provider, externalId, sender, receiver: receiver as string };
}

/** Uma entrada mais antiga não substitui o número pelo qual o contato falou por último. */
export async function recordWhatsappInbound(conversationId: string, { tenantId, at, proof }: WhatsappContactInbound) {
  try {
    await prisma.conversation.updateMany({
      where: { id: conversationId, tenantId, isTest: false, lead: { tenantId, isTest: false },
        OR: [{ whatsappInboundAt: null }, { whatsappInboundAt: { lte: at } }] },
      data: { whatsappInboundAt: at, whatsappInbound: proof },
    });
  } catch {
    console.error("[whatsapp] entrada não confirmada para resposta pelo CRM");
  }
}
