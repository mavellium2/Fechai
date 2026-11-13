import type { Metadata } from "next";
import { requireCampaignActor } from "@/modules/campaigns/access";
import { DEFAULT_CAMPAIGN_TIMEZONE, formatDateTime } from "@/modules/campaigns/period";
import { listCampaigns, listRunningCampaigns } from "@/modules/campaigns/queries";
import { loadCampaignCounts } from "@/modules/campaigns/results";
import { hasSpecialRules, parseCampaignRules } from "@/modules/campaigns/rules";
import { parseStatusFilter } from "@/modules/campaigns/status";
import { toCampaignView } from "@/modules/campaigns/view";
import { todayInZone, zonedTimeToUtc } from "@/modules/scheduling/time";
import { CampaignsOverview, type PeriodFilter } from "./CampaignsOverview";

export const metadata: Metadata = { title: "Campanhas" };

const PERIODS: PeriodFilter[] = ["todos", "mes", "trimestre", "ano"];

/** A janela do filtro de período, no fuso de Brasília (o fuso das campanhas). */
function periodRange(period: PeriodFilter): { from: Date; to: Date } | null {
  if (period === "todos") return null;
  const zone = DEFAULT_CAMPAIGN_TIMEZONE;
  const today = todayInZone(zone);
  const startMonth = period === "mes" ? today.month : period === "trimestre" ? today.month - 2 : 1;
  const from = zonedTimeToUtc(today.year, startMonth, 1, 0, 0, zone);
  const to = period === "ano" ? zonedTimeToUtc(today.year + 1, 1, 1, 0, 0, zone) : zonedTimeToUtc(today.year, today.month + 1, 1, 0, 0, zone);
  return from && to ? { from, to } : null;
}

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; periodo?: string | string[] }>;
}) {
  const actor = await requireCampaignActor();
  const params = await searchParams;
  const status = parseStatusFilter(params.status);
  const rawPeriod = Array.isArray(params.periodo) ? params.periodo[0] : params.periodo;
  const period: PeriodFilter = PERIODS.includes(rawPeriod as PeriodFilter) ? (rawPeriod as PeriodFilter) : "todos";

  // Um `now` só para a lista e o status de cada linha.
  const now = new Date();
  const [campaigns, running] = await Promise.all([
    listCampaigns(actor.tenantId, { status, now, period: periodRange(period) }),
    listRunningCampaigns(actor.tenantId, now),
  ]);
  const numbers = await loadCampaignCounts(actor.tenantId, campaigns);

  return (
    <CampaignsOverview
      campaigns={campaigns.map((campaign) => ({
        ...toCampaignView(campaign, now),
        numbers: numbers.get(campaign.id) ?? { leads: 0, scheduled: 0, attended: 0 },
      }))}
      running={running.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        until: campaign.endsAt ? formatDateTime(campaign.endsAt, campaign.timezone) : null,
        specialRules: hasSpecialRules(parseCampaignRules(campaign.rules)),
      }))}
      status={status}
      period={period}
      canEdit={actor.canEdit}
    />
  );
}
