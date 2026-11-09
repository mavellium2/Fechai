import { prisma } from "@/lib/prisma";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";

/** Erro gravado no destinatário pulado por bloqueio (ver `send.ts`). */
export const BLOCKED_SKIP_ERROR = "Número bloqueado na conta.";

/**
 * Desbloquear um número devolve à fila os destinatários pulados por bloqueio
 * em disparos ainda em andamento (na fila ou pausados). É seguro: "ignorado"
 * nunca chegou à Meta, então não há envio a repetir. Disparo concluído ou
 * cancelado fica como estava — o histórico mostra o que valia na hora.
 *
 * Nunca lança: desbloquear não pode falhar por causa dos Disparos.
 */
export async function reopenUnblockedRecipients(
  tenantId: string,
  canonical: string,
): Promise<number> {
  try {
    const skipped = await prisma.broadcastRecipient.findMany({
      where: {
        status: "skipped",
        error: BLOCKED_SKIP_ERROR,
        isTest: false,
        campaign: { tenantId, status: { in: ["queued", "paused"] } },
      },
      select: { id: true, phone: true },
    });
    const ids = skipped
      .filter((r) => canonicalPhone(r.phone) === canonical)
      .map((r) => r.id);
    if (!ids.length) return 0;
    const { count } = await prisma.broadcastRecipient.updateMany({
      where: { id: { in: ids }, status: "skipped" },
      data: { status: "pending", error: null },
    });
    return count;
  } catch (error) {
    console.error("[broadcasts] falha ao reabrir contatos desbloqueados", error);
    return 0;
  }
}
