import { recordMessageContext } from "@/modules/reports/contact-context-events";
import type { BroadcastCampaign, BroadcastRecipient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";
import { MetaBroadcastRejected } from "@/modules/whatsapp/meta";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { setConversationChannel } from "@/modules/whatsapp/instances";
import { getBroadcastConnection } from "./connection";
import { broadcastPhoneVariants } from "./phone";
import { reconcileBroadcastReceipts } from "./receipts";
import { BLOCKED_SKIP_ERROR } from "./unblock";
import { recipientTemplate } from "./template";

/** O mesmo caminho protegido atende o worker e o botão explícito de teste. */
export async function sendBroadcastRecipient(
  campaign: BroadcastCampaign,
  recipient: BroadcastRecipient,
  connection: NonNullable<Awaited<ReturnType<typeof getBroadcastConnection>>>,
) {
  const campaignStatus = recipient.isTest ? "draft" : "queued";
  const scope = {
    id: recipient.id,
    status: "pending",
    campaign: { tenantId: campaign.tenantId, status: campaignStatus },
  };
  const [blocked, stopped] = await Promise.all([
    prisma.whatsappBlockedNumber.findUnique({
      where: {
        tenantId_phone: {
          tenantId: campaign.tenantId,
          phone: canonicalPhone(recipient.phone),
        },
      },
      select: { id: true },
    }),
    prisma.conversation.findFirst({
      where: {
        tenantId: campaign.tenantId,
        isTest: false,
        lead: { phone: { in: broadcastPhoneVariants(recipient.phone) } },
        followUpReason: "stop",
      },
      select: { id: true },
    }),
  ]);
  if (blocked || stopped) {
    await prisma.broadcastRecipient.updateMany({
      where: scope,
      data: {
        status: "skipped",
        error: blocked
          ? BLOCKED_SKIP_ERROR
          : "Contato pediu para não receber mensagens.",
      },
    });
    return false;
  }
  const template = recipientTemplate(campaign, recipient);
  // Mensagem com mídia sem arquivo nunca chega à Meta: recusa antes do claim.
  if (template.mediaFormat && !recipient.mediaUrl) {
    await prisma.broadcastRecipient.updateMany({
      where: scope,
      data: {
        status: "failed",
        error: "Falta o arquivo do topo da mensagem. Nenhuma mensagem foi enviada.",
      },
    });
    return false;
  }
  const claim = await prisma.broadcastRecipient.updateMany({
    where: scope,
    data: { status: "sending", attemptedAt: new Date() },
  });
  if (!claim.count) return false;
  let requestStarted = false;
  try {
    const { lead, conversation } = await getOrCreateConversation(
      campaign.tenantId,
      recipient.phone,
      recipient.name ?? undefined,
    );
    // Contato novo, vindo só do Disparo: a conversa é da Meta desde já, senão
    // uma resposta manual antes de ele escrever sairia pelo QR — primeiro
    // contato. Quem já fala por outro número continua nele: o template não
    // abre a janela da Meta, e a conversa só muda quando o contato responder.
    await setConversationChannel(conversation, "meta", { onlyIfUnset: true });
    const current = await prisma.broadcastCampaign.findFirst({
      where: { id: campaign.id, tenantId: campaign.tenantId },
      select: { status: true },
    });
    const fresh = await getBroadcastConnection(campaign.tenantId);
    if (
      current?.status !== campaignStatus ||
      !fresh ||
      fresh.phoneNumberId !== connection.phoneNumberId
    ) {
      await prisma.broadcastRecipient.updateMany({
        where: { id: recipient.id, status: "sending" },
        data: {
          status:
            current?.status === "cancelled" || recipient.isTest
              ? "cancelled"
              : "pending",
          attemptedAt: null,
        },
      });
      return false;
    }
    await prisma.broadcastRecipient.update({
      where: { id: recipient.id },
      data: { conversationId: conversation.id, leadStatusAtSend: lead.status },
    });
    requestStarted = true;
    const messageId = await fresh.provider.sendBroadcastTemplate(
      recipient.phone,
      template,
      recipient.parameters as string[],
      recipient.mediaUrl
        ? { link: recipient.mediaUrl, filename: recipient.mediaFilename }
        : null,
    );
    const saved = await prisma.$transaction([
      prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          whatsappMessageId: messageId,
        },
      }),
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          sentBy: "human",
          content: recipient.content,
          whatsappMessageId: messageId,
        },
      }),
    ]);
    await recordMessageContext(campaign.tenantId, saved?.[1]?.id, "contact_campaign");
    await reconcileBroadcastReceipts(campaign.tenantId, messageId).catch(
      () => {},
    );
    return true;
  } catch (error) {
    const rejected = error instanceof MetaBroadcastRejected;
    await prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, status: "sending" },
      data: {
        status: !requestStarted || rejected ? "failed" : "unknown",
        error: rejected
          ? error.message
          : requestStarted
            ? "Resultado incerto. Confira o WhatsApp antes de enviar novamente."
            : "Falha ao preparar a conversa. Nenhuma mensagem foi enviada.",
      },
    });
    return false;
  }
}
