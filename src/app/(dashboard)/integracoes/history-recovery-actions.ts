"use server";

import { requireSuperadmin, requireTenant } from "@/lib/session";
import { requireProductAccess } from "@/lib/require-product";
import { recordAudit } from "@/modules/audit/log";
import { readHistoryRecovery, startHistoryRecovery } from "@/modules/whatsapp/history-recovery";
import type { HistoryRecoveryView } from "@/modules/whatsapp/history-recovery-types";
import { isFrameworkSignal } from "@/components/ui/toast/save-service";

export type HistoryRecoveryResult = { ok: boolean; error?: string; info?: string; run?: HistoryRecoveryView | null } | null;

export async function recoverWhatsappHistory(): Promise<HistoryRecoveryResult> {
  const admin = await requireSuperadmin();
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  try {
    const id = await startHistoryRecovery(tenantId, admin.user.id);
    await recordAudit({ event: "whatsapp.history_recovery_started", tenantId,
      target: { type: "WhatsappHistoryRecovery", id }, meta: { days: 30 } });
    return { ok: true, info: "Recuperação solicitada. Ela continuará mesmo se você fechar esta página.", run: await readHistoryRecovery(tenantId) };
  } catch (error) {
    if (isFrameworkSignal(error)) throw error;
    return { ok: false, error: "Não foi possível iniciar a recuperação. Confira se o WhatsApp por QR está liberado e tente novamente." };
  }
}
