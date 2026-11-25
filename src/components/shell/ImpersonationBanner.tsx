"use client";

import { useSyncExternalStore } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stopImpersonation } from "@/app/(admin)/actions";

/**
 * Aviso no topo do dashboard enquanto o superadmin vê o painel de outra
 * conta. Ações do painel (conversas, agente, limite) atuam na conta
 * personificada; o único caminho de volta é o "Voltar ao admin".
 *
 * Dá para recolher, mas nunca sumir: recolhido vira um selo pequeno no rodapé
 * da tela, ainda com o e-mail da conta e o "Voltar ao admin" — esquecer que
 * está agindo como o cliente é o erro que este aviso existe para evitar.
 * A escolha fica guardada (localStorage): volta do jeito que a pessoa deixou.
 */
const KEY = "fechai:impersonation-collapsed";
const EVENT = "fechai:impersonation-collapsed-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
function readCollapsed() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
function setCollapsed(next: boolean) {
  try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* sem storage, segue aberto */ }
  window.dispatchEvent(new Event(EVENT));
}

export function ImpersonationBanner({ email }: { email: string }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  if (collapsed) {
    return (
      <div role="status" className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-signal/40 bg-ink/95 py-1 pl-3 pr-1 text-xs text-white shadow-xl backdrop-blur">
        <Eye size={14} aria-hidden className="shrink-0 text-signal" />
        <span className="min-w-0 truncate">Admin como <span className="font-semibold">{email}</span></span>
        <form action={stopImpersonation} className="shrink-0">
          <button type="submit" className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-medium text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal [&_svg]:text-signal">
            <ArrowLeft size={14} aria-hidden />Voltar ao admin
          </button>
        </form>
        <button type="button" onClick={() => setCollapsed(false)} aria-label="Mostrar aviso de administrador"
          className="shrink-0 rounded-full p-1.5 text-signal hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal">
          <ChevronUp size={14} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="impersonation-banner flex shrink-0 flex-wrap items-center justify-between gap-3 border border-signal/30 bg-signal/10 px-4 py-3 md:px-5">
      <p className="flex min-w-0 items-center gap-2 text-xs leading-relaxed text-ink panel:text-white/85">
        <Eye size={16} aria-hidden className="shrink-0 text-signal-ink panel:text-signal" />
        <span className="min-w-0">
          <span className="impersonation-label">Acesso de administrador</span>
          <span className="impersonation-account">Visualizando como <span className="font-semibold break-all text-ink panel:text-white">{email}</span></span>
        </span>
      </p>
      <div className="flex items-center gap-2">
        <form action={stopImpersonation}>
          <Button variant="action" size="sm" type="submit">
            <ArrowLeft size={16} aria-hidden />Voltar ao admin
          </Button>
        </form>
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(true)} aria-label="Recolher aviso de administrador" title="Recolher aviso">
          <ChevronDown size={16} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
