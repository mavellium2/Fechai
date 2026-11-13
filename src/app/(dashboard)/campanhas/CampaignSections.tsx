import Link from "next/link";
import { ArrowRight, CircleCheck, CircleDashed, CircleAlert } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { formatBRL } from "@/lib/format";
import { GOAL_TYPE_LABEL, OBJECTIVE_TYPE_LABEL, type GoalType, type ObjectiveType } from "@/modules/campaigns/limits";
import { describeAllowedSlots, restrictsSchedule } from "@/modules/campaigns/rules";
import { cn } from "@/lib/utils";
import type { CampaignDetail } from "./CampaignDetail";
import { CampaignAdsPanel } from "./CampaignAdsPanel";
import { CampaignAgentPanel } from "./CampaignAgentPanel";
import { CampaignBroadcastsPanel } from "./CampaignBroadcastsPanel";
import { CampaignKeywordsForm } from "./CampaignKeywordsForm";
import { CampaignLeadsPanel } from "./CampaignLeadsPanel";
import { CampaignMediaPanel } from "./CampaignMediaPanel";
import { CampaignRulesForm } from "./CampaignRulesForm";
import { EditCampaignButton } from "./EditCampaignButton";
import { HistoryTab } from "./HistoryTab";
import { SECTIONS, STEPS, type StepId } from "./labels";
import { OverviewTab } from "./OverviewTab";
import { ReviewTab } from "./ReviewTab";

/** O que o Resumo mostra além da campanha: já formatado no servidor, no fuso dela. */
export type CampaignSummary = {
  createdBy: string | null;
  createdAt: string;
  /** `null` = nunca foi alterada depois de criada. */
  updatedAt: string | null;
  updatedBy: string | null;
};

type Props = Parameters<typeof CampaignDetail>[0];
type StepState = "done" | "default" | "missing";

const STATE_ICON = { done: CircleCheck, default: CircleDashed, missing: CircleAlert } as const;
const STATE_CLASS = { done: "text-success", default: "text-neutral panel:text-white/55", missing: "text-warn" } as const;

/** Situação e resumo de cada passo, em uma frase — o que a pessoa lê sem abrir nada. */
function stepInfo(props: Props): Record<StepId, { state: StepState; summary: string }> {
  const { campaign, rules, agentSetup, results, ads, assets } = props;
  const agent = agentSetup.agents.find((a) => a.id === agentSetup.agentId);
  const broadcasts = results?.broadcasts.length ?? 0;
  const adsCount = ads?.length ?? 0;
  const origins = [
    adsCount ? `${adsCount} anúncio${adsCount === 1 ? "" : "s"}` : "",
    campaign.keywords ? `palavras-chave: ${campaign.keywords}` : "",
    broadcasts ? `${broadcasts} disparo${broadcasts === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const hasPeriod = Boolean(campaign.startsOn && campaign.endsOn);
  return {
    basico: {
      state: hasPeriod ? "done" : "missing",
      summary: [
        campaign.objectiveType ? OBJECTIVE_TYPE_LABEL[campaign.objectiveType as ObjectiveType] : "",
        hasPeriod ? campaign.period : "Falta o período (início e fim)",
        campaign.goalValue && campaign.goalType ? `meta: ${campaign.goalValue} ${GOAL_TYPE_LABEL[campaign.goalType as GoalType]}` : "",
        campaign.budgetCents !== null ? `investimento ${formatBRL(campaign.budgetCents)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    },
    agente: {
      state: agent || rules.offer || rules.instructions ? "done" : "default",
      summary: agent
        ? `${agent.name}${agent.enabled ? "" : " (desligado — os leads seguem com o agente de sempre)"}`
        : "O agente que já atende cada contato",
    },
    agenda: {
      state: restrictsSchedule(rules) || rules.reminders !== "default" ? "done" : "default",
      summary: restrictsSchedule(rules)
        ? `Só ${describeAllowedSlots(rules)}${rules.reminders === "off" ? " · sem lembretes" : ""}`
        : rules.reminders === "off"
          ? "Agenda normal · sem lembretes"
          : "Agenda normal da clínica",
    },
    origem: {
      state: origins.length ? "done" : "missing",
      summary: origins.length ? origins.join(" · ") : "Nenhuma origem: só entra quem você adicionar à mão",
    },
    arquivos: {
      state: assets?.length ? "done" : "default",
      summary: assets?.length ? `${assets.length} arquivo${assets.length === 1 ? "" : "s"}` : "Opcional",
    },
    revisao: {
      state: campaign.status === "draft" ? "missing" : "done",
      summary: campaign.status === "draft" ? "Ainda não ativada" : "Ativada",
    },
  };
}

