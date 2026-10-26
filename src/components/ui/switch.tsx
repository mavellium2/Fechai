"use client";

import { cn } from "@/lib/utils";
import { LoadingDots } from "./loading-dots";
import type { ReactNode } from "react";

/**
 * Interruptor liga/desliga.
 *
 * `role="switch"` + `aria-checked` (e não `aria-pressed`, que era o que a tela
 * de agentes usava): leitores de tela anunciam "ativado/desativado" em vez de
 * "pressionado", que é o certo para um estado persistente.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  loading,
  label,
  describedBy,
  className,
  thumbContent,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** Mostra os pontos da marca no lugar do botão enquanto o servidor confirma. */
  loading?: boolean;
  /** Obrigatório: o interruptor não tem texto próprio. */
  label: string;
  describedBy?: string;
  className?: string;
  /** Optional decorative content, such as the current theme icon. */
  thumbContent?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2",
        "focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-iris" : "bg-neutral/40 panel:bg-white/20",
        className,
      )}
    >
      {loading ? (
        <LoadingDots size={3} label={null} className="absolute inset-0 justify-center text-white" />
      ) : (
        <span
          aria-hidden
          className={cn(
            // O deslocamento é exatamente a largura do thumb (trilho 44px −
            // thumb 20px − 2px de cada lado = 20px), então `translate-x-full`
            // encosta o thumb na direita sem valor mágico. `translate-x-5`
            // não era gerado pelo Tailwind v4 e o thumb ficava parado/fora do
            // trilho quando ativado.
            "absolute start-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white transition-transform",
            checked && "translate-x-full",
          )}
        >
          {thumbContent}
        </span>
      )}
    </button>
  );
}
