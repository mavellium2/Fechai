import { Card, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { GOAL_TYPE_LABEL, OBJECTIVE_TYPE_LABEL, type GoalType, type ObjectiveType } from "@/modules/campaigns/limits";
import type { CampaignView } from "@/modules/campaigns/view";
import type { CampaignSummary } from "./CampaignSections";
import { CampaignStatusBadge } from "./CampaignStatusBadge";
import { EditCampaignButton } from "./EditCampaignButton";

const EMPTY = "text-neutral panel:text-white/60";

/** Dados gerais: o que a campanha é (passo 1 do passo a passo). */
export function GeneralTab({ campaign, summary, editable }: { campaign: CampaignView; summary: CampaignSummary; editable: boolean }) {
  return (
    <Card className="p-4 sm:p-6">
      <CardTitle action={editable ? <EditCampaignButton campaign={campaign} /> : undefined}>Dados gerais</CardTitle>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Row label="Tipo de objetivo">
          {campaign.objectiveType ? (
            OBJECTIVE_TYPE_LABEL[campaign.objectiveType as ObjectiveType] ?? campaign.objectiveType
          ) : (
            <span className={EMPTY}>Não definido</span>
          )}
        </Row>
        <Row label="Período">{campaign.period}</Row>
        <Row label="Objetivo" wide>
          {campaign.objective ? (
            <span className="whitespace-pre-line break-words">{campaign.objective}</span>
          ) : (
            <span className={EMPTY}>Nenhum objetivo definido.</span>
          )}
        </Row>
        <Row label="Descrição" wide>
          {campaign.description ? (
            <span className="whitespace-pre-line break-words">{campaign.description}</span>
          ) : (
            <span className={EMPTY}>Sem descrição.</span>
          )}
        </Row>
        <Row label="Meta">
          {campaign.goalValue && campaign.goalType ? (
            `${campaign.goalValue} ${GOAL_TYPE_LABEL[campaign.goalType as GoalType] ?? campaign.goalType}`
          ) : (
            <span className={EMPTY}>Sem meta</span>
          )}
        </Row>
        <Row label="Investimento em mídia">
          {campaign.budgetCents !== null ? formatBRL(campaign.budgetCents) : <span className={EMPTY}>Não informado</span>}
        </Row>
        <Row label="Custo por mensagem de disparo">
          {campaign.messageCostCents !== null ? formatBRL(campaign.messageCostCents) : <span className={EMPTY}>Não informado</span>}
        </Row>
        <Row label="Palavras-chave">
          {campaign.keywords ? campaign.keywords : <span className={EMPTY}>Nenhuma</span>}
        </Row>
        <Row label="Situação">
          <span className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <span className={EMPTY}>{summary.statusNote}</span>
          </span>
        </Row>
        <Row label="Criada por">{summary.createdBy ?? <span className={EMPTY}>Não informado</span>}</Row>
        <Row label="Criada em">{summary.createdAt}</Row>
        <Row label="Atualizada em">
          {summary.updatedAt ? (
            `${summary.updatedAt}${summary.updatedBy ? ` por ${summary.updatedBy}` : ""}`
          ) : (
            <span className={EMPTY}>Ainda não foi alterada</span>
          )}
        </Row>
      </dl>
    </Card>
  );
}

/** Uma linha: rótulo pequeno em cima, valor embaixo. `wide` ocupa as duas colunas. */
export function Row({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-sm text-neutral panel:text-white/60">{label}</dt>
      <dd className="mt-1 text-sm text-ink panel:text-white/90">{children}</dd>
    </div>
  );
}
