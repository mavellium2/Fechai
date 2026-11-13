import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PeriodKey } from "@/modules/reports/service";

const PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7", label: "Últimos 7 dias" },
  { key: "30", label: "Últimos 30 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "ano", label: "Ano atual" },
  { key: "tudo", label: "Desde o início" },
];

const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/** "2026-07-01" → "01/07" (ou o próprio texto, se não for data). */
function shortDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return SHORT_DATE.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * Filtro de período em um campo só: um `<details>` com a cara de `<select>`
 * (rótulo + valor + chevron). Abrir mostra os presets e o intervalo
 * personalizado. Tudo nativo — links navegam por querystring, o formulário
 * envia `?de=&ate=`, e nenhum JS é necessário.
 */
export function RangePicker({
  active,
  de,
  ate,
  visao,
  secao,
}: {
  active: PeriodKey | "custom";
  de?: string;
  ate?: string;
  /** Mantém a visão atual (Operacional/Financeiro) ao trocar o período. */
  visao?: string;
  secao?: string;
}) {
  const custom = active === "custom";
  const summaryLabel = custom
    ? ate
      ? `${shortDate(de ?? "")} a ${shortDate(ate)}`
      : `desde ${shortDate(de ?? "")}`
    : (PRESETS.find((p) => p.key === active)?.label ?? "");

  const query = new URLSearchParams();
  if (visao) query.set("visao", visao);
  if (secao) query.set("secao", secao);
  const viewQs = query.size ? `&${query}` : "";

  return (
    <details className="group relative">
      <summary
        className={cn(
          "flex h-10 cursor-pointer list-none select-none items-center gap-2 rounded-control border border-ink/15 bg-white px-3 text-sm transition-colors",
          "hover:border-ink/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
          "panel:border-white/20 panel:bg-white/5 panel:hover:border-white/30",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
          Período
        </span>
        <span className="font-medium text-ink panel:text-white">{summaryLabel}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className="ml-auto text-neutral transition-transform group-open:rotate-180 panel:text-white/60"
        />
      </summary>

      <div className="absolute left-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-surface border border-ink/10 bg-white p-3 shadow-lg panel:border-white/15 panel:bg-ink">
        <p className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
          Período
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-1">
          {PRESETS.map((p) => {
            const on = !custom && p.key === active;
            return (
              <li key={p.key}>
                <Link
                  href={`/relatorios?periodo=${p.key}${viewQs}`}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "block rounded-control px-3 py-2 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                    on
                      ? "bg-iris font-medium text-white"
                      : "text-ink hover:bg-ink/5 panel:text-white/80 panel:hover:bg-white/10 panel:hover:text-white",
                  )}
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 border-t border-ink/10 pt-3 panel:border-white/10">
          <p className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
            Intervalo personalizado
          </p>
          <form method="get" action="/relatorios" className="mt-2 grid grid-cols-2 gap-2">
            {visao && <input type="hidden" name="visao" value={visao} />}
            {secao && <input type="hidden" name="secao" value={secao} />}
            <label className="flex flex-col gap-1">
              <span className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
                De
              </span>
              <Input type="date" name="de" defaultValue={de ?? ""} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
                Até
              </span>
              <Input type="date" name="ate" defaultValue={ate ?? ""} className="h-8 text-xs" />
            </label>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" variant="outline" size="sm" className="flex-1">
                Aplicar intervalo
              </Button>
              {custom && (
                <ButtonLink href={query.size ? `/relatorios?${query}` : "/relatorios"} variant="ghost" size="sm">
                  Limpar
                </ButtonLink>
              )}
            </div>
          </form>
        </div>
      </div>
    </details>
  );
}
