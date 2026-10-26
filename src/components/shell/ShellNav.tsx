"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Building2, CalendarDays, CircleHelp, Cpu, HandCoins, Home, MessageCircle, MessagesSquare, Plug, ScrollText, Send, Settings, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Os `NAV` que alimentam este componente nascem em `layout.tsx` (Server
 * Component). Componentes de ícone do lucide-react não são serializáveis
 * pela fronteira server→client, então o layout manda só o nome (string) e o
 * componente é resolvido aqui, que já é client.
 */
const ICONS = {
  Home,
  Bot,
  MessageCircle,
  MessagesSquare,
  BarChart3,
  CalendarDays,
  Settings,
  Building2,
  Cpu,
  Star,
  Users,
  Plug,
  HandCoins,
  ScrollText,
  Send,
  CircleHelp,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

/**
 * Navegação lateral dos painéis (dashboard e admin) — link ativo com barra
 * signal. `collapsed` é usado só pela sidebar desktop (`Sidebar.tsx`); a
 * gaveta mobile sempre passa o padrão (labels visíveis).
 */
export function ShellNav({
  items,
  onNavigate,
  collapsed,
  variant = "admin",
}: {
  items: NavItem[];
  onNavigate?: () => void;
  collapsed?: boolean;
  variant?: "admin" | "tenant";
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções do painel" className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={cn(
              "relative flex items-center gap-2.5 rounded-control px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
              // /60 é o piso de contraste do branco sobre `ink` para texto
              // pequeno (o /45 anterior ficava em ~3.9:1, abaixo do AA).
              variant === "tenant"
                ? `tenant-nav-link ${active ? "tenant-nav-active" : ""}`
                : active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
              collapsed && variant !== "tenant" && "justify-center px-0",
            )}
          >
            {active && variant !== "tenant" && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-signal"
              />
            )}
            <Icon size={variant === "tenant" ? 20 : 16} className="shrink-0" aria-hidden />
            <span className={variant === "tenant" ? "tenant-nav-label" : collapsed ? "sr-only" : undefined} aria-hidden={variant === "tenant" && collapsed || undefined}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
