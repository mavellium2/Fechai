import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkPendingHint } from "./LinkPendingHint";

const WEEKDAY_HEADERS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Grade do mês.
 *
 * Server Component com links de verdade (`?ano=&mes=&dia=`) em vez de estado no
 * cliente: trocar de mês ou de dia vira URL compartilhável, funciona com o
 * botão voltar do navegador e não manda um calendário inteiro de JavaScript
 * para o navegador.
 *
 * Prefetch em duas medidas. **‹ › e "Hoje" com `prefetch`** completo: o mês
 * vizinho já chega inteiro ao navegador (e fica 5 min no cache do cliente),
 * então trocar de mês não vai ao servidor — é o clique que a pessoa mais faz e
 * o que mais demorava. **Dias com `prefetch={false}`**: a página é dinâmica e
 * sem `loading.js`, e 30 prefetches completos por mês seriam 30 renderizações
 * no servidor; o dia vem rápido do cache do Clinicorp. Nos dois, o retorno
 * imediato do clique é o `LinkPendingHint`.
 *
 * A matemática de calendário usa `Date.UTC` de propósito — aqui são números de
 * calendário (dia 1, 31, quinta-feira), não instantes: usar horário local faria
 * o mês "virar" dependendo do fuso do servidor.
 */
export function CalendarMonth({
  year,
  month,
  selectedDay,
  today,
  countByDay,
  hrefFor,
  busy = false,
}: {
  year: number;
  month: number;
  /** Dia selecionado (1..31) ou null. */
  selectedDay: number | null;
  /** Hoje no fuso do negócio — para destacar o dia corrente. */
  today: { year: number; month: number; day: number };
  /** Quantos compromissos em cada dia, indexado por "AAAA-MM-DD". */
  countByDay: Map<string, number>;
  hrefFor: (params: { year?: number; month?: number; day?: number | null }) => string;
  /** As agendas externas (Clinicorp, Calendário da Apple) ainda estão chegando: as contagens podem subir. */
  busy?: boolean;
}) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  const isCurrentMonth = today.year === year && today.month === month;

  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

  const navClass =
    "relative flex h-8 w-8 items-center justify-center rounded-control font-mono text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        {/* Na mesma linha do título: embaixo dele, sumir o aviso puxaria a grade para cima. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="font-display text-lg font-semibold capitalize text-white">{monthLabel}</h2>
          {busy && (
            <span className="font-mono text-micro uppercase tracking-wider text-white/45 motion-safe:animate-pulse">
              buscando agendas externas…
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!isCurrentMonth && (
            <Link
              href={hrefFor({ year: today.year, month: today.month, day: today.day })}
              prefetch
              className="relative rounded-control px-2.5 py-1 font-mono text-micro uppercase tracking-wider text-iris transition-colors hover:bg-iris/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris"
            >
              Hoje
              <LinkPendingHint />
            </Link>
          )}
          <Link
            href={hrefFor({ ...prev, day: null })}
            prefetch
            className={navClass}
            rel="prev"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={16} aria-hidden />
            <LinkPendingHint />
          </Link>
          <Link
            href={hrefFor({ ...next, day: null })}
            prefetch
            className={navClass}
            rel="next"
            aria-label="Próximo mês"
          >
            <ChevronRight size={16} aria-hidden />
            <LinkPendingHint />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 md:gap-2" role="grid" aria-label={`Calendário de ${monthLabel}`}>
        {WEEKDAY_HEADERS.map((label) => (
          <div
            key={label}
            className="pb-2 text-center font-mono text-xs uppercase tracking-wider text-white/45"
          >
            {label}
          </div>
        ))}

        {/* Casas vazias antes do dia 1 — `aria-hidden` porque não são dias. */}
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`empty-${i}`} aria-hidden className="min-h-[3.75rem] md:min-h-[4.5rem] rounded-control border border-transparent" />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = countByDay.get(key) ?? 0;
          const isToday = today.year === year && today.month === month && today.day === day;
          const isSelected = selectedDay === day;

          return (
            <Link
              key={day}
              href={hrefFor({ year, month, day })}
              prefetch={false}
              aria-current={isSelected ? "date" : undefined}
              aria-label={`${day} de ${monthLabel}${count > 0 ? `, ${count} compromisso(s)` : ", sem compromissos"}`}
              className={cn(
                "group relative flex min-h-[3.75rem] md:min-h-[4.5rem] flex-col justify-between rounded-control border p-2 transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                isSelected
                  ? "border-iris bg-iris/20 text-white shadow-sm ring-1 ring-iris/50"
                  : "border-white/10 text-white/75 hover:border-white/25 hover:bg-white/5 hover:text-white",
                isToday && !isSelected && "border-iris/40 bg-iris/[0.03]",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    isToday ? "font-bold text-iris" : isSelected ? "font-bold text-white" : "text-white/80"
                  )}
                >
                  {day}
                </span>
                {isToday && (
                  <span className="rounded-full bg-iris/25 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-iris">
                    hoje
                  </span>
                )}
              </div>

              {count > 0 ? (
                <div className="mt-1 flex items-center gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-signal/20 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white/90">
                    <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                    {count} {count === 1 ? "marcado" : "marcados"}
                  </span>
                </div>
              ) : (
                <span className="font-mono text-[10px] text-transparent select-none group-hover:text-white/20">
                  livre
                </span>
              )}
              <LinkPendingHint />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
