import type { Metadata } from "next";
import { requireCampaignActor } from "@/modules/campaigns/access";
import { countCampaigns, listCampaigns } from "@/modules/campaigns/queries";
import { parseStatusFilter } from "@/modules/campaigns/status";
import { toCampaignView } from "@/modules/campaigns/view";
import { CampaignsOverview } from "./CampaignsOverview";

export const metadata: Metadata = { title: "Campanhas" };

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const actor = await requireCampaignActor();
  const status = parseStatusFilter((await searchParams).status);

  // Um `now` só para a lista, as contagens das abas e o status de cada linha.
  const now = new Date();
  const [campaigns, counts] = await Promise.all([
    listCampaigns(actor.tenantId, { status, now }),
    countCampaigns(actor.tenantId, now),
  ]);

  return (
    <CampaignsOverview
      campaigns={campaigns.map((campaign) => toCampaignView(campaign, now))}
      counts={counts}
      status={status}
      canEdit={actor.canEdit}
    />
  );
}
