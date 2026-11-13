import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import type { CampaignHistoryEntry } from "@/modules/campaigns/detail";
import { formatDateTime } from "@/modules/campaigns/period";
import { describeAllowedSlots, hasSpecialRules, restrictsSchedule, type CampaignRules } from "@/modules/campaigns/rules";
import type { CampaignView } from "@/modules/campaigns/view";
import { CampaignRulesForm } from "./CampaignRulesForm";

const REMINDER_TEXT = { default: "os da agenda", off: "desligados", custom: "personalizados" } as const;

/** As regras em vigor numa lista curta — a mesma leitura da aba Revisão. */
export function rulesSummary(rules: CampaignRules): string[] {
  const lines: string[] = [];
  if (restrictsSchedule(rules)) lines.push(`Agenda: só ${describeAllowedSlots(rules)}.`);
  if (rules.capacity !== null) lines.push(`${rules.capacity} vaga${rules.capacity === 1 ? "" : "s"} por horário (evento).`);
  if (rules.arrival) lines.push(`Chegada informada: ${rules.arrival}.`);
  if (rules.reminders !== "default") lines.push(`Lembretes automáticos ${REMINDER_TEXT[rules.reminders]}.`);
  if (rules.offer) lines.push("Oferta da campanha no atendimento.");
  if (rules.instructions) lines.push("Instruções extras para a IA.");
  if (restrictsSchedule(rules)) {
    lines.push(rules.outside === "handoff" ? "Fora da regra: transfere para humano." : "Fora da regra: recusa e oferece as opções.");
  }
  if (rules.graceDays) lines.push(`Seguem valendo ${rules.graceDays} dia${rules.graceDays === 1 ? "" : "s"} depois do fim para quem agendou.`);
  return lines;
}

export function RulesTab({
  campaign,
  rules,
  editable,
  window,
  history,
  timezone,
}: {
  campaign: CampaignView;
  rules: CampaignRules;
  editable: boolean;
  window: { endsAt: string | null; graceUntil: string | null };
  history: CampaignHistoryEntry[];
  timezone: string;
}) {
  const summary = rulesSummary(rules);
  const inForce = campaign.status === "active";
  return (
    <>
      <Card className="p-4 sm:p-6">
        <CardTitle>Regras em vigor</CardTitle>
        {hasSpecialRules(rules) ? (
          <>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink panel:text-white/90">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-neutral panel:text-white/60">
              {campaign.status === "draft"
                ? "Ainda não valem: a campanha é rascunho. Ative na aba Revisão."
                : campaign.status === "scheduled"
                  ? "Passam a valer no início da campanha."
                  : campaign.status === "paused"
                    ? "Suspensas enquanto a campanha está pausada."
                    : inForce
                      ? `Valem para os leads da campanha${window.endsAt ? ` até ${window.endsAt}` : ""}${window.graceUntil ? ` (para quem agendou, até ${window.graceUntil})` : ""}. Depois disso o atendimento volta ao normal sozinho.`
                      : "A campanha terminou: as regras não valem mais."}
            </p>
          </>
        ) : (
          <p className="text-sm text-neutral panel:text-white/60">
            Nenhuma regra especial: os leads da campanha seguem o atendimento normal do agente.
          </p>
        )}
      </Card>

      {editable ? (
        <CampaignRulesForm campaignId={campaign.id} rules={rules} editable={editable} />
      ) : (
        <Alert tone="info">
          {campaign.allowed.edit ? "Só o dono ou um administrador altera as regras." : "Campanha só para consulta: as regras não podem mais ser alteradas."}
        </Alert>
      )}

      <Card className="p-4 sm:p-6">
        <CardTitle>Histórico de alterações das regras</CardTitle>
        {history.length ? (
          <ul className="space-y-3">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-control border border-ink/10 p-3 text-sm panel:border-white/15">
                <p className="font-medium text-ink panel:text-white">
                  {formatDateTime(entry.createdAt, timezone)} · {entry.actor}
                </p>
                <RuleDiff before={entry.before} after={entry.after} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral panel:text-white/60">Nenhuma alteração de regra registrada.</p>
        )}
      </Card>
    </>
  );
}

function readRules(value: unknown): CampaignRules | null {
  if (!value || typeof value !== "object" || !("rules" in value)) return null;
  return (value as { rules: CampaignRules }).rules ?? null;
}

/** Antes e depois de cada alteração, na mesma linguagem da lista acima. */
function RuleDiff({ before, after }: { before: unknown; after: unknown }) {
  const a = readRules(before);
  const b = readRules(after);
  const beforeLines = a ? rulesSummary(a) : [];
  const afterLines = b ? rulesSummary(b) : [];
  const removed = beforeLines.filter((line) => !afterLines.includes(line));
  const added = afterLines.filter((line) => !beforeLines.includes(line));
  if (!removed.length && !added.length) {
    return <p className="mt-1 text-neutral panel:text-white/60">Ajuste de texto nas regras.</p>;
  }
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div>
        <p className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">Antes</p>
        <ul className="mt-1 space-y-1 text-neutral panel:text-white/60">
          {removed.length ? removed.map((line) => <li key={line}>{line}</li>) : <li>—</li>}
        </ul>
      </div>
      <div>
        <p className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">Depois</p>
        <ul className="mt-1 space-y-1 text-ink panel:text-white/90">
          {added.length ? added.map((line) => <li key={line}>{line}</li>) : <li>—</li>}
        </ul>
      </div>
    </div>
  );
}
