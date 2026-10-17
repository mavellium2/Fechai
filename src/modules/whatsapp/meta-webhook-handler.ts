import { recordReminderReceipt } from "@/modules/scheduling/reminder-dispatch";
import {
  getWhatsAppProviderForInstance,
  type WhatsappProviderInstance,
} from "./meta-config";
import { processIncomingWhatsapp } from "./process-incoming";
import { parseMetaMessages, parseMetaStatuses } from "./meta-events";
import { receiveBroadcastReceipt } from "@/modules/broadcasts/receipts";
import { recordBroadcastResponse } from "@/modules/broadcasts/outcomes";

/** Chamado somente depois de autenticar a assinatura e determinar o tenant. */
export async function handleMetaWebhook(
  tenantId: string,
  instance: WhatsappProviderInstance & { status: string },
  payload: unknown,
) {
  const provider = getWhatsAppProviderForInstance(instance);
  let failed = false;
  const receipts = parseMetaStatuses(payload).filter(
    (r) => r.phoneNumberId === instance.metaPhoneNumberId,
  );
  for (const receipt of receipts) {
    try {
      await receiveBroadcastReceipt(tenantId, receipt);
      await recordReminderReceipt(
        tenantId,
        "meta",
        receipt.messageId,
        receipt.status,
        receipt.occurredAt,
      );
    } catch {
      failed = true;
    }
  }
  const messages =
    instance.status === "connected"
      ? parseMetaMessages(payload).filter(
          (m) => m.instanceExternalId === instance.metaPhoneNumberId,
        )
      : [];
  for (const incoming of messages) {
    try {
      const result = await processIncomingWhatsapp(incoming, provider);
      if ((result.status ?? 200) >= 400) failed = true;
      else if (
        !incoming.isFromMe &&
        !incoming.isReaction &&
        incoming.messageKeyId
      )
        await recordBroadcastResponse(
          tenantId,
          incoming.fromPhone,
          incoming.messageKeyId,
          incoming.occurredAt,
        );
    } catch {
      failed = true;
    }
  }
  return { ok: !failed, messages: messages.length, receipts: receipts.length };
}