/**
 * O corpo da página: quatro abas (Resultados, Leads, Configuração, Histórico).
 * A Configuração é um roteiro de passos na ordem em que se monta uma campanha;
 * cada passo mostra a situação e o resumo, e abre no próprio lugar para editar.
 */
export function CampaignSections(props: Props) {
  const { campaign, section } = props;
  const editable = props.canEdit && campaign.allowed.edit;
  const base = `/campanhas/${campaign.id}`;

  return (
    <>
      <FilterTabs
        label="Abas da campanha"
        options={SECTIONS.map(({ id, label }) => ({ key: id, label }))}
        active={section}
        href={(key) => `${base}?aba=${key}`}
      />

      <div className="space-y-6">
        {section === "resultados" && props.results && <OverviewTab campaign={campaign} results={props.results} />}
        {section === "resultados" && campaign.status === "finished" && props.agentSetup.learned.some((d) => !d.merged) && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
            <p className="text-sm text-ink panel:text-white/90">
              A cópia do agente aprendeu coisas nesta campanha. Escolha o que vale levar para o agente original.
            </p>
            <ButtonLink href={`${base}?aba=configuracao&passo=agente#passo-agente`} size="sm" className="max-sm:h-11">
              Revisar o aprendizado
            </ButtonLink>
          </Card>
        )}
        {section === "leads" && props.results && (
          <CampaignLeadsPanel
            campaignId={campaign.id}
            canAdd={campaign.status !== "archived"}
            canRemove={props.canEdit && campaign.status !== "archived"}
            timezone={props.timezone}
            leads={props.results.leads.map((lead) => ({
              ...lead,
              assignedAt: lead.assignedAt.toISOString(),
              appointment: lead.appointment ? { ...lead.appointment, startsAt: lead.appointment.startsAt.toISOString() } : null,
            }))}
          />
        )}
        {section === "configuracao" && <SetupSteps {...props} editable={editable} />}
        {section === "historico" && <HistoryTab history={props.history ?? []} timezone={props.timezone} />}
      </div>
    </>
  );
}

