import { Megaphone } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { CAMPAIGN_LIST_LIMIT, type CampaignCounts } from "@/modules/campaigns/queries";
import type { CampaignStatusFilter } from "@/modules/campaigns/status";
import type { CampaignView } from "@/modules/campaigns/view";
import { CampaignList } from "./CampaignList";
import { EMPTY_FILTER, FILTER_LABEL, FILTER_ORDER } from "./labels";
import { NewCampaignButton } from "./NewCampaignButton";
import { TAB_ITEM_CLASS, TAB_ROW_CLASS, TabScroller } from "./TabScroller";

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
  counts,
  status,
  canEdit,
}: {
  campaigns: CampaignView[];
  counts: CampaignCounts;
  status: CampaignStatusFilter;
  canEdit: boolean;
}) {
  // "Todas" não inclui as arquivadas, então "a conta não tem nenhuma" soma as duas.
  const hasAny = counts.all + counts.archived > 0;
  const cut = counts[status] > campaigns.length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="campanhas"
        title="Campanhas"
        description="Cada ação de marketing da clínica, com período e resultado."
        actions={canEdit ? <NewCampaignButton /> : undefined}
      />

      {/* Sem nenhuma campanha não há o que filtrar: seis abas zeradas só atrapalham. */}
      {hasAny && (
        <TabScroller>
          <FilterTabs
            label="Filtrar campanhas por situação"
            options={FILTER_ORDER.map((key) => ({ key, label: FILTER_LABEL[key], count: counts[key] }))}
            active={status}
            href={(key) => (key === "all" ? "/campanhas" : `/campanhas?status=${key}`)}
            className={TAB_ROW_CLASS}
            itemClassName={TAB_ITEM_CLASS}
          />
        </TabScroller>
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
