import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { hasSpecialRules, type CampaignRules } from "@/modules/campaigns/rules";
import type { CampaignView } from "@/modules/campaigns/view";
import { ActivateCampaignButton } from "./ActivateCampaignButton";
import { rulesSummary } from "./RulesTab";

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
  canActivate,
}: {
  campaign: CampaignView;
  rules: CampaignRules;
  ads: number;
  assets: number;
  broadcasts: number;
  canActivate: boolean;
}) {
  const hasPeriod = Boolean(campaign.startsOn && campaign.endsOn);
  const checks = [
    { ok: hasPeriod, text: hasPeriod ? `Período: ${campaign.period}` : "Defina o início e o fim em Dados gerais (obrigatório para ativar)." },
    { ok: ads > 0 || campaign.keywords !== "" || broadcasts > 0, text: `${ads} anúncio${ads === 1 ? "" : "s"}, ${broadcasts} disparo${broadcasts === 1 ? "" : "s"}${campaign.keywords ? `, palavras-chave: ${campaign.keywords}` : ", sem palavras-chave"}` },
    { ok: true, text: `${assets} mídia${assets === 1 ? "" : "s"}` },
  ];
  const special = hasSpecialRules(rules);

  return (
    <>
      <Card className="p-4 sm:p-6">
        <CardTitle>Revisão</CardTitle>
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
      </Card>

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
          <Card className="p-4 sm:p-6">
            <CardTitle>Ativar</CardTitle>
            <p className="mb-4 text-sm text-neutral panel:text-white/60">
              Ativada, a campanha começa a valer na data de início: os leads passam a entrar nela e as regras do agente valem até o
              fim. Antes disso, nada muda no atendimento.
            </p>
            <ActivateCampaignButton campaignId={campaign.id} disabled={!hasPeriod} />
          </Card>
        )
      ) : (
        <Alert tone="info">Esta campanha já foi ativada.</Alert>
      )}
    </>
  );
}
