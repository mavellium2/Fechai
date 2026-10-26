import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho de página do painel: sobrenome da rota + `h1` + subtítulo.
 *
 * Estava copiado (com espaçamentos ligeiramente diferentes) nas 7 telas do
 * painel. Centralizar garante que todas comecem no mesmo ponto vertical e que
 * exista exatamente um `h1` por página.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  /** Ações no nível da página (ex.: "Nova conta"). */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <p className="font-mono text-micro uppercase tracking-[0.3em] text-signal">{eyebrow}</p>
        <h1 className="font-display mt-2 text-2xl font-semibold leading-tight tracking-tight text-ink panel:text-white">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-neutral panel:text-white/60">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
