import { prisma } from "@/lib/prisma";
import { getBroadcastConnection } from "./connection";
import { nextBroadcastTime } from "./schedule";
import { sendBroadcastRecipient } from "./send";
import { reconcileBroadcastReceipts } from "./receipts";
import { dueBroadcastCampaigns } from "./queue";
import { campaignTemplates, templatesStillApproved } from "./template";

async function pauseUnavailable(id: string, tenantId: string, error: string) {
  await prisma.broadcastCampaign.updateMany({
    where: { id, tenantId, status: "queued" },
    data: { status: "paused", pausedAt: new Date(), error },
  });
}
export const broadcastRetryMs = (attempt: number) =>
  Math.min(300_000, 10_000 * 2 ** Math.min(attempt, 5));

export async function scanBroadcasts() {
  const now = new Date();
  await prisma.broadcastRecipient.updateMany({
    where: {
      status: "sending",
      attemptedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
    },
    data: {
      status: "unknown",
      error:
        "Envio interrompido. Confira o WhatsApp antes de enviar novamente.",
    },
  });
  const receipts = await prisma.broadcastReceipt.findMany({
    where: { appliedAt: null },
    orderBy: { receivedAt: "asc" },
    take: 200,
    select: { tenantId: true, messageId: true },
  });
  for (const r of receipts)
    await reconcileBroadcastReceipts(r.tenantId, r.messageId);
  const campaigns = await dueBroadcastCampaigns(now);
  let sent = 0;
  for (const campaign of campaigns) {
    try {
      const next = nextBroadcastTime(campaign);
      await prisma.broadcastCampaign.updateMany({
        where: { id: campaign.id, status: "queued" },
        data: {
          lastProcessedAt: now,
          nextAttemptAt: new Date(
            Math.max(next.getTime(), Date.now() + 10_000),
          ),
        },
      });
      if (next > new Date()) continue;
      const connection = await getBroadcastConnection(campaign.tenantId);
      if (!connection || connection.phoneNumberId !== campaign.phoneNumberId) {
        await pauseUnavailable(
          campaign.id,
          campaign.tenantId,
          "Conexão Meta indisponível ou alterada. Reconecte o mesmo número e retome o disparo.",
        );
        continue;
      }
      const approved = await connection.provider.listBroadcastTemplates({ media: true });
      if (!templatesStillApproved(campaignTemplates(campaign), approved)) {
        await pauseUnavailable(
          campaign.id,
          campaign.tenantId,
          "Template alterado ou sem aprovação. Retome com o template original aprovado, ou prepare outro disparo.",
        );
        continue;
      }
      const recipients = await prisma.broadcastRecipient.findMany({
        where: { campaignId: campaign.id, isTest: false, status: "pending" },
        orderBy: { row: "asc" },
        take: 25,
      });
      for (const recipient of recipients) {
        const allowedAt = nextBroadcastTime(campaign);
        if (allowedAt > new Date()) {
          await prisma.broadcastCampaign.updateMany({
            where: { id: campaign.id, status: "queued" },
            data: { nextAttemptAt: allowedAt },
          });
          break;
        }
        const fresh = await getBroadcastConnection(campaign.tenantId);
        if (!fresh || fresh.phoneNumberId !== campaign.phoneNumberId) {
          await pauseUnavailable(
            campaign.id,
            campaign.tenantId,
            "Conexão Meta interrompida. Os contatos pendentes foram preservados.",
          );
          break;
        }
        if (await sendBroadcastRecipient(campaign, recipient, fresh)) sent++;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const pending = await prisma.broadcastRecipient.count({
        where: {
          campaignId: campaign.id,
          isTest: false,
          status: { in: ["pending", "sending"] },
        },
      });
      await prisma.broadcastCampaign.updateMany({
        where: {
          id: campaign.id,
          tenantId: campaign.tenantId,
          status: "queued",
        },
        data: {
          retryCount: 0,
          error: null,
          ...(!pending ? { status: "completed", finishedAt: new Date() } : {}),
        },
      });
    } catch {
      await prisma.broadcastCampaign
        .updateMany({
          where: {
            id: campaign.id,
            tenantId: campaign.tenantId,
            status: "queued",
          },
          data: {
            retryCount: { increment: 1 },
            nextAttemptAt: new Date(
              Date.now() + broadcastRetryMs(campaign.retryCount),
            ),
            error:
              "Falha temporária ao consultar a Meta ou o banco. Nova tentativa programada.",
          },
        })
        .catch(() => {});
    }
  }
  return { scanned: campaigns.length, sent };
}
