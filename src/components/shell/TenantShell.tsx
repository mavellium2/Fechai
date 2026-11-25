"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Pin, PinOff, Settings } from "lucide-react";
import { ShellNav, type NavItem } from "./ShellNav";
import { MobileNav } from "./MobileNav";
import type { UsageNavData } from "./UsageNav";
import { TenantThemeToggle } from "./TenantTheme";
import { Button } from "@/components/ui/button";
import "./tenant-shell.css";

/**
 * O menu abre recolhido em toda página. O ☰ expande só na página atual (volta a
 * recolher ao navegar); o alfinete fixa aberto e é a única escolha guardada.
 * Chave nova de propósito: a antiga ("expandido") deixaria aberto quem só
 * expandiu uma vez. O admin nasce fixado, como era antes.
 */
const PREFERENCES = { tenant: "fechai:tenant-menu-pinned", admin: "fechai:admin-menu-pinned" };
const PREFERENCE_EVENT = "fechai:menu-pinned-change";
const memoryPinned = { tenant: false, admin: true };
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(PREFERENCE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PREFERENCE_EVENT, callback);
  };
}
function pinnedPreference(context: "tenant" | "admin") {
  try {
    const saved = localStorage.getItem(PREFERENCES[context]);
    return saved === null ? context === "admin" : saved === "1";
  } catch { return memoryPinned[context]; }
}

/** Common workspace frame. Providers and analytics remain in PanelShell. */
export function TenantShell({ navItems, brandHref, brandSubtitle, footerLabel, userLabel, usage,
  signOutAction, onSignOut, banner, children, context = "tenant" }: {
  navItems: NavItem[];
  brandHref: string;
  brandSubtitle: string;
  footerLabel: string;
  userLabel: string;
  usage?: UsageNavData | null;
  signOutAction: () => Promise<void>;
  onSignOut: () => void;
  banner?: React.ReactNode;
  children: React.ReactNode;
  context?: "tenant" | "admin";
}) {
  const pinned = useSyncExternalStore(subscribe, () => pinnedPreference(context), () => context === "admin");
  const pathname = usePathname();
  // Aberto "de passagem" vale só até a próxima navegação. Comparar só a rota não
  // basta: sair e voltar para a mesma página reabriria o menu.
  const [open, setOpen] = useState(false);
  const [openPath, setOpenPath] = useState(pathname);
  if (openPath !== pathname) { setOpenPath(pathname); setOpen(false); }
  const expanded = pinned || open;
  const agents = pathname === "/agentes" || pathname.startsWith("/agentes/") || pathname === "/conversas";
  const accountHref = context === "admin" ? brandHref : "/configuracoes";
  const initials = brandSubtitle.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "F";

  function savePinned(next: boolean) {
    memoryPinned[context] = next;
    try { localStorage.setItem(PREFERENCES[context], next ? "1" : "0"); } catch { /* Keep the in-memory preference. */ }
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }

  function toggleMenu() {
    if (pinned) { savePinned(false); setOpen(false); return; }
    setOpen(!expanded);
  }

  function togglePin() {
    // Desafixar deixa aberto até a próxima página, em vez de fechar debaixo do mouse.
    if (pinned) setOpen(true);
    savePinned(!pinned);
  }

  return (
    <div className="tenant-frame">
      <a href="#conteudo" className="tenant-skip">Pular para o conteúdo</a>
      <aside aria-label="Navegação principal" className={`tenant-rail ${expanded ? "tenant-rail-expanded" : ""}`}>
        <div className="tenant-brand">
          <button type="button" onClick={toggleMenu} aria-label={expanded ? "Recolher menu" : "Expandir menu"} aria-expanded={expanded} className="tenant-icon-button">
            <Menu size={20} aria-hidden />
          </button>
          <Link href={brandHref} className="tenant-rail-label tenant-wordmark font-display text-xl font-bold" aria-hidden={!expanded || undefined} tabIndex={expanded ? undefined : -1}>fechai<span className="text-signal">.</span></Link>
          <button type="button" onClick={togglePin} aria-pressed={pinned} aria-label="Fixar menu aberto"
            title={pinned ? "Desafixar menu" : "Fixar menu aberto"} aria-hidden={!expanded || undefined} tabIndex={expanded ? undefined : -1}
            className={`tenant-icon-button tenant-rail-label tenant-pin ${pinned ? "tenant-pin-on" : ""}`}>
            {pinned ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          <ShellNav items={navItems} collapsed={!expanded} variant="tenant" />
        </div>
        <div className="tenant-theme-slot"><TenantThemeToggle compact /></div>
        <details className="tenant-account">
          <summary title={brandSubtitle} aria-label={`Conta: ${brandSubtitle}`}>
            <span className="tenant-avatar">{initials}</span>
            <span className="tenant-rail-label tenant-account-copy" aria-hidden={!expanded || undefined}><span className="block truncate text-xs font-medium">{brandSubtitle}</span><span className="block truncate text-micro text-neutral">{usage ? `${usage.used.toLocaleString("pt-BR")} de ${usage.limit.toLocaleString("pt-BR")} respostas` : footerLabel}</span></span>
          </summary>
          <div className="tenant-account-menu">
            <p className="truncate px-3 py-2 text-xs text-neutral" title={userLabel}>{userLabel}</p>
            {usage && <p className="px-3 pb-2 text-xs text-neutral">{usage.used.toLocaleString("pt-BR")} de {usage.limit.toLocaleString("pt-BR")} respostas{usage.isTrial ? ` · ${usage.trialExpired ? "teste encerrado" : `${usage.trialDaysLeft ?? 0} dias de teste`}` : ""}</p>}
            <Link href={accountHref}><Settings size={16} aria-hidden />{context === "admin" ? "Contas da plataforma" : "Configurações"}</Link>
            <form action={signOutAction} onSubmit={onSignOut} data-leave-page><button type="submit"><LogOut size={16} aria-hidden />Sair da conta</button></form>
          </div>
        </details>
      </aside>
      <div className="tenant-stage">
        {banner}
        <div className="tenant-mobile-header">
          <MobileNav items={navItems} title="fechai" subtitle={brandSubtitle} usage={usage} variant="tenant" themeControl={<TenantThemeToggle />} />
          <Link href={brandHref} className="font-display font-bold">fechai<span className="text-signal">.</span></Link>
          <Link href={accountHref} aria-label={context === "admin" ? "Contas da plataforma" : "Configurações da conta"} className="tenant-avatar">{initials}</Link>
        </div>
        {context === "admin" && <header className="tenant-admin-header">
          <div className="tenant-admin-identity"><span className="tenant-admin-badge">Administração</span><span className="tenant-admin-user" title={userLabel}>{userLabel}</span></div>
          <form action={signOutAction} onSubmit={onSignOut} data-leave-page><Button type="submit" variant="outline" size="sm">Sair</Button></form>
        </header>}
        <main id="conteudo" tabIndex={-1} className={`tenant-main ${agents ? "tenant-main-agents" : "tenant-content"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
