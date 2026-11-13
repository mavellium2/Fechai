import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import type { CampaignView } from "@/modules/campaigns/view";
import { CampaignActions } from "./CampaignActions";
import { CampaignSections, type CampaignSummary } from "./CampaignSections";
import { CampaignStatusBadge } from "./CampaignStatusBadge";

/**
 * A página `/campanhas/[id]` já com os dados na mão: voltar, título com situação
 * e período, ações, aviso de "só para consulta" e as seções. A `page.tsx` cuida
 * da sessão e da busca; aqui só se apresenta.
 *
 * Terminada e arquivada ganham um aviso neutro e nenhum botão de edição (quem
 * decide é `campaign.allowed`). Sem permissão (`canEdit` falso) os botões somem
 * e uma linha discreta diz por quê — a action recusa do mesmo jeito.
 */
export function CampaignDetail({
  campaign,
  summary,
  notice,
  metaEnabled,
  canEdit,
}: {
  campaign: CampaignView;
  summary: CampaignSummary;
  /** "Campanha terminada em…": só para consulta. `null` quando a campanha é editável. */
  notice: string | null;
  metaEnabled: boolean;
  canEdit: boolean;
}) {
  return (
    <div className="w-full space-y-6">
      <Link
        href="/campanhas"
        className={
          "inline-flex min-h-11 items-center gap-1.5 rounded-control text-sm font-medium text-neutral " +
          "hover:text-ink panel:text-white/60 panel:hover:text-white " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 " +
          "focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink sm:min-h-0"
        }
      >
        <ArrowLeft size={16} aria-hidden />
        Voltar para campanhas
      </Link>

      <PageHeader
        eyebrow="campanha"
        title={campaign.name}
        className="break-words"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <CampaignStatusBadge status={campaign.status} />
            <span>{campaign.period}</span>
          </span>
        }
        actions={canEdit ? <CampaignActions campaign={campaign} /> : undefined}
      />

      {!canEdit && (
        <p className="text-sm text-neutral panel:text-white/60">
          Você pode ver, mas só o dono ou um administrador edita.
        </p>
      )}

      {notice && <Alert tone="info">{notice}</Alert>}

      <CampaignSections campaign={campaign} summary={summary} metaEnabled={metaEnabled} />
    </div>
  );
}
