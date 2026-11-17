import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";
import { broadcastPhoneVariants } from "./phone";
import { canRepeatBroadcastAttempt } from "./retry-policy";
import { recentlyContacted } from "./recent";

export function canReviewBroadcastRetry(campaign: { status: string; confirmedAt: Date | string | null }) {
  return Boolean(campaign.confirmedAt) && ["completed", "cancelled"].includes(campaign.status);
}

/** A mesma seleção no painel e na confirmação; a confirmação nunca aceita telefones do cliente. */
export async function loadBroadcastRetry(db: Prisma.TransactionClient, tenantId: string, campaignId: string) {
  const attempts = await db.broadcastRecipient.findMany({
    where: {
      campaignId,
      campaign: { tenantId, confirmedAt: { not: null }, status: { in: ["completed", "cancelled"] } },
      isTest: false,
      retryRecipient: null,
      OR: [{ status: "failed" }, { status: "sent", deliveryStatus: "failed" }],
    },
    orderBy: { id: "asc" },
  });
  const failed = attempts.filter((r) => canRepeatBroadcastAttempt(r));
  if (!failed.length) return { recipients: [], token: "", recentCount: 0 };

  const [blocked, stopped] = await Promise.all([
    db.whatsappBlockedNumber.findMany({
      where: { tenantId, phone: { in: [...new Set(failed.map((r) => canonicalPhone(r.phone)))] } },
      select: { phone: true },
    }),
    db.conversation.findMany({
      where: {
        tenantId, isTest: false, followUpReason: "stop",
        lead: { tenantId, phone: { in: [...new Set(failed.flatMap((r) => broadcastPhoneVariants(r.phone)))] } },
      },
      select: { lead: { select: { phone: true } } },
    }),
  ]);
  const blockedPhones = new Set(blocked.map((r) => r.phone));
  const stoppedPhones = new Set(stopped.flatMap((r) => broadcastPhoneVariants(r.lead.phone)));
  const recipients = failed.filter((r) => !blockedPhones.has(canonicalPhone(r.phone)) && !stoppedPhones.has(r.phone));
  const recent = recipients.length ? await recentlyContacted(tenantId, recipients.map((r) => r.phone), campaignId, db) : [];
  const token = createHash("sha256")
    .update(JSON.stringify([recipients.map((r) => [r.id, r.status, r.error, r.deliveryError, r.deliveryFailedAt]), recent]))
    .digest("hex");
  return { recipients, token, recentCount: recent.length };
}
