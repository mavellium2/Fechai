import * as React from "react";
import { cn } from "@/lib/utils";
import { InfoHint } from "./info-hint";

/** Número grande de relatório. Mesma casca do `Card`, sem título de seção. */
export function Stat({
  label,
  value,
  hint,
  about,
  delta,
  compact,
  footer,
}: {
  label: string;
  value: string;
  /**
   * Qualificador curto do número, sob o valor ("agora", "no total"). Duas ou
   * três palavras — é parte da leitura do dado, não explicação.
   */
  hint?: string;
  /**
   * Explicação de o que o número mede. Vai para a bolinha de dúvida ao lado do
   * rótulo: quem já sabe não precisa reler a cada visita.
   */
  about?: React.ReactNode;
  /**
   * Variação contra o período anterior. Um número sozinho ("34 conversas") não
   * diz se a semana foi boa; comparado, diz. Seta **e** texto — cor nunca é o
   * único indicador (skill design-ui, §4).
   */
  delta?: number;
  /** Versão de grade densa (home), com número menor. */
  compact?: boolean;
  /** Linha extra sob o número (selo de qualidade, link para a origem). */
  footer?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-surface border border-ink/10 bg-white panel:border-white/10 panel:bg-white/5",
        compact ? "p-4" : "p-6",
      )}
    >
      <p className="flex items-center gap-1.5 font-sans text-sm font-medium leading-snug text-neutral panel:text-white/65">
        {label}
        {about && <InfoHint label={label}>{about}</InfoHint>}
      </p>
      {/* tabular-nums: os números não "pulam" de largura quando o valor muda */}
      <p
        className={cn(
          "font-display mt-2 font-semibold leading-tight tabular-nums text-ink panel:text-white",
          compact ? "text-2xl" : "text-3xl",
        )}
      >
        {value}
      </p>
      {delta !== undefined && (
        <p
          className={cn(
            "mt-1 text-xs",
            delta > 0
              ? "text-success"
              : delta < 0
                ? "text-warn"
                : "text-neutral panel:text-white/55",
          )}
        >
          <span aria-hidden>{delta > 0 ? "↑" : delta < 0 ? "↓" : "="}</span>{" "}
          {delta === 0 ? "igual ao período anterior" : `${Math.abs(delta)} vs. período anterior`}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-neutral panel:text-white/55">{hint}</p>}
      {footer}
    </div>
  );
}
