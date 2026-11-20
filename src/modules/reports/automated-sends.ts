import { prisma } from "@/lib/prisma";
import type { ContextEvent } from "./contact-context";

type SentMessage = { id: string; conversationId: string; role: string; createdAt: Date; whatsappMessageId?: string | null };
/** A operação é gravada perto do envio; a folga cobre fila, retentativa e fuso. */
const MARGIN_MS = 2 * 24 * 3600_000;

/**
 * Lembretes e disparos reconhecidos pelo id do WhatsApp que a própria operação
 * guardou (`ReminderDispatch.messageId`, `BroadcastRecipient.whatsappMessageId`),
 * nunca pelo texto. Cobre o que o registro de finalidade (`ReportEvent`) não
 * cobre: envios anteriores a ele e o eco que chegou ao webhook antes de o worker
 * gravar a mensagem, que ficava como "a equipe escreveu". Devolve eventos no
 * mesmo formato dos de finalidade, um por mensagem. Só leitura, só ids; falha
 * devolve [] e o relatório segue com os registros que já tem.
 */
export async function loadAutomatedSendEvents(tenantId: string, messages: readonly SentMessage[], from: Date | null, toExcl: Date): Promise<ContextEvent[]> {
  const byKey = new Map<string, SentMessage>();
  for (const m of messages) if (m.role === "assistant" && m.whatsappMessageId) byKey.set(m.whatsappMessageId, m);
  if (!byKey.size) return [];
  const window = { ...(from ? { gte: new Date(+from - MARGIN_MS) } : {}), lt: new Date(+toExcl + MARGIN_MS) };
  try {
    const [reminders, broadcasts] = await Promise.all([
      prisma.reminderDispatch.findMany({
        where: { tenantId, messageId: { not: null }, OR: [{ acceptedAt: window }, { claimedAt: window }, { createdAt: window }] },
        select: { messageId: true },
      }),
      prisma.broadcastRecipient.findMany({
        where: { campaign: { tenantId }, whatsappMessageId: { not: null }, sentAt: window },
        select: { whatsappMessageId: true },
      }),
    ]);
    const events: ContextEvent[] = [];
    const add = (key: string | null, kind: ContextEvent["kind"]) => {
      const message = key ? byKey.get(key) : undefined;
      if (!message) return;
      byKey.delete(key!);
      events.push({ kind, conversationId: message.conversationId, messageId: message.id, createdAt: message.createdAt });
    };
    for (const r of reminders) add(r.messageId, "contact_reminder");
    for (const b of broadcasts) add(b.whatsappMessageId, "contact_campaign");
    return events;
  } catch {
    console.error("[reports] envios automáticos não conferidos");
    return [];
  }
}
