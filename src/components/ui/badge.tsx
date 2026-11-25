import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Etiqueta de estado (plano, status do tenant, "mock", nível do modelo…).
 *
 * Sempre carrega texto — cor nunca é o único indicador (skill design-ui, §4).
 * Substitui as ~8 pílulas `rounded-full px-2 py-0.5 font-mono text-[9px]…`
 * que estavam copiadas entre admin/contas, admin/ia, agentes e conversas, cada
 * uma com um tamanho de fonte diferente (9, 10 e 11px para o mesmo papel).
 * Agora é o degrau `text-micro` do tema, um só.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-micro uppercase tracking-wide whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-ink/8 text-neutral panel:bg-white/10 panel:text-white/70",
        iris: "bg-iris/15 text-iris panel:bg-iris/25 panel:text-white",
        // signal puro reprova AA sobre paper; a variante escurecida é a mesma cor de ação
        signal: "bg-signal/15 text-signal-ink panel:text-signal",
        success: "bg-success/15 text-success",
        warn: "bg-warn/15 text-warn",
        danger: "bg-danger/15 text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Ícone opcional à esquerda — decorativo, o texto já diz tudo. */
  icon?: React.ReactNode;
}

export function Badge({ className, tone, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

/** Bolinha + rótulo, para status de conexão (WhatsApp, saúde da conta). */
export function StatusDot({
  tone,
  children,
}: {
  tone: "success" | "warn" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  const dot = {
    success: "bg-success",
    warn: "bg-warn",
    danger: "bg-danger",
    neutral: "bg-neutral/50 panel:bg-white/30",
  }[tone];

  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={cn("inline-block h-2.5 w-2.5 rounded-full", dot)} />
      <span className="font-mono text-micro uppercase tracking-[0.15em] text-ink panel:text-white/80">
        {children}
      </span>
    </span>
  );
}

export { badgeVariants };
