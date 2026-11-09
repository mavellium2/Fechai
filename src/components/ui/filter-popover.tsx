"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import { dayKeyInZone } from "@/modules/scheduling/time";
import { Button } from "./button";
import { Input } from "./input";
import { SelectMenu } from "./select-menu";

/**
 * Filtro padrão das listas: botão com ícone que abre um cartão, campos
 * declarados por configuração e etiquetas removíveis do que está aplicado.
 *
 * A tela só diz QUAIS filtros quer:
 *
 *   <FilterPopover
 *     fields={[
 *       { type: "select", key: "status", label: "Situação", options: [...] },
 *       { type: "period", from: "from", to: "to", label: "Período" },
 *     ]}
 *     value={filters}
 *     onChange={setFilters}
 *   />
 *
 * Abrir/fechar, clique fora, Esc, foco, "Limpar"/"Aplicar" e as etiquetas
 * moram aqui. Os valores são strings; vazio = sem filtro. Período usa dias
 * `YYYY-MM-DD` no horário de Brasília (quem filtra decide o campo de data).
 */

export type FilterOption = { value: string; label: string };

export type FilterField =
  | {
      type: "select";
      key: string;
      label: string;
      /** A opção de valor `""` é "sem filtro"; se faltar, entra `allLabel`. */
      options: FilterOption[];
      allLabel?: string;
    }
  | {
      type: "period";
      from: string;
      to: string;
      label: string;
      /** Observação sob o campo (ex.: o que fica de fora do filtro). */
      hint?: string;
    };

export type FilterValues = Record<string, string>;

const ZONE = "America/Sao_Paulo";
const DAY = 24 * 60 * 60 * 1000;

const PRESETS: FilterOption[] = [
  { value: "", label: "Qualquer data" },
  { value: "today", label: "Hoje" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Escolher período" },
];

function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const today = dayKeyInZone(now, ZONE);
  const ago = (days: number) => dayKeyInZone(new Date(now.getTime() - days * DAY), ZONE);
  if (preset === "today") return { from: today, to: today };
  if (preset === "7") return { from: ago(6), to: today };
  if (preset === "30") return { from: ago(29), to: today };
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: "", to: "" };
}

