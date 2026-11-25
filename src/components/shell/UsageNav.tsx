"use client";

import Link from "next/link";
import { Gauge } from "lucide-react";
import { actionFocus } from "@/components/ui/action";
import { cn } from "@/lib/utils";

/**
 * Indicador da cota na navegação: X/Y mensagens do mês, com barra. Leva a
 * /configuracoes, onde o número aparece com contexto. Reusado pela sidebar
 * desktop (com `collapsed`) e pela gaveta mobile.
 *
 * Numa conta em período de teste, a segunda linha mostra os dias restantes —
 * a cota pode estar sobrando e a conta parar mesmo assim, quando o prazo vence.
 *
 * Cores pela proximidade da cota — o mesmo critério do HealthStrip: neutral até
 * 80%, warn depois disso, danger no limite (ou com o teste encerrado).
 */
/**
 * O recorte de `UsageSummary` que a navegação precisa. Vive aqui e é importado
 * por PanelShell/Sidebar/MobileNav — os três só repassam o objeto, e antes cada
 * um redeclarava a forma dele à mão (mudar uma cota exigia editar quatro
 * arquivos e era fácil esquecer um).
 */
export type UsageNavData = {
  /** Respostas da IA neste mês. */
  used: number;
  /** Cota de mensagens do mês. */
  limit: number;
  /** A conta está num plano de teste por tempo (grátis). */
  isTrial?: boolean;
  /** O teste acabou: a IA parou por prazo, não por cota. */
  trialExpired?: boolean;
  /** Dias restantes do teste. */
  trialDaysLeft?: number;
};

export function UsageNav({
  used,
  limit,
  isTrial,
  trialExpired,
  trialDaysLeft,
  collapsed,
  onNavigate,
}: UsageNavData & {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const outOfMessages = used >= limit;
  const stopped = outOfMessages || Boolean(trialExpired);
  const warning = !stopped && used >= limit * 0.8;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;

  const label = `${used.toLocaleString("pt-BR")}/${limit.toLocaleString("pt-BR")} mensagens`;
  const trialLabel = trialExpired
    ? "teste encerrado"
    : isTrial
      ? `teste · ${trialDaysLeft ?? 0} dia${trialDaysLeft === 1 ? "" : "s"}`
      : null;

  const tone = stopped ? "text-danger" : warning ? "text-warn" : "text-ink/65 panel:text-white/60";
  // Ícone de ação é laranja; só o estado (perto do limite/sem mensagens) troca
  // para warn/danger. O rótulo continua neutro fora do estado.
  const iconTone = stopped ? "text-danger" : warning ? "text-warn" : "text-signal-ink panel:text-signal";
  // Estado (perto do limite) mantém warn/danger; o uso normal segue o laranja de ação.
  const fill = stopped ? "bg-danger" : warning ? "bg-warn" : "bg-signal-ink panel:bg-signal";
  const full = [label, trialLabel].filter(Boolean).join(" · ");

  return (
    <Link
      href="/configuracoes"
      onClick={onNavigate}
      title={collapsed ? `Uso: ${full} — ver em Configurações` : full}
      aria-label={`Uso da conta: ${full}`}
      className={cn(
        "flex items-center gap-2.5 rounded-control px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink",
        actionFocus,
        "text-ink panel:text-white hover:bg-ink/5 panel:hover:bg-white/10",
        collapsed && "justify-center px-0",
      )}
    >
      <Gauge size={16} className={cn("shrink-0", iconTone)} aria-hidden />

      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", tone)}>{label}</span>
          <span
            aria-hidden
            className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-ink/10 panel:bg-white/10"
          >
            <span className={cn("block h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
          </span>
          {trialLabel && (
            <span className={cn("mt-1 block truncate", trialExpired ? "text-danger" : "text-ink/50 panel:text-white/40")}>
              {trialLabel}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
