import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { CardTitle } from "@/components/ui/card";
import { describeAllowedSlots, hasSpecialRules, restrictsSchedule, type CampaignRules } from "@/modules/campaigns/rules";
import type { CampaignView } from "@/modules/campaigns/view";
import { ActivateCampaignButton } from "./ActivateCampaignButton";

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

/**
 * Revisão: tudo da campanha num lugar, com destaque para o que muda o
 * comportamento da IA, e o botão Ativar. Período completo é o único requisito
 * para ativar; o resto aparece como lembrete, não como trava.
 */
export function ReviewTab({
  campaign,
  rules,
  ads,
  assets,
  broadcasts,
  agentName,
  canActivate,
}: {
  campaign: CampaignView;
  rules: CampaignRules;
  ads: number;
  assets: number;
  broadcasts: number;
  agentName: string | null;
  canActivate: boolean;
}) {
  const hasPeriod = Boolean(campaign.startsOn && campaign.endsOn);
  const checks = [
    { ok: hasPeriod, text: hasPeriod ? `Período: ${campaign.period}` : "Defina o início e o fim em Dados gerais (obrigatório para ativar)." },
    { ok: ads > 0 || campaign.keywords !== "" || broadcasts > 0, text: `${ads} anúncio${ads === 1 ? "" : "s"}, ${broadcasts} disparo${broadcasts === 1 ? "" : "s"}${campaign.keywords ? `, palavras-chave: ${campaign.keywords}` : ", sem palavras-chave"}` },
    { ok: true, text: agentName ? `Atende: ${agentName}` : "Atende: o agente de sempre de cada contato" },
    { ok: true, text: `${assets} arquivo${assets === 1 ? "" : "s"}` },
  ];
  const special = hasSpecialRules(rules);

  return (
    <>
      <section className="space-y-4">
        <CardTitle as="h3">Resumo</CardTitle>
        <ul className="space-y-2">
          {checks.map((check) => (
            <li key={check.text} className="flex items-start gap-2 text-sm text-ink panel:text-white/90">
              {check.ok ? (
                <CircleCheck size={16} aria-hidden className="mt-1 shrink-0 text-success" />
              ) : (
                <CircleAlert size={16} aria-hidden className="mt-1 shrink-0 text-warn" />
              )}
              {check.text}
            </li>
          ))}
        </ul>
      </section>

      {special ? (
        <Alert tone="warn" title="Estas regras mudam o comportamento da IA para os leads da campanha">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {rulesSummary(rules).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="info">Sem regras especiais: os leads da campanha seguem o atendimento normal do agente.</Alert>
      )}

      {campaign.status === "draft" ? (
        canActivate && (
          <section className="space-y-4">
            <CardTitle as="h3">Ativar</CardTitle>
            <p className="mb-4 text-sm text-neutral panel:text-white/60">
              Ativada, a campanha começa a valer na data de início: os leads passam a entrar nela e as regras do agente valem até o
              fim. Antes disso, nada muda no atendimento.
            </p>
            <ActivateCampaignButton campaignId={campaign.id} disabled={!hasPeriod} />
          </section>
        )
      ) : (
        <Alert tone="info">Esta campanha já foi ativada.</Alert>
      )}
    </>
  );
}
