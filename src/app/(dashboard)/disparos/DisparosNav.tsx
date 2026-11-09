"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/disparos", label: "Disparos", match: (p: string) => !p.startsWith("/disparos/modelos") },
  { href: "/disparos/modelos", label: "Modelos de mensagem", match: (p: string) => p.startsWith("/disparos/modelos") },
];

/**
 * Cabeçalho da área: um título e duas abas. Disparos e modelos são coisas
 * diferentes (enviar × escrever o texto que a Meta aprova), mas vivem juntos.
 */
export function DisparosNav({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname() ?? "/disparos";
  return (
    <header className="flex flex-col gap-3 border-b border-white/10 lg:flex-row lg:items-end lg:justify-between">
      {/* As abas já dizem onde a pessoa está; o título fica só para leitor de tela. */}
      <h1 className="sr-only">Disparos</h1>
      <nav aria-label="Seções de Disparos" className="-mb-px flex shrink-0 gap-6 overflow-x-auto">
        {TABS.map((tab) => {
          const on = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 pb-3 pt-1 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                on
                  ? "border-iris text-white"
                  : "border-transparent text-white/55 hover:border-white/25 hover:text-white",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {/* Ações da tela na mesma faixa das abas: menos altura antes do conteúdo. */}
      {actions && <div className="min-w-0 pb-3 lg:flex-1">{actions}</div>}
    </header>
  );
}
