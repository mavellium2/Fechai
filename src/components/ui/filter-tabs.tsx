import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterOption = { key: string; label: string; count?: number };

/**
 * Filtros em pílula que navegam por querystring (conversas).
 *
 * São links de navegação de verdade, então usam `<nav>` + `aria-current="page"`
 * — e não `role="tab"`, que prometeria ao leitor de tela um painel controlado
 * por JS que não existe aqui.
 */
export function FilterTabs({
  options,
  active,
  href,
  label,
  className,
}: {
  options: FilterOption[];
  active: string;
  /** Monta a URL de cada filtro. */
  href: (key: string) => string;
  /** Nome do grupo para leitores de tela (ex.: "Filtrar conversas"). */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const on = o.key === active;
        return (
          <Link
            key={o.key}
            href={href(o.key)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 font-sans text-sm font-medium leading-5 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2",
              "focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink",
              on
                ? "bg-iris text-white"
                : "bg-ink/5 text-neutral hover:text-ink panel:bg-white/10 panel:text-white/60 panel:hover:text-white",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="ml-2 tabular-nums opacity-70">{o.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
