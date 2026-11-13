import { prisma } from "@/lib/prisma";
import { broadcastFunnel, broadcastFunnelSelect, loadBroadcastAttendance } from "@/modules/broadcasts/funnel";
import type { resolveRange } from "./service";

export async function loadBroadcastCampaignReport(tenantId: string, range: ReturnType<typeof resolveRange>) {
  const query = (from: Date | null, to: Date) => prisma.broadcastCampaign.findMany({
    where: { tenantId, confirmedAt: { gte: from ?? new Date(0), lte: to } },
    select: {
      id: true, name: true, confirmedAt: true,
      recipients: { where: { isTest: false }, select: broadcastFunnelSelect },
    },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
  });
  const [current, previous] = await Promise.all([
    query(range.from, range.to),
    range.prevFrom && range.prevTo ? query(range.prevFrom, range.prevTo) : [],
  ]);
  const attended = await loadBroadcastAttendance(tenantId, [...current, ...previous].flatMap((campaign) => campaign.recipients));
  const summarize = ({ recipients, ...campaign }: (typeof current)[number]) => ({
    ...campaign, ...broadcastFunnel(recipients, attended),
  });
  return { current: current.map(summarize), previous: previous.map(summarize) };
}

export type BroadcastCampaignReport = Awaited<ReturnType<typeof loadBroadcastCampaignReport>>;

export function sumBroadcastCampaigns(rows: BroadcastCampaignReport["current"]) {
  const totals = broadcastFunnel([]);
  for (const row of rows) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += row[key];
  }
  return totals;
}