function SetupSteps(props: Props & { editable: boolean }) {
  const { campaign, step, editable } = props;
  const info = stepInfo(props);
  const draft = campaign.status === "draft";
  const base = `/campanhas/${campaign.id}?aba=configuracao`;
  const done = STEPS.filter((s) => info[s.id].state !== "missing").length;
  // Rascunho sem passo escolhido: abre o primeiro que falta, para a pessoa saber por onde seguir.
  const open = step ?? (draft ? STEPS.find((s) => info[s.id].state === "missing")?.id ?? null : null);

  return (
    <div className="space-y-4">
      {draft && (
        <p className="text-sm text-neutral panel:text-white/60">
          Monte a campanha nestes passos. Tudo é salvo na hora; nada muda no atendimento até você ativar no último passo. ({done} de{" "}
          {STEPS.length} prontos)
        </p>
      )}
      <ol className="space-y-3">
        {STEPS.map((s, index) => {
          const { state, summary } = info[s.id];
          const Icon = STATE_ICON[state];
          const isOpen = open === s.id;
          const next = STEPS[index + 1];
          return (
            <li key={s.id} id={`passo-${s.id}`} className="scroll-mt-4">
              <Card className={cn("p-4 sm:p-6", isOpen && "border-iris/40")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/5 font-mono text-sm text-ink panel:bg-white/10 panel:text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-semibold text-ink panel:text-white">{s.title}</h2>
                      <p className="text-sm text-neutral panel:text-white/60">{s.purpose}</p>
                      <p className="mt-2 flex items-start gap-2 text-sm text-ink panel:text-white/90">
                        <Icon size={16} aria-hidden className={cn("mt-1 shrink-0", STATE_CLASS[state])} />
                        <span className="wrap-anywhere">{summary}</span>
                      </p>
                    </div>
                  </div>
                  {!isOpen && (
                    <Link
                      href={`${base}&passo=${s.id}#passo-${s.id}`}
                      className="inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-sm font-medium text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris sm:min-h-0"
                    >
                      {editable ? (state === "missing" ? "Configurar" : "Editar") : "Ver"}
                      <ArrowRight size={16} aria-hidden />
                    </Link>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-6 space-y-6 border-t border-ink/10 pt-6 panel:border-white/10">
                    <StepEditor {...props} stepId={s.id} />
                    <div className="flex flex-wrap justify-between gap-2">
                      <ButtonLink href={`${base}#passo-${s.id}`} variant="ghost" size="sm" className="max-sm:h-11">
                        Fechar
                      </ButtonLink>
                      {next && (
                        <ButtonLink href={`${base}&passo=${next.id}#passo-${next.id}`} size="sm" className="max-sm:h-11">
                          Próximo: {next.title}
                          <ArrowRight size={16} aria-hidden />
                        </ButtonLink>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepEditor(props: Props & { editable: boolean; stepId: StepId }) {
  const { campaign, editable, stepId } = props;
  switch (stepId) {
    case "basico":
      return (
        <div className="space-y-3">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Item label="Nome">{campaign.name}</Item>
            <Item label="Período">{campaign.period}</Item>
            <Item label="Objetivo">{campaign.objective ?? "—"}</Item>
            <Item label="Descrição para a equipe e a IA">{campaign.description ?? "—"}</Item>
          </dl>
          {editable && <EditCampaignButton campaign={campaign} />}
        </div>
      );
    case "agente":
      return (
        <>
          <CampaignAgentPanel campaignId={campaign.id} editable={editable} setup={props.agentSetup} />
          <CampaignRulesForm campaignId={campaign.id} rules={props.rules} editable={editable} part="fala" />
        </>
      );
    case "agenda":
      return <CampaignRulesForm campaignId={campaign.id} rules={props.rules} editable={editable} part="agenda" />;
    case "origem":
      return (
        <>
          <CampaignAdsPanel
            campaignId={campaign.id}
            editable={editable}
            ads={(props.ads ?? []).map((ad) => ({ id: ad.id, adId: ad.adId, adsetId: ad.adsetId, metaCampaignId: ad.metaCampaignId, code: ad.code, displayName: ad.displayName }))}
            captured={(props.capturedAds ?? []).map((ad) => ({ ...ad, lastAt: ad.lastAt.toISOString() }))}
          />
          <CampaignKeywordsForm campaignId={campaign.id} editable={editable} keywords={campaign.keywords} />
          {props.results && (
            <CampaignBroadcastsPanel
              campaignId={campaign.id}
              editable={editable}
              metaEnabled={props.metaEnabled}
              timezone={props.timezone}
              broadcasts={props.results.broadcasts.map((b) => ({ ...b, confirmedAt: b.confirmedAt?.toISOString() ?? null }))}
              totals={props.results.broadcastTotals}
              available={(props.availableBroadcasts ?? []).map((b) => ({ id: b.id, name: b.name, status: b.status, createdAt: b.createdAt.toISOString() }))}
            />
          )}
        </>
      );
    case "arquivos":
      return (
        <CampaignMediaPanel
          campaignId={campaign.id}
          editable={editable}
          assets={(props.assets ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url, size: a.size, usage: a.usage, instruction: a.instruction }))}
        />
      );
    case "revisao":
      return (
        <ReviewTab
          campaign={campaign}
          rules={props.rules}
          ads={props.ads?.length ?? 0}
          assets={props.assets?.length ?? 0}
          broadcasts={props.results?.broadcasts.length ?? 0}
          agentName={props.agentSetup.agents.find((a) => a.id === props.agentSetup.agentId)?.name ?? null}
          canActivate={props.canEdit && campaign.allowed.activate}
        />
      );
  }
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-neutral panel:text-white/60">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-ink panel:text-white/90">{children}</dd>
    </div>
  );
}
