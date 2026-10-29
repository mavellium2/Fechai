"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type RadioCardOption = {
  value: string;
  label: string;
  /** Linha secundária dentro do cartão — opcional, use só quando ajuda. */
  hint?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
};

/**
 * Grupo de opções em cartões clicáveis — a alternativa ao `<select>` quando a
 * lista é curta (até ~6 itens) e as opções merecem ser vistas de uma vez, sem
 * abrir um menu. Em listas longas (UF, segmento) o `<Select>` nativo continua
 * sendo a escolha certa: entrega busca por digitação e o seletor do sistema no
 * mobile, que isto aqui não teria.
 *
 * Por baixo são `<input type="radio">` de verdade dentro de um `<fieldset>`:
 * teclado (setas), leitores de tela e o `FormData` do formulário funcionam sem
 * nenhum código extra — o cartão é só o `<label>` estilizado.
 */
export function RadioCards({
  name,
  options,
  value,
  onChange,
  columns = 2,
  required,
  className,
}: {
  name: string;
  options: readonly RadioCardOption[];
  value?: string;
  onChange?: (value: string) => void;
  columns?: 1 | 2 | 3;
  required?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        className,
      )}
    >
      {options.map((o) => {
        const selected = value === o.value;
        const Icon = o.icon;
        return (
          <label
            key={o.value}
            className={cn(
              "group relative flex cursor-pointer items-center gap-2.5 rounded-control border px-3 py-2.5 text-sm transition-all",
              // o anel de foco vem do input escondido, via peer-focus-visible
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-iris has-[:focus-visible]:ring-offset-1",
              // `panel:` = painel escuro: sem isso o cartão ficava branco com texto claro.
              selected
                ? "border-iris bg-iris/5 text-ink panel:bg-iris/15 panel:text-white"
                : "border-ink/15 bg-white text-neutral hover:border-ink/30 hover:text-ink panel:border-white/15 panel:bg-white/5 panel:text-white/70 panel:hover:border-white/30 panel:hover:text-white",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              required={required}
              onChange={() => onChange?.(o.value)}
              className="sr-only"
            />

            {Icon ? (
              <Icon
                size={16}
                className={cn("shrink-0 transition-colors", selected ? "text-iris" : "text-neutral panel:text-white/55")}
                aria-hidden
              />
            ) : null}

            <span className="min-w-0 flex-1">
              <span className={cn("block truncate", selected && "font-medium")}>{o.label}</span>
              {o.hint && <span className="block truncate text-xs text-neutral panel:text-white/55">{o.hint}</span>}
            </span>

            {/* o check confirma a escolha sem depender só da cor da borda */}
            <Check
              size={14}
              strokeWidth={3}
              aria-hidden
              className={cn(
                "shrink-0 text-iris transition-opacity",
                selected ? "opacity-100" : "opacity-0",
              )}
            />
          </label>
        );
      })}
    </div>
  );
}
