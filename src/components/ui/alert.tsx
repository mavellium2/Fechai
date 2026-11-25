import * as React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aviso em bloco: ícone + texto + papel ARIA correto.
 *
 * As telas do painel espalhavam `<p className="text-sm text-danger">` solto,
 * que (a) não era anunciado por leitor de tela e (b) transmitia o estado só
 * pela cor. Aqui erro/aviso viram `role="alert"` (interrompe e é lido na hora)
 * e sucesso/info viram `role="status"` (lido sem interromper).
 */
const TONES = {
  info: { icon: Info, box: "border-iris/30 bg-iris/10 text-iris panel:text-white/85", role: "status" },
  success: { icon: CircleCheck, box: "border-success/30 bg-success/10 text-success", role: "status" },
  warn: { icon: TriangleAlert, box: "border-warn/30 bg-warn/10 text-warn", role: "alert" },
  danger: { icon: CircleAlert, box: "border-danger/30 bg-danger/10 text-danger", role: "alert" },
} as const;

export type AlertTone = keyof typeof TONES;

export function Alert({
  tone = "info",
  title,
  className,
  children,
  onDismiss,
}: {
  tone?: AlertTone;
  title?: string;
  className?: string;
  children?: React.ReactNode;
  /** Mostra um X para fechar o aviso (só em componente cliente). */
  onDismiss?: () => void;
}) {
  const { icon: Icon, box, role } = TONES[tone];

  return (
    <div
      role={role}
      className={cn("flex items-start gap-2 rounded-control border px-4 py-3 text-sm", box, className)}
    >
      {/* mt-0.5 aqui é ajuste óptico do ícone contra a primeira linha de texto,
          não espaçamento de layout — por isso foge da grade de 4/8. */}
      <Icon size={16} strokeWidth={2.5} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-1")}>{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Fechar aviso"
          className="-my-1 -mr-2 shrink-0 rounded-control p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Retorno curto de formulário (o `{ ok, error, info }` das server actions).
 * Renderiza nada quando não há mensagem, então dá pra chamar sem condicional.
 */
export function FormFeedback({ error, info }: { error?: string | null; info?: string | null }) {
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (info) return <Alert tone="success">{info}</Alert>;
  return null;
}