function presetOf(from: string, to: string): string {
  if (!from && !to) return "";
  for (const p of ["today", "7", "30", "month"]) {
    const r = presetRange(p);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

const dayLabel = (day: string) => day.split("-").reverse().join("/");

export function periodLabel(from: string, to: string): string {
  const preset = presetOf(from, to);
  if (preset && preset !== "custom") return PRESETS.find((p) => p.value === preset)!.label;
  if (from && to) return from === to ? dayLabel(from) : `${dayLabel(from)} a ${dayLabel(to)}`;
  if (from) return `desde ${dayLabel(from)}`;
  return `até ${dayLabel(to)}`;
}

/** O dia `YYYY-MM-DD` (Brasília) de um instante — para filtrar no cliente. */
export function dayOf(iso: string): string {
  return dayKeyInZone(new Date(iso), ZONE);
}

/** `day` está dentro do período (inclusive)? Período vazio aceita tudo. */
export function inPeriod(day: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}

export function emptyFilters(fields: FilterField[]): FilterValues {
  return Object.fromEntries(
    fields.flatMap((f) => (f.type === "select" ? [[f.key, ""]] : [[f.from, ""], [f.to, ""]])),
  );
}

function selectOptions(field: Extract<FilterField, { type: "select" }>): FilterOption[] {
  return field.options.some((o) => o.value === "")
    ? field.options
    : [{ value: "", label: field.allLabel ?? "Todos" }, ...field.options];
}

export function FilterPopover({
  fields,
  value,
  onChange,
  label = "Filtrar",
  loading,
}: {
  fields: FilterField[];
  value: FilterValues;
  onChange: (next: FilterValues) => void;
  /** Nome do cartão para leitores de tela. */
  label?: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [presets, setPresets] = useState<Record<string, string>>({});
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const active = fields.filter((f) =>
    f.type === "select" ? value[f.key] : value[f.from] || value[f.to],
  ).length;
  const invalid = fields.some(
    (f) => f.type === "period" && draft[f.from] && draft[f.to] && draft[f.from] > draft[f.to],
  );

  function toggle() {
    if (!open) {
      setDraft(value);
      setPresets(
        Object.fromEntries(
          fields.flatMap((f) =>
            f.type === "period" ? [[f.from, presetOf(value[f.from] ?? "", value[f.to] ?? "")]] : [],
          ),
        ),
      );
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function apply(next: FilterValues) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  const chips = fields.flatMap((f) => {
    if (f.type === "select") {
      const option = f.options.find((o) => o.value && o.value === value[f.key]);
      return option
        ? [{ key: f.key, text: option.label.replace(/\s+\d+$/, ""), clear: { [f.key]: "" } }]
        : [];
    }
    const from = value[f.from] ?? "";
    const to = value[f.to] ?? "";
    return from || to
      ? [{ key: f.from, text: periodLabel(from, to), clear: { [f.from]: "", [f.to]: "" } }]
      : [];
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Filtros aplicados">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => onChange({ ...value, ...c.clear })}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-iris/20 px-3 text-xs text-white transition-colors hover:bg-iris/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                aria-label={`Remover filtro: ${c.text}`}
              >
                {c.text}
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={box} className="relative">
        <Button
          ref={trigger}
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          loading={loading && !open}
          onClick={toggle}
        >
          <Filter size={16} aria-hidden />
          Filtros
          {active > 0 && (
            <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-iris px-1 font-mono text-xs text-white">
              {active}
            </span>
          )}
        </Button>
        {open && (
          <div
            id={panelId}
            role="dialog"
            aria-label={label}
            className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-4 rounded-surface border border-white/15 bg-ink p-4 shadow-xl"
          >
            {fields.map((f) => {
              const fieldId = `${panelId}-${f.type === "select" ? f.key : f.from}`;
              if (f.type === "select")
                return (
                  <div key={f.key} className="space-y-2">
                    <span id={fieldId} className="block text-sm text-white/80">
                      {f.label}
                    </span>
                    <SelectMenu
                      label={f.label}
                      labelledBy={fieldId}
                      value={draft[f.key] ?? ""}
                      className="w-full"
                      options={selectOptions(f)}
                      onChange={(next) => setDraft({ ...draft, [f.key]: next })}
                    />
                  </div>
                );
              const preset = presets[f.from] ?? "";
              const from = draft[f.from] ?? "";
              const to = draft[f.to] ?? "";
              return (
                <div key={f.from} className="space-y-2">
                  <span id={fieldId} className="block text-sm text-white/80">
                    {f.label}
                  </span>
                  <SelectMenu
                    label={f.label}
                    labelledBy={fieldId}
                    value={preset}
                    className="w-full"
                    options={PRESETS}
                    onChange={(next) => {
                      setPresets({ ...presets, [f.from]: next });
                      if (next !== "custom") {
                        const r = presetRange(next);
                        setDraft({ ...draft, [f.from]: r.from, [f.to]: r.to });
                      }
                    }}
                  />
                  {preset === "custom" && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs text-white/70">
                        De
                        <Input
                          type="date"
                          className="mt-1"
                          value={from}
                          max={to || undefined}
                          onChange={(e) => setDraft({ ...draft, [f.from]: e.target.value })}
                        />
                      </label>
                      <label className="text-xs text-white/70">
                        Até
                        <Input
                          type="date"
                          className="mt-1"
                          value={to}
                          min={from || undefined}
                          onChange={(e) => setDraft({ ...draft, [f.to]: e.target.value })}
                        />
                      </label>
                    </div>
                  )}
                  {from && to && from > to && (
                    <p className="text-xs text-danger" role="alert">
                      A data inicial precisa ser antes da final.
                    </p>
                  )}
                  {f.hint && <p className="text-xs text-white/50">{f.hint}</p>}
                </div>
              );
            })}
            <div className="flex justify-between gap-2 border-t border-white/10 pt-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={!Object.values(draft).some(Boolean)}
                onClick={() => {
                  setPresets({});
                  apply(emptyFilters(fields));
                }}
              >
                Limpar
              </Button>
              <Button size="sm" disabled={invalid} onClick={() => apply(draft)}>
                Aplicar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
