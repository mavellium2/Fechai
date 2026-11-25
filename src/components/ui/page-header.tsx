import * as React from "react";
import { cn } from "@/lib/utils";
import { InfoHint } from "./info-hint";

/**
 * Cabeçalho de página do painel: sobrenome da rota + `h1` + subtítulo.
 *
 * Estava copiado (com espaçamentos ligeiramente diferentes) nas 7 telas do
 * painel. Centralizar garante que todas comecem no mesmo ponto vertical e que
 * exista exatamente um `h1` por página.
 */
const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

export function PageHeader({
  eyebrow,
  title,
  description,
  hint,
  actions,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  /** Explicação da página numa bolinha ao lado do título (não ocupa linha). Só texto explicativo: dado que muda vai em `description`. */
  hint?: React.ReactNode;
  /** Ações no nível da página (ex.: "Nova conta"). */
  actions?: React.ReactNode;
  className?: string;
}) {
  // Sobrescrito igual ao título ("AGENDA" sobre "Agenda") só repete: some.
  // Ele continua quando diz outra coisa (ex.: "CRM" sobre "Configurar etapas").
  const showEyebrow = plain(eyebrow) !== plain(title);
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {showEyebrow && <p className="mb-2 font-mono text-micro uppercase tracking-[0.3em] text-signal">{eyebrow}</p>}
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink panel:text-white">
              {title}
            </h1>
            {hint && <InfoHint label={title}>{hint}</InfoHint>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {/* Largura inteira, abaixo da linha do título e das ações: cabe numa linha e poupa altura. */}
      {description && (
        <p className="text-sm leading-relaxed text-neutral panel:text-white/60">{description}</p>
      )}
    </div>
  );
}
