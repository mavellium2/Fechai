import { BarChart3, Bot, Images, MousePointerClick, Send, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { CampaignStatusBadge } from "./CampaignStatusBadge";
import { SECTIONS } from "./labels";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { TAB_ITEM_CLASS, TAB_ROW_CLASS, TabScroller } from "./TabScroller";
import type { CampaignView } from "@/modules/campaigns/view";

/** O que o Resumo mostra além da campanha: já formatado no servidor, no fuso dela. */
export type CampaignSummary = {
  statusNote: string;
  createdBy: string | null;
  createdAt: string;
  /** `null` = nunca foi alterada depois de criada. */
  updatedAt: string | null;
};

/**
 * O corpo da página da campanha: a navegação entre seções e uma coluna única de
 * cartões. O **Resumo** é conteúdo de verdade; as outras cinco seções são
 * marcadores de lugar do que os próximos cards vão trazer.
 *
 * A navegação são âncoras (`#anuncios`…), não abas: tudo está na mesma página e
 * ninguém precisa de um painel por vez. Reaproveita as pílulas do `FilterTabs`
 * sem item ativo, porque nenhuma seção é "a escolhida".
 */
export function CampaignSections({
  campaign,
  summary,
  metaEnabled,
}: {
  campaign: CampaignView;
  summary: CampaignSummary;
  /** Disparos só aparece como destino para a conta que tem a Meta liberada. */
  metaEnabled: boolean;
}) {
  return (
    <>
      <TabScroller>
        <FilterTabs
          label="Seções da campanha"
          options={SECTIONS.map(({ id, label }) => ({ key: id, label }))}
          active=""
          href={(key) => `#${key}`}
          className={TAB_ROW_CLASS}
          itemClassName={TAB_ITEM_CLASS}
        />
      </TabScroller>

      <div className="space-y-6">
        <Card id="resumo" className="scroll-mt-4 p-4 sm:p-6">
          <CardTitle>Resumo</CardTitle>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Row label="Objetivo" wide>
              {campaign.objective ? (
                <span className="whitespace-pre-line break-words">{campaign.objective}</span>
              ) : (
                <span className="text-neutral panel:text-white/60">Nenhum objetivo definido.</span>
              )}
            </Row>
            <Row label="Período">{campaign.period}</Row>
            <Row label="Situação">
              <span className="flex flex-wrap items-center gap-2">
                <CampaignStatusBadge status={campaign.status} />
                <span className="text-neutral panel:text-white/60">{summary.statusNote}</span>
              </span>
            </Row>
            <Row label="Criada por">
              {summary.createdBy ?? <span className="text-neutral panel:text-white/60">Não informado</span>}
            </Row>
            <Row label="Criada em">{summary.createdAt}</Row>
            <Row label="Atualizada em">
              {summary.updatedAt ?? <span className="text-neutral panel:text-white/60">Ainda não foi alterada</span>}
            </Row>
          </dl>
        </Card>

        <SectionPlaceholder
          id="anuncios"
          title="Anúncios"
          icon={MousePointerClick}
          description="Aqui vão aparecer os anúncios ligados a esta campanha, para saber quais leads vieram dela."
        />
        <SectionPlaceholder
          id="regras"
          title="Regras do agente"
          icon={Bot}
          description="Instruções que o agente segue só durante esta campanha."
        />
        <SectionPlaceholder
          id="midias"
          title="Mídias"
          icon={Images}
          description="Imagens e vídeos usados na campanha."
        />
        <SectionPlaceholder
          id="disparos"
          title="Disparos"
          icon={Send}
          description="Mensagens em massa enviadas para esta campanha."
          link={
            metaEnabled ? (
              <ButtonLink href="/disparos" variant="outline" size="sm" className="max-sm:h-11">
                Ir para Disparos
              </ButtonLink>
            ) : undefined
          }
        />
        <SectionPlaceholder
          id="leads"
          title="Leads"
          icon={Users}
          description="Contatos que chegaram pela campanha."
        />
        <SectionPlaceholder
          id="resultados"
          title="Resultados"
          icon={BarChart3}
          description="Agendamentos e comparecimentos da campanha."
          link={
            // O texto é longo: no celular o botão cresce em altura em vez de estourar a largura.
            <ButtonLink
              href="/relatorios?visao=campanhas"
              variant="outline"
              size="sm"
              className="max-sm:h-auto max-sm:min-h-11 max-sm:py-2 max-sm:text-center"
            >
              Ver visão geral em Relatórios › Campanhas
            </ButtonLink>
          }
        />
      </div>
    </>
  );
}

/** Uma linha do Resumo: rótulo pequeno em cima, valor embaixo. `wide` ocupa as duas colunas. */
function Row({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-sm text-neutral panel:text-white/60">{label}</dt>
      <dd className="mt-1 text-sm text-ink panel:text-white/90">{children}</dd>
    </div>
  );
}
