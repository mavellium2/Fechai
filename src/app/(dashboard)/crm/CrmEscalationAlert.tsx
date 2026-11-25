"use client";

import { useSyncExternalStore } from "react";
import { Alert } from "@/components/ui/alert";

/**
 * Aviso de esperas escalonadas (CRM-10) com X. Fechar vale para a contagem que
 * estava na tela: se mais um lead passar do prazo, o aviso volta, porque é uma
 * situação nova. Lembrado na aba (sessionStorage), não para sempre.
 */
const KEY = "fechai:crm-escalation-dismissed";
const EVENT = "fechai:crm-escalation-dismissed-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
function dismissedCount() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function CrmEscalationAlert({ count, children }: { count: number; children: React.ReactNode }) {
  const dismissed = useSyncExternalStore(subscribe, dismissedCount, () => null);
  if (dismissed === String(count)) return null;
  return (
    <Alert tone="warn" onDismiss={() => {
      try { sessionStorage.setItem(KEY, String(count)); } catch { /* fecha só nesta renderização */ }
      window.dispatchEvent(new Event(EVENT));
    }}>
      {children}
    </Alert>
  );
}
