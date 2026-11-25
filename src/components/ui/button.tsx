import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { actionSurface } from "./action";
import { LoadingDots } from "./loading-dots";

/**
 * Único botão do produto. Variantes cobrem os dois fundos (paper e painel
 * escuro) — nenhuma tela deve reescrever cor de borda/texto por className.
 *
 * `enabled:hover:` em vez de `hover:` + `disabled:pointer-events-none`: assim o
 * `cursor-not-allowed` do estado desabilitado aparece de verdade (com
 * pointer-events desligado o cursor nunca muda).
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium",
    "transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2",
    "focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        // primária de marca
        default: "bg-iris text-white enabled:hover:bg-iris/90",
        // conversão (signup/assinar) e ação principal da seção — 1 por tela, no máximo
        cta: "bg-signal text-white enabled:hover:bg-signal/90",
        // cor de ação: tudo que é clicável. Laranja no texto e na borda, sem
        // preencher, para não competir com o único CTA preenchido da tela.
        action: actionSurface,
        outline: [
          "border border-ink/15 bg-white text-ink enabled:hover:bg-paper",
          "panel:border-white/20 panel:bg-transparent panel:text-white/80",
          "panel:enabled:hover:bg-white/10 panel:enabled:hover:text-white",
        ],
        ghost: [
          "text-ink enabled:hover:bg-ink/5",
          "panel:text-white/70 panel:enabled:hover:bg-white/10 panel:enabled:hover:text-white",
        ],
        destructive: [
          "border border-danger/40 text-danger enabled:hover:bg-danger/10",
          "panel:border-danger/50",
        ],
        /** Destrutivo cheio — só para confirmação final dentro de um diálogo. */
        destructiveSolid: "bg-danger text-white enabled:hover:bg-danger/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type BaseProps = VariantProps<typeof buttonVariants> & {
  /**
   * Troca o conteúdo pelos 3 pontos da marca e desabilita o botão. Todo botão
   * que dispara ação assíncrona precisa disso — nunca travar sem retorno.
   */
  loading?: boolean;
  /** Texto lido por leitor de tela enquanto carrega. */
  loadingLabel?: string;
};

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    BaseProps {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading, loadingLabel = "Carregando", children, disabled, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? (
        <>
          <LoadingDots size={size === "lg" ? 5 : 4} label={null} />
          <span className="sr-only">{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  ),
);
Button.displayName = "Button";

export interface ButtonLinkProps
  extends Omit<React.ComponentProps<typeof Link>, "color">,
    VariantProps<typeof buttonVariants> {}

/**
 * Navegação com aparência de botão. Existe para que links de ação parem de ser
 * recriados à mão em cada página (`<Link className="rounded-md border ...">`),
 * o que vinha deixando esses links sem `focus-visible`.
 */
export function ButtonLink({ className, variant, size, ...props }: ButtonLinkProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
