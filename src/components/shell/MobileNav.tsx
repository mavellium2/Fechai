"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShellNav, type NavItem } from "./ShellNav";
import { UsageNav, type UsageNavData } from "./UsageNav";

/**
 * Navegação do painel no celular.
 *
 * A barra lateral era `hidden md:flex` e nada a substituía abaixo de 768px:
 * quem abrisse o painel no celular ficava preso na primeira tela, sem nenhuma
 * forma de trocar de seção. Esta gaveta é a versão mobile da mesma `ShellNav`.
 *
 * `<dialog showModal()>` de novo pelo mesmo motivo do ConfirmButton: foco preso,
 * Esc e devolução de foco vêm do navegador.
 */
export function MobileNav({
  items,
  title,
  subtitle,
  usage,
  variant = "admin",
  themeControl,
}: {
  items: NavItem[];
  title: string;
  subtitle?: string;
  /** Uso de conversas do mês; sem ele, o indicador não aparece na gaveta. */
  usage?: UsageNavData | null;
  variant?: "admin" | "tenant";
  themeControl?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  // Fecha ao navegar — sem isto a gaveta fica por cima da página nova.
  useEffect(() => {
    ref.current?.close();
  }, [pathname]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Abrir menu de navegação"
        onClick={() => ref.current?.showModal()}
      >
        <Menu size={18} aria-hidden />
      </Button>

      <dialog
        ref={ref}
        aria-label="Menu de navegação"
        className={`mr-auto ml-0 h-full max-h-none w-64 max-w-[85vw] border-r p-0 backdrop:bg-ink/70 md:hidden ${variant === "tenant" ? "tenant-mobile-nav border-ink/10 bg-white text-ink" : "border-white/10 bg-ink"}`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-2 px-5 pb-5 pt-5">
            <div className="min-w-0">
              <p className="font-display text-lg font-bold text-white">
                {title}
                <span className="text-signal">.</span>
              </p>
              {subtitle && (
                <p className="mt-1 truncate font-mono text-micro uppercase tracking-[0.2em] text-white/55">
                  {subtitle}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Fechar menu"
              onClick={() => ref.current?.close()}
            >
              <X size={18} aria-hidden />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-3">
            <ShellNav items={items} variant={variant} onNavigate={() => ref.current?.close()} />
            {usage && (
              <div className="mt-1 border-t border-white/10 pt-3">
                <UsageNav
                  {...usage}
                  onNavigate={() => ref.current?.close()}
                />
              </div>
            )}
          </div>
          {themeControl && <div className="tenant-mobile-theme">{themeControl}</div>}
        </div>
      </dialog>
    </>
  );
}
