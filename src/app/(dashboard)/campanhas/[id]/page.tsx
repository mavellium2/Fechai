import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCampaignActor } from "@/modules/campaigns/access";
import { listAvailableBroadcasts, listCampaignHistory, listCapturedAds } from "@/modules/campaigns/detail";
import { formatDateTime, zoneOrDefault } from "@/modules/campaigns/period";
import { getCampaign, hasMetaBroadcasts } from "@/modules/campaigns/queries";
import { loadCampaignResults } from "@/modules/campaigns/results";
import { parseCampaignRules } from "@/modules/campaigns/rules";
import { toCampaignView } from "@/modules/campaigns/view";
import { CampaignDetail } from "../CampaignDetail";
import { parseSection, readOnlyNotice, statusNote, type SectionId } from "../labels";

export const metadata: Metadata = { title: "Campanha" };

const RULE_EVENTS = ["campaign.rules_updated"];

export default async function CampanhaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string | string[] }>;
}) {
  const actor = await requireCampaignActor();
  const { id } = await params;

  // A conta vem da sessão. Id que não existe e id de outra conta dão o mesmo 404.
  const [campaign, metaEnabled] = await Promise.all([getCampaign(actor.tenantId, id), hasMetaBroadcasts(actor.tenantId)]);
  if (!campaign) notFound();

  const now = new Date();
  const view = toCampaignView(campaign, now);
  const section: SectionId = parseSection((await searchParams).aba) ?? (view.status === "draft" ? "dados" : "visao-geral");
  const zone = zoneOrDefault(campaign.timezone);
  const rules = parseCampaignRules(campaign.rules);
  // `updatedAt` nasce junto com a linha; só conta como "alterada" se andou depois.
  const edited = campaign.updatedAt.getTime() - campaign.createdAt.getTime() > 1000;

  const needsResults = section === "visao-geral" || section === "leads" || section === "disparos";
  const needsSetup = section === "anuncios" || section === "revisao";
  const [results, ads, assets, capturedAds, availableBroadcasts, history, linkedBroadcasts] = await Promise.all([
    needsResults ? loadCampaignResults(actor.tenantId, campaign, now) : null,
    needsSetup
      ? prisma.campaignAd.findMany({ where: { campaignId: campaign.id, tenantId: actor.tenantId }, orderBy: { createdAt: "asc" } })
      : null,
    needsSetup
      ? prisma.campaignAsset.findMany({ where: { campaignId: campaign.id, tenantId: actor.tenantId }, orderBy: { createdAt: "asc" } })
      : null,
    section === "anuncios" ? listCapturedAds(actor.tenantId) : null,
    section === "disparos" ? listAvailableBroadcasts(actor.tenantId) : null,
    section === "historico" || section === "regras"
      ? listCampaignHistory(actor.tenantId, campaign.id, section === "regras" ? { events: RULE_EVENTS, take: 20 } : {})
      : null,
    section === "revisao"
      ? prisma.broadcastCampaign.findMany({ where: { tenantId: actor.tenantId, campaignId: campaign.id }, select: { id: true, name: true } })
      : null,
  ]);

  return (
    <CampaignDetail
      campaign={view}
      section={section}
      canEdit={actor.canEdit}
      metaEnabled={metaEnabled}
      notice={readOnlyNotice(view.status, campaign)}
      timezone={zone}
      rules={rules}
      ruleWindow={{
        endsAt: campaign.endsAt ? formatDateTime(campaign.endsAt, zone) : null,
        graceUntil:
          campaign.endsAt && rules.graceDays > 0
            ? formatDateTime(new Date(campaign.endsAt.getTime() + rules.graceDays * 86_400_000), zone)
            : null,
      }}
      summary={{
        statusNote: statusNote(view.status, campaign),
        createdBy: campaign.createdBy?.name ?? campaign.createdBy?.email ?? null,
        createdAt: formatDateTime(campaign.createdAt, zone),
        updatedAt: edited ? formatDateTime(campaign.updatedAt, zone) : null,
        updatedBy: campaign.updatedBy?.name ?? campaign.updatedBy?.email ?? null,
      }}
      results={results}
      ads={ads}
      assets={assets}
      capturedAds={capturedAds}
      availableBroadcasts={availableBroadcasts}
      linkedBroadcasts={linkedBroadcasts}
      history={history}
    />
  );
}
