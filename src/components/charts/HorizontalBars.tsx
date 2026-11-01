"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChartTooltip } from "./ChartTooltip";

export type HorizontalBarPoint = { key: string; label: string; value: number; secondaryLabel?: string; colorClass?: string };

/**
 * Barras horizontais para uma lista rankeada (magnitude, uma série): tempo até
 * resposta por faixa, retorno por agente. Sequencial de um hue só (skill
 * dataviz: magnitude → sequencial, não categórica — aqui usado como hue único
 * em vez de rampa, já que cada barra é seu próprio rótulo direto).
 */
export function HorizontalBars({
  points,
  formatValue = String,
  empty,
  colorClass = "bg-iris",
}: {
  points: HorizontalBarPoint[];
  formatValue?: (v: number) => string;
  empty: string;
  colorClass?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const total = points.reduce((s, p) => s + p.value, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">{empty}</p>;
  }

  const max = Math.max(1, ...points.map((p) => p.value));

  return (
    <ul className="space-y-2.5">
      {points.map((p, i) => (
        <li key={p.key} className="relative">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-ink panel:text-white">{p.label}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-neutral panel:text-white/55">
              {formatValue(p.value)}
              {p.secondaryLabel && <span className="ml-1.5">· {p.secondaryLabel}</span>}
            </span>
          </div>
          <button
            type="button"
            tabIndex={0}
            aria-label={`${p.label}: ${formatValue(p.value)}`}
            className="h-2 w-full rounded-full bg-ink/5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris panel:bg-white/10"
            onPointerMove={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <div className={cn("h-full rounded-full transition-[width]", p.colorClass ?? colorClass)} style={{ width: `${Math.max(2, (p.value / max) * 100)}%` }} />
          </button>
          {active === i && (
            <ChartTooltip
              left={Math.min(90, Math.max(10, (p.value / max) * 50))}
              top={-8}
              content={{ title: p.label, rows: [{ label: "Valor", value: formatValue(p.value) }] }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
