import type { BroadcastSummary } from "@/modules/broadcasts/queries";
import { cn } from "@/lib/utils";

const pct = (part: number, total: number) =>
  total ? `${Math.round((part / total) * 100)}%` : "—";

/**
 * Os quatro números que importam (enviados, entregues, lidos, responderam) e
 * a barra de andamento. `compact` é a versão do cartão da lista.
 */
export function CampaignStats({
  c,
  compact,
}: {
  c: BroadcastSummary;
  compact?: boolean;
}) {
  const processed = c.total - c.pending;
  const tiles = [
    {
      label: "Enviados",
      value: c.sent,
      hint: `de ${c.total}`,
      about: "Aceitos pela Meta para entrega.",
    },
    {
      label: "Entregues",
      value: c.delivered,
      hint: pct(c.delivered, c.sent),
      about: "Chegaram no aparelho do contato.",
    },
    {
      label: "Lidos",
      value: c.read,
      hint: pct(c.read, c.sent),
      about: "Nem todo contato deixa a confirmação de leitura ligada.",
    },
    {
      label: "Responderam",
      value: c.replies,
      hint: pct(c.replies, c.sent),
      about: "Responderam em até 7 dias depois do envio.",
    },
  ];
  const problems = c.failed + c.unknown + c.skipped + c.deliveryFailed;
  return (
    <div className="space-y-3">
      <dl
        className={cn(
          "grid grid-cols-2 gap-3",
          compact ? "sm:grid-cols-4" : "lg:grid-cols-4",
        )}
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            className={cn(
              "rounded-control border border-white/10 bg-white/5",
              compact ? "p-3" : "p-4",
            )}
            title={t.about}
          >
            <dt className="text-xs text-white/60">{t.label}</dt>
            <dd className="mt-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "font-display font-semibold tabular-nums text-white",
                  compact ? "text-xl" : "text-3xl",
                )}
              >
                {t.value}
              </span>
              <span className="text-xs text-white/50">{t.hint}</span>
            </dd>
          </div>
        ))}
      </dl>
      {c.total > 0 && c.status !== "draft" && (
        <div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Andamento do disparo"
            aria-valuemin={0}
            aria-valuemax={c.total}
            aria-valuenow={processed}
          >
            <div
              className="h-full rounded-full bg-iris transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${(processed / c.total) * 100}%` }}
            />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-white/60">
            {c.pending > 0 && <span>{c.pending} aguardando envio</span>}
            {problems > 0 && (
              <span className="text-warn">{problems} com problema</span>
            )}
            {(c.opportunities > 0 || c.appointments > 0 || (!compact && c.attended > 0)) && (
              <span className="text-success">
                {c.opportunities} oportunidades · {c.appointments} agendamentos
                {!compact && ` · ${c.attended} compareceram`}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
