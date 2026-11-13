import { ArrowLeft, ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FilterTabs } from "@/components/ui/filter-tabs";
import type { CampaignDetail } from "./CampaignDetail";
import { CampaignAdsPanel } from "./CampaignAdsPanel";
import { CampaignBroadcastsPanel } from "./CampaignBroadcastsPanel";
import { CampaignLeadsPanel } from "./CampaignLeadsPanel";
import { CampaignMediaPanel } from "./CampaignMediaPanel";
import { GeneralTab } from "./GeneralTab";
import { HistoryTab } from "./HistoryTab";
import { SECTIONS, type SectionId } from "./labels";
import { OverviewTab } from "./OverviewTab";
import { ReviewTab } from "./ReviewTab";
import { RulesTab } from "./RulesTab";
import { TAB_ITEM_CLASS, TAB_ROW_CLASS, TabScroller } from "./TabScroller";

/** O que o Resumo mostra além da campanha: já formatado no servidor, no fuso dela. */
export type CampaignSummary = {
  statusNote: string;
  createdBy: string | null;
  createdAt: string;
  /** `null` = nunca foi alterada depois de criada. */
  updatedAt: string | null;
  updatedBy: string | null;
};

/** O passo a passo da criação: a ordem em que um rascunho é montado. */
const WIZARD: SectionId[] = ["dados", "anuncios", "disparos", "regras", "revisao"];

/**
 * O corpo da página da campanha: as abas (`?aba=`) e a aba aberta. Rascunho
 * ganha o passo a passo da criação — Dados gerais → Anúncios e mídias →
 * Disparos → Regras do agente → Revisão — com "Voltar" e "Próximo passo" no fim
 * de cada aba. Tudo é salvo na hora em cada aba: "salvar como rascunho" é só
 * não ativar.
 */
export function CampaignSections(props: Parameters<typeof CampaignDetail>[0]) {
  const { campaign, section } = props;
  const editable = props.canEdit && campaign.allowed.edit;
  const draft = campaign.status === "draft";
  const step = WIZARD.indexOf(section);
  const href = (key: string) => `/campanhas/${campaign.id}?aba=${key}`;

  return (
    <>
      {draft && (
        <ol className="flex flex-wrap gap-2 text-sm" aria-label="Passos da criação da campanha">
          {WIZARD.map((key, index) => {
            const label = SECTIONS.find((s) => s.id === key)!.label;
            const current = key === section;
            return (
              <li key={key}>
                <a
                  href={href(key)}
                  aria-current={current ? "step" : undefined}
                  className={
                    "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 sm:min-h-0 sm:py-1 " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris " +
                    (current
                      ? "border-iris bg-iris/10 text-ink panel:text-white"
                      : "border-ink/10 text-neutral hover:text-ink panel:border-white/15 panel:text-white/60 panel:hover:text-white")
                  }
                >
                  <span className="font-mono text-micro">{index + 1}</span>
                  {label}
                </a>
              </li>
            );
          })}
        </ol>
      )}

      <TabScroller>
        <FilterTabs
          label="Abas da campanha"
          options={SECTIONS.map(({ id, label }) => ({ key: id, label }))}
          active={section}
          href={href}
          className={TAB_ROW_CLASS}
          itemClassName={TAB_ITEM_CLASS}
        />
      </TabScroller>

      <div className="space-y-6">
        {section === "visao-geral" && props.results && <OverviewTab campaign={campaign} results={props.results} />}
        {section === "dados" && <GeneralTab campaign={campaign} summary={props.summary} editable={editable} />}
        {section === "anuncios" && props.ads && props.assets && props.capturedAds && (
          <>
            <CampaignAdsPanel
              campaignId={campaign.id}
              editable={editable}
              ads={props.ads.map((ad) => ({ id: ad.id, adId: ad.adId, adsetId: ad.adsetId, metaCampaignId: ad.metaCampaignId, code: ad.code, displayName: ad.displayName }))}
              captured={props.capturedAds.map((ad) => ({ ...ad, lastAt: ad.lastAt.toISOString() }))}
            />
            <CampaignMediaPanel
              campaignId={campaign.id}
              editable={editable}
              assets={props.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url, size: a.size, usage: a.usage, instruction: a.instruction }))}
            />
          </>
        )}
        {section === "disparos" && props.results && props.availableBroadcasts && (
          <CampaignBroadcastsPanel
            campaignId={campaign.id}
            editable={editable}
            metaEnabled={props.metaEnabled}
            timezone={props.timezone}
            broadcasts={props.results.broadcasts.map((b) => ({ ...b, confirmedAt: b.confirmedAt?.toISOString() ?? null }))}
            totals={props.results.broadcastTotals}
            available={props.availableBroadcasts.map((b) => ({ id: b.id, name: b.name, status: b.status, createdAt: b.createdAt.toISOString() }))}
          />
        )}
        {section === "regras" && (
          <RulesTab
            campaign={campaign}
            rules={props.rules}
            editable={editable}
            window={props.ruleWindow}
            history={props.history ?? []}
            timezone={props.timezone}
          />
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
        {section === "historico" && <HistoryTab history={props.history ?? []} timezone={props.timezone} />}
        {section === "revisao" && props.ads && props.assets && props.linkedBroadcasts && (
          <ReviewTab
            campaign={campaign}
            rules={props.rules}
            ads={props.ads.length}
            assets={props.assets.length}
            broadcasts={props.linkedBroadcasts.length}
            canActivate={props.canEdit && campaign.allowed.activate}
          />
        )}
      </div>

      {draft && step >= 0 && (
        <nav aria-label="Passo a passo" className="flex flex-wrap justify-between gap-2">
          {step > 0 ? (
            <ButtonLink href={href(WIZARD[step - 1])} variant="ghost" className="max-sm:h-11">
              <ArrowLeft size={16} aria-hidden />
              Voltar
            </ButtonLink>
          ) : (
            <span />
          )}
          {step < WIZARD.length - 1 && (
            <ButtonLink href={href(WIZARD[step + 1])} className="max-sm:h-11">
              Próximo passo
              <ArrowRight size={16} aria-hidden />
            </ButtonLink>
          )}
        </nav>
      )}
    </>
  );
}
