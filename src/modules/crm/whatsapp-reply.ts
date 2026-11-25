import { prisma } from "@/lib/prisma";
import { outsideMetaWindow } from "@/modules/scheduling/meta-reminder";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";
import { contactPhoneAliases } from "@/modules/whatsapp/contact-phone";
import { parseWhatsappInboundProof } from "@/modules/whatsapp/inbound-proof";
import { agentRepliesOn, findWhatsappChannel } from "@/modules/whatsapp/instances";
import { realBoardLeads } from "./lead-scope";

export const crmReplyPaused = {
  unavailable: "Esta conversa está indisponível no CRM.",
  stopped: "O contato está bloqueado ou pediu para parar de receber mensagens.",
  no_inbound: "A resposta fica disponível quando o contato escrever para um número conectado.",
  window_closed: "A janela de 24 horas da Meta terminou. Para retomar o contato, use um modelo aprovado.",
  connection: "Reconecte o mesmo número em Integrações para responder.",
};

/** Lido na ficha e repetido imediatamente pelo fluxo de envio. */
export async function crmWhatsappReplyTarget(tenantId: string, leadId: string, conversationId: string, now = new Date()) {
  const lead = await prisma.lead.findFirst({
    where: { ...realBoardLeads(tenantId), id: leadId, conversation: { is: { id: conversationId, tenantId, isTest: false } } },
    select: { phone: true, tenant: { select: { metaWhatsappEnabled: true } }, conversation: { select: {
      id: true, isTest: true, whatsappProvider: true, followUpReason: true, whatsappInboundAt: true, whatsappInbound: true,
    } } },
  });
  if (!lead?.conversation) return { status: "unavailable", templates: false } as const;
  const conversation = lead.conversation;
  const templates = lead.tenant.metaWhatsappEnabled;
  if (conversation.followUpReason === "stop") return { status: "stopped", templates: false } as const;
  const blocked = await prisma.whatsappBlockedNumber.findUnique({
    where: { tenantId_phone: { tenantId, phone: canonicalPhone(lead.phone) } }, select: { id: true },
  });
  if (blocked) return { status: "stopped", templates: false } as const;
  const proof = parseWhatsappInboundProof(conversation.whatsappInbound);
  // Também filtra números sem evidência (widget, histórico importado ou criação manual).
  if (!proof || !conversation.whatsappInboundAt || !contactPhoneAliases(lead.phone).includes(proof.sender)) {
    return { status: "no_inbound", templates } as const;
  }
  if (proof.provider === "meta" && outsideMetaWindow(conversation.whatsappInboundAt, now)) {
    return { status: "window_closed", templates } as const;
  }
  const channel = await findWhatsappChannel(tenantId, proof.provider);
  if (!channel || channel.externalId !== proof.externalId ||
    (proof.provider === "meta" && (!templates || !agentRepliesOn(channel) || (channel.metaPhoneNumberId ?? channel.externalId) !== proof.receiver))) {
    return { status: "connection", templates } as const;
  }
  return { status: "ready", templates, conversation, channel, proof, at: conversation.whatsappInboundAt } as const;
}
