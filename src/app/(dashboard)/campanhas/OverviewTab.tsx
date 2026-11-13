import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { ReportFunnel } from "@/components/reports/ReportFunnel";
import { ReportKpis } from "@/components/reports/ReportKpis";
import { formatBRL } from "@/lib/format";
import { SOURCE_LABEL, type AttributionSource } from "@/modules/campaigns/attribution";
import { GOAL_TYPE_LABEL, type GoalType } from "@/modules/campaigns/limits";
import { STAGE_LABEL, STAGE_ORDER, type CampaignResults } from "@/modules/campaigns/results";
import type { CampaignView } from "@/modules/campaigns/view";

const DASH = "—";

/** "45 min", "3 h 10 min", "2 dias". */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return DASH;
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(minutes / 1440)} dias`;
}

const money = (cents: number | null) => (cents === null ? DASH : formatBRL(cents));

/**
 * Visão geral: números principais, funil, progresso da meta, custos e tempos.
 * Os componentes são os de Relatórios (`ReportKpis`, `ReportFunnel`) e as
 * regras de contagem são as mesmas de Relatórios › Campanhas.
 */
export function OverviewTab({ campaign, results }: { campaign: CampaignView; results: CampaignResults }) {
  const { funnel, cost, goal, broadcastTotals } = results;
  const empty = funnel.new === 0;

  return (
    <>
      <ReportKpis
        items={[
          { label: "Leads", value: String(funnel.new), comparison: "na campanha" },
          { label: "Agendados", value: String(funnel.scheduled), comparison: "com consulta marcada" },
          { label: "Compareceram", value: String(funnel.attended), comparison: "comparecimento marcado" },
          { label: "Custo por lead", value: money(cost.perLead), comparison: cost.total === null ? "informe o investimento" : "investimento ÷ leads" },
          { label: "Custo por agendamento", value: money(cost.perScheduled), comparison: "investimento ÷ agendados" },
          { label: "Custo por comparecimento", value: money(cost.perAttended), comparison: "investimento ÷ compareceram" },
        ]}
      />

      {goal && (
        <Card className="p-4 sm:p-6">
          <CardTitle>Progresso da meta</CardTitle>
          <p className="text-sm text-ink panel:text-white/90">
            {goal.reached} de {goal.value} {GOAL_TYPE_LABEL[goal.type as GoalType] ?? goal.type} ({goal.percent}%)
          </p>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10 panel:bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={goal.value}
            aria-valuenow={Math.min(goal.reached, goal.value)}
            aria-label="Progresso da meta"
          >
            <div className="h-full rounded-full bg-iris" style={{ width: `${Math.min(goal.percent, 100)}%` }} />
          </div>
        </Card>
      )}

      {empty ? (
        <Card className="p-4 sm:p-6">
          <CardTitle>Ainda sem leads</CardTitle>
          <p className="text-sm text-neutral panel:text-white/60">
            Os leads entram pelos anúncios e disparos vinculados, pelas palavras-chave ou adicionados à mão na aba Leads.
          </p>
        </Card>
      ) : (
        <ReportFunnel
          title="Funil da campanha"
          description="Cada lead conta na etapa mais avançada que alcançou. Fechamento de tratamento não é registrado pelo Fechai."
          steps={STAGE_ORDER.map((stage) => ({ name: stage === "new" ? "Leads" : STAGE_LABEL[stage], count: funnel[stage] }))}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4 sm:p-6">
          <CardTitle>Custos</CardTitle>
          <DataTable
            caption="Custos da campanha"
            head={["Item", "Valor"]}
            rows={[
              { id: "budget", cells: ["Investimento em mídia", money(cost.budget)] },
              {
                id: "broadcasts",
                cells: [
                  "Disparos",
                  campaign.messageCostCents === null && results.broadcasts.length
                    ? "Informe o custo por mensagem"
                    : money(cost.broadcasts),
                ],
              },
              { id: "total", cells: ["Total", money(cost.total)] },
              { id: "lead", cells: ["Por lead", money(cost.perLead)] },
              { id: "scheduled", cells: ["Por agendamento", money(cost.perScheduled)] },
              { id: "attended", cells: ["Por comparecimento", money(cost.perAttended)] },
            ]}
          />
        </Card>

        <Card className="p-4 sm:p-6">
          <CardTitle>Atendimento</CardTitle>
          <DataTable
            caption="Tempos e situação dos leads"
            head={["Medida", "Valor"]}
            rows={[
              { id: "first", cells: ["Tempo até a primeira resposta (mediana)", formatMinutes(results.medianFirstResponseMinutes)] },
              { id: "schedule", cells: ["Tempo até o agendamento (mediana)", formatMinutes(results.medianToScheduleMinutes)] },
              { id: "handoff", cells: ["Passaram para a equipe", String(results.outcomes.handoff)] },
              { id: "lost", cells: ["Perdidos", String(results.outcomes.lost)] },
              { id: "open", cells: ["Em andamento", String(results.outcomes.open)] },
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4 sm:p-6">
          <CardTitle>De onde vieram</CardTitle>
          <DataTable
            caption="Leads por origem da atribuição"
            head={["Origem", "Leads"]}
            rows={(Object.keys(results.bySource) as AttributionSource[]).map((source) => ({
              id: source,
              cells: [SOURCE_LABEL[source], String(results.bySource[source])],
            }))}
          />
        </Card>

        <Card className="p-4 sm:p-6">
          <CardTitle>Disparos</CardTitle>
          {results.broadcasts.length ? (
            <DataTable
              caption="Resultado dos disparos vinculados"
              head={["Etapa", "Total"]}
              rows={[
                { id: "sent", cells: ["Enviados", String(broadcastTotals.sent)] },
                { id: "delivered", cells: ["Entregues", String(broadcastTotals.delivered)] },
                { id: "read", cells: ["Lidos", String(broadcastTotals.read)] },
                { id: "replies", cells: ["Responderam", String(broadcastTotals.replies)] },
                { id: "stopped", cells: ["Pediram para parar", String(broadcastTotals.stopped)] },
                { id: "blocked", cells: ["Bloqueados", String(broadcastTotals.blocked)] },
              ]}
            />
          ) : (
            <p className="text-sm text-neutral panel:text-white/60">Nenhum disparo vinculado a esta campanha.</p>
          )}
        </Card>
      </div>

      <div>
        <ButtonLink
          href="/relatorios?visao=campanhas"
          variant="outline"
          size="sm"
          className="max-sm:h-auto max-sm:min-h-11 max-sm:py-2 max-sm:text-center"
        >
          Ver todos os anúncios em Relatórios › Campanhas
        </ButtonLink>
      </div>
    </>
  );
}
