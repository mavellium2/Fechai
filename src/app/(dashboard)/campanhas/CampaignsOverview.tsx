import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { CAMPAIGN_LIST_LIMIT, type CampaignCounts } from "@/modules/campaigns/queries";
import type { CampaignStatusFilter } from "@/modules/campaigns/status";
import { CampaignList, type ListedCampaign } from "./CampaignList";
import { EMPTY_FILTER, FILTER_LABEL, FILTER_ORDER } from "./labels";
import { NewCampaignButton } from "./NewCampaignButton";
import { CampaignGuideButton, CampaignIntro } from "./CampaignGuide";
import { PeriodSelect } from "./PeriodSelect";
import { TAB_ITEM_CLASS, TAB_ROW_CLASS, TabScroller } from "./TabScroller";

export type PeriodFilter = "todos" | "mes" | "trimestre" | "ano";

const PERIOD_LABEL: Record<PeriodFilter, string> = { todos: "Qualquer período", mes: "Este mês", trimestre: "Últimos 3 meses", ano: "Este ano" };

export type RunningCampaign = { id: string; name: string; until: string | null; specialRules: boolean };

/**
 * A tela `/campanhas` já com os dados na mão: cabeçalho, abas por situação e a
 * lista (ou o estado vazio certo). Quem busca os dados e confere a sessão é a
 * `page.tsx`; aqui só se apresenta — o que mantém a página fina e esta parte
 * testável com dados de mentira.
 *
 * Os quatro estados da tela: carregando é o `loading.tsx` ao lado, erro é o
 * `error.tsx` do painel, e vazio e preenchido são daqui.
 */
export function CampaignsOverview({
  campaigns,
  running,
  counts,
  status,
  period,
  canEdit,
}: {
  campaigns: ListedCampaign[];
  running: RunningCampaign[];
  counts: CampaignCounts;
  status: CampaignStatusFilter;
  period: PeriodFilter;
  canEdit: boolean;
}) {
  const query = (next: { status?: CampaignStatusFilter; period?: PeriodFilter }) => {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const p = next.period ?? period;
    if (s !== "all") params.set("status", s);
    if (p !== "todos") params.set("periodo", p);
    return params.size ? `/campanhas?${params}` : "/campanhas";
  };
  const special = running.filter((campaign) => campaign.specialRules);
  // "Todas" não inclui as arquivadas, então "a conta não tem nenhuma" soma as duas.
  const hasAny = counts.all + counts.archived > 0;
  const cut = counts[status] > campaigns.length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="campanhas"
        title="Campanhas"
        description="Cada ação de marketing da clínica, com período e resultado."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CampaignGuideButton />
            {canEdit && <NewCampaignButton />}
          </div>
        }
      />

      <CampaignIntro />

      {special.length > 0 && (
        <Alert tone="warn" title="Regra especial em vigor">
          {special.length === 1 ? "A campanha " : "As campanhas "}
          {special.map((campaign, index) => (
            <span key={campaign.id}>
              {index > 0 && (index === special.length - 1 ? " e " : ", ")}
              <Link href={`/campanhas/${campaign.id}?aba=regras`} className="font-medium underline underline-offset-4">
                {campaign.name}
              </Link>
            </span>
          ))}{" "}
          {special.length === 1 ? "muda" : "mudam"} o atendimento do agente para os leads delas (datas, horários, lembretes ou instruções).
        </Alert>
      )}

      {running.length > 0 && (
        <section aria-labelledby="ativas-agora" className="space-y-2">
          <h2 id="ativas-agora" className="font-display text-base font-semibold text-ink panel:text-white">
            Ativas agora
          </h2>
          <ul className="flex flex-wrap gap-2">
            {running.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/campanhas/${campaign.id}`}
                  className={
                    "inline-flex min-h-11 items-center gap-2 rounded-full border border-iris/30 bg-iris/10 px-3 text-sm text-ink " +
                    "hover:bg-iris/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris panel:text-white sm:min-h-0 sm:py-1"
                  }
                >
                  {campaign.name}
                  {campaign.until && <span className="text-neutral panel:text-white/60">até {campaign.until}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sem nenhuma campanha não há o que filtrar: seis abas zeradas só atrapalham. */}
      {hasAny && (
        <>
          <TabScroller>
            <FilterTabs
              label="Filtrar campanhas por situação"
              options={FILTER_ORDER.map((key) => ({ key, label: FILTER_LABEL[key], count: counts[key] }))}
              active={status}
              href={(key) => query({ status: key as CampaignStatusFilter })}
              className={TAB_ROW_CLASS}
              itemClassName={TAB_ITEM_CLASS}
            />
          </TabScroller>
          <PeriodSelect
            value={period}
            options={(Object.keys(PERIOD_LABEL) as PeriodFilter[]).map((key) => ({ value: key, label: PERIOD_LABEL[key] }))}
            hrefFor={Object.fromEntries((Object.keys(PERIOD_LABEL) as PeriodFilter[]).map((key) => [key, query({ period: key })]))}
          />
        </>
      )}

      {!hasAny ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title="Nenhuma campanha ainda"
            description={
              canEdit
                ? "Crie uma campanha para juntar anúncios, mensagens e resultados num lugar só."
                : "Quando alguém com permissão criar uma campanha, ela aparece aqui."
            }
            action={canEdit ? <NewCampaignButton /> : undefined}
          />
        </Card>
      ) : campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title={EMPTY_FILTER[status].title}
            description={EMPTY_FILTER[status].description}
            action={
              status === "all" ? (
                <ButtonLink href="/campanhas?status=archived" variant="outline">
                  Ver arquivadas
                </ButtonLink>
              ) : (
                <ButtonLink href="/campanhas" variant="outline">
                  Ver todas
                </ButtonLink>
              )
            }
          />
        </Card>
      ) : (
        <>
          <CampaignList campaigns={campaigns} />
          {cut && (
            <p className="text-sm text-neutral panel:text-white/60">
              Mostrando as {CAMPAIGN_LIST_LIMIT} campanhas mais recentes de {counts[status]}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
