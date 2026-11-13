import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { CampaignView } from "@/modules/campaigns/view";
import { CampaignStatusBadge } from "./CampaignStatusBadge";

/** Link do nome: o mesmo nos dois formatos da lista, com o foco do produto. */
const NAME_LINK =
  "font-display font-semibold text-ink underline-offset-4 hover:underline panel:text-white " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink rounded-control";

/**
 * A lista de campanhas, em dois formatos para a mesma informação:
 *
 * - **Telas largas (md+):** tabela — Nome, Objetivo (cortado em uma linha),
 *   Período e Situação.
 * - **Celular:** cartões empilhados, com o nome e a situação na primeira linha
 *   e o período numa linha de apoio. O cartão inteiro é o alvo do toque (o
 *   link do nome se estica sobre ele), com a altura de um dedo.
 *
 * Os dois existem no HTML e o CSS mostra um só; nunca há rolagem horizontal da
 * página. Componente de servidor: não tem estado, só apresenta.
 */
export function CampaignList({ campaigns }: { campaigns: CampaignView[] }) {
  return (
    <>
      <Card className="hidden md:block">
        <DataTable
          caption="Campanhas da conta"
          head={["Nome", "Objetivo", "Período", "Situação"]}
          headerAlign="left"
          columnAlign={["left", "left", "left", "left"]}
          rows={campaigns.map((campaign) => ({
            id: campaign.id,
            cells: [
              // `wrap-anywhere`: um nome sem espaços não pode alargar a tabela e empurrar as outras colunas.
              <Link key="nome" href={`/campanhas/${campaign.id}`} className={`${NAME_LINK} wrap-anywhere`}>
                {campaign.name}
              </Link>,
              campaign.objective ? (
                <span key="objetivo" className="block max-w-xs truncate" title={campaign.objective}>
                  {campaign.objective}
                </span>
              ) : (
                <span key="objetivo" className="text-neutral panel:text-white/55">
                  Sem objetivo
                </span>
              ),
              <span key="periodo" className="whitespace-nowrap">
                {campaign.period}
              </span>,
              <CampaignStatusBadge key="situacao" status={campaign.status} />,
            ],
          }))}
        />
      </Card>

      <ul className="space-y-3 md:hidden">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <Card className="relative p-4 transition-colors hover:bg-ink/[0.02] panel:hover:bg-white/[0.07]">
              <div className="flex items-start justify-between gap-3">
                {/* Link esticado: o `::before` cobre o cartão e leva o foco visível. */}
                <Link
                  href={`/campanhas/${campaign.id}`}
                  className={
                    "min-w-0 wrap-anywhere font-display text-base font-semibold text-ink panel:text-white " +
                    "before:absolute before:inset-0 before:rounded-surface focus-visible:outline-none " +
                    "focus-visible:before:ring-2 focus-visible:before:ring-iris"
                  }
                >
                  {campaign.name}
                </Link>
                <CampaignStatusBadge status={campaign.status} className="shrink-0" />
              </div>
              <p className="mt-2 text-sm text-neutral panel:text-white/60">{campaign.period}</p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
