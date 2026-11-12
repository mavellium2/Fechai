import { prisma } from "@/lib/prisma";
import { parseEvolutionReminderReceipts } from "@/modules/whatsapp/reminder-receipts";
import { recordReminderReceipt } from "@/modules/scheduling/reminder-dispatch";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";
import { recordBroadcastResponse } from "@/modules/broadcasts/outcomes";

/** Webhook exclusivo da Evolution. A Cloud API oficial usa `/meta/[tenantId]`. */
const SECRET_HEADER = "x-webhook-secret";

function isAuthorized(req: Request): boolean {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expected) {
    console.error(
      "[whatsapp webhook] WHATSAPP_WEBHOOK_SECRET não configurada — recusando. " +
        "Gere uma com: openssl rand -base64 32",
    );
    return false;
  }
  const received = req.headers.get(SECRET_HEADER) ?? "";
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const receipts = parseEvolutionReminderReceipts(payload);
  for (const receipt of receipts) {
    const instance = await prisma.whatsappInstance.findFirst({ where: { externalId: receipt.instanceExternalId, provider: "evolution" }, select: { tenantId: true } });
    if (instance) await recordReminderReceipt(instance.tenantId, "evolution", receipt.messageId, receipt.status, new Date());
  }
  const provider = getWhatsAppProvider("evolution");
  const incoming = provider.parseWebhook(payload);
  if (!incoming) return NextResponse.json({ ignored: true });

  const result = await processIncomingWhatsapp(incoming, provider);
  // Com a Meta só para Disparos, a resposta é registrada unicamente pelo QR.
  // A atribuição continua usando a mensagem persistida e a mesma regra de 7 dias.
  if ((result.status ?? 200) < 400 && !incoming.isFromMe &&
      !incoming.isReaction && !incoming.isGroup && incoming.messageKeyId) {
    const instance = await prisma.whatsappInstance.findFirst({
      where: { externalId: incoming.instanceExternalId, provider: "evolution" },
      select: { tenantId: true },
    });
    if (instance) await recordBroadcastResponse(
      instance.tenantId, incoming.fromPhone, incoming.messageKeyId, incoming.occurredAt,
    );
  }
  return NextResponse.json(result.body, { status: result.status ?? 200 });
}
