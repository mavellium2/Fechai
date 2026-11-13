import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCampaignActor } from "@/modules/campaigns/access";
import { formatDateTime, zoneOrDefault } from "@/modules/campaigns/period";
import { getCampaign, hasMetaBroadcasts } from "@/modules/campaigns/queries";
import { toCampaignView } from "@/modules/campaigns/view";
import { CampaignDetail } from "../CampaignDetail";
import { readOnlyNotice, statusNote } from "../labels";

export const metadata: Metadata = { title: "Campanha" };

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCampaignActor();
  const { id } = await params;

  // A conta vem da sessão. Id que não existe e id de outra conta dão o mesmo 404.
  const [campaign, metaEnabled] = await Promise.all([
    getCampaign(actor.tenantId, id),
    hasMetaBroadcasts(actor.tenantId),
  ]);
  if (!campaign) notFound();

  const view = toCampaignView(campaign, new Date());
  const zone = zoneOrDefault(campaign.timezone);
  // `updatedAt` nasce junto com a linha; só conta como "alterada" se andou depois.
  const edited = campaign.updatedAt.getTime() - campaign.createdAt.getTime() > 1000;

  return (
    <CampaignDetail
      campaign={view}
      canEdit={actor.canEdit}
      metaEnabled={metaEnabled}
      notice={readOnlyNotice(view.status, campaign)}
      summary={{
        statusNote: statusNote(view.status, campaign),
        createdBy: campaign.createdBy?.name ?? campaign.createdBy?.email ?? null,
        createdAt: formatDateTime(campaign.createdAt, zone),
        updatedAt: edited ? formatDateTime(campaign.updatedAt, zone) : null,
      }}
    />
  );
}
