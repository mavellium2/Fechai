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
import { parseSection, parseStep, readOnlyNotice } from "../labels";

export const metadata: Metadata = { title: "Campanha" };

export default async function CampanhaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string | string[]; passo?: string | string[] }>;
}) {
  const actor = await requireCampaignActor();
  const { id } = await params;

  // A conta vem da sessão. Id que não existe e id de outra conta dão o mesmo 404.
  const [campaign, metaEnabled] = await Promise.all([getCampaign(actor.tenantId, id), hasMetaBroadcasts(actor.tenantId)]);
  if (!campaign) notFound();

  const now = new Date();
  const view = toCampaignView(campaign, now);
  const query = await searchParams;
  const parsed = parseSection(query.aba);
  // Rascunho abre na configuração (é o passo a passo); as outras, nos resultados.
  const section = parsed?.section ?? (view.status === "draft" ? "configuracao" : "resultados");
  const step = parseStep(query.passo) ?? parsed?.step ?? null;
  const zone = zoneOrDefault(campaign.timezone);
  const rules = parseCampaignRules(campaign.rules);
  // `updatedAt` nasce junto com a linha; só conta como "alterada" se andou depois.
  const edited = campaign.updatedAt.getTime() - campaign.createdAt.getTime() > 1000;

  const config = section === "configuracao";
  const tenantId = actor.tenantId;
  const copy = campaign.agentId && campaign.baseAgentId && campaign.agentCopiedAt ? campaign : null;
  const [results, ads, assets, capturedAds, availableBroadcasts, history, agents, learned] = await Promise.all([
    section !== "historico" ? loadCampaignResults(tenantId, campaign, now) : null,
    config ? prisma.campaignAd.findMany({ where: { campaignId: campaign.id, tenantId }, orderBy: { createdAt: "asc" } }) : null,
    config ? prisma.campaignAsset.findMany({ where: { campaignId: campaign.id, tenantId }, orderBy: { createdAt: "asc" } }) : null,
    config && step === "origem" ? listCapturedAds(tenantId) : null,
    config && step === "origem" ? listAvailableBroadcasts(tenantId) : null,
    section === "historico" ? listCampaignHistory(tenantId, campaign.id) : null,
    config || section === "resultados"
      ? prisma.agent.findMany({
          where: { tenantId, archived: false },
          select: { id: true, name: true, enabled: true, isPrimary: true, objective: true },
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        })
      : null,
    copy && (config || section === "resultados")
      ? prisma.knowledgeDocument.findMany({
          where: { tenantId, agentId: copy.agentId!, createdAt: { gt: copy.agentCopiedAt! } },
          select: { id: true, title: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : null,
  ]);

  return (
    <CampaignDetail
      campaign={view}
      section={section}
      step={step}
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
        createdBy: campaign.createdBy?.name ?? campaign.createdBy?.email ?? null,
        createdAt: formatDateTime(campaign.createdAt, zone),
        updatedAt: edited ? formatDateTime(campaign.updatedAt, zone) : null,
        updatedBy: campaign.updatedBy?.name ?? campaign.updatedBy?.email ?? null,
      }}
      agentSetup={{
        agentId: campaign.agentId,
        baseAgentId: campaign.baseAgentId,
        agents: agents ?? [],
        learned: (learned ?? []).map((doc) => ({
          id: doc.id,
          title: doc.title,
          createdAt: formatDateTime(doc.createdAt, zone),
          merged: campaign.mergedDocIds.includes(doc.id),
        })),
      }}
      results={results}
      ads={ads}
      assets={assets}
      capturedAds={capturedAds}
      availableBroadcasts={availableBroadcasts}
      history={history}
    />
  );
}
