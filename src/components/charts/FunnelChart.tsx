"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChartTooltip } from "./ChartTooltip";

export type FunnelStep = { name: string; count: number };

/**
 * Funil de conversão: barras horizontais em ordem, cada uma proporcional ao
 * primeiro degrau (não ao degrau anterior — assim a queda de um degrau pro
 * outro fica visível como a diferença de largura, não escondida por uma escala
 * que se re-normaliza a cada linha).
 *
 * Categorias aqui têm ordem real (funil = sequência), então usam UM hue só
 * (iris) em opacidade decrescente — rampa ordinal, não a paleta categórica
 * (skill dataviz: "categorical em nominal sem ordem; ordinal em categorias
 * ordenadas" — funil, tiers e faixas etárias são o caso ordinal).
 */
export function FunnelChart({ steps, className }: { steps: FunnelStep[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);

  const first = steps[0]?.count ?? 0;
  if (first === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhuma conversa no período.</p>;
  }

  const summary = steps.map((s, i) => `${s.name}: ${s.count}${i > 0 ? ` (${Math.round((s.count / first) * 100)}%)` : ""}`).join(", ");

  return (
    <div role="img" aria-label={summary} className={cn("space-y-3", className)}>
      {steps.map((step, i) => {
        const pct = first > 0 ? (step.count / first) * 100 : 0;
        const prevCount = i > 0 ? steps[i - 1].count : null;
        const dropPct = prevCount && prevCount > 0 ? Math.round((step.count / prevCount) * 100) : null;
        const opacity = Math.max(0.25, 1 - i * 0.18);

        return (
          <div key={step.name} className="relative">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="text-ink panel:text-white">{step.name}</span>
              <span className="font-mono text-xs tabular-nums text-neutral panel:text-white/55">
                {step.count}
                {dropPct !== null && <span className="ml-1.5">· {dropPct}% do anterior</span>}
              </span>
            </div>
            <button
              type="button"
              tabIndex={0}
              aria-label={`${step.name}: ${step.count}, ${Math.round(pct)}% do primeiro degrau`}
              className="h-6 w-full rounded-control bg-ink/5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris panel:bg-white/10"
              onPointerMove={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <div
                className="h-full rounded-control bg-iris transition-[width]"
                style={{ width: `${Math.min(100, Math.max(2, pct))}%`, opacity }}
              />
            </button>
            {active === i && (
              <ChartTooltip
                left={Math.min(95, Math.max(5, pct / 2))}
                top={-10}
                content={{
                  title: step.name,
                  rows: [
                    { label: "Contagem", value: String(step.count), color: "var(--color-iris)" },
                    { label: "Do primeiro degrau", value: `${Math.round(pct)}%` },
                  ],
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
