import { prisma } from "@/lib/prisma";
import { eventLabel } from "@/modules/audit/events";

/**
 * Leituras da página `/campanhas/[id]` além da própria campanha. Todas levam
 * `tenantId` (vindo da sessão) e nenhuma devolve texto de conversa.
 */

export type CapturedAd = { key: string; adId: string | null; code: string | null; name: string | null; leads: number; lastAt: Date };

/**
 * Anúncios que já trouxeram leads para a conta (capturados do WhatsApp). É a
 * "busca de anúncios" possível sem acesso de leitura à conta de anúncios da
 * Meta: o id e o código que chegam aqui são exatamente os que atribuem o lead.
 */
export async function listCapturedAds(tenantId: string): Promise<CapturedAd[]> {
  const groups = await prisma.leadAdOrigin.groupBy({
    by: ["sourceId", "code", "name"],
    where: { tenantId, lead: { isTest: false } },
    _count: { _all: true },
    _max: { firstAdAt: true },
    orderBy: { _max: { firstAdAt: "desc" } },
    take: 100,
  });
  return groups
    .filter((g) => g.sourceId || g.code)
    .map((g) => ({
      key: `${g.sourceId ?? ""}|${g.code ?? ""}`,
      adId: g.sourceId,
      code: g.code,
      name: g.name,
      leads: g._count._all,
      lastAt: g._max.firstAdAt ?? new Date(0),
    }));
}

/** Disparos da conta que ainda não pertencem a nenhuma campanha. */
export async function listAvailableBroadcasts(tenantId: string) {
  return prisma.broadcastCampaign.findMany({
    where: { tenantId, campaignId: null, status: { not: "cancelled" } },
    select: { id: true, name: true, status: true, createdAt: true, confirmedAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
}

export type CampaignHistoryEntry = {
  id: string;
  createdAt: Date;
  event: string;
  label: string;
  actor: string;
  before: unknown;
  after: unknown;
};

/** A trilha de auditoria da campanha (criação, edição, status, regras, vínculos). */
export async function listCampaignHistory(
  tenantId: string,
  campaignId: string,
  options: { events?: string[]; take?: number } = {},
): Promise<CampaignHistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId,
      targetType: "Campaign",
      targetId: campaignId,
      ...(options.events ? { event: { in: options.events } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 100,
    select: { id: true, createdAt: true, event: true, actorEmail: true, actorRole: true, impersonated: true, before: true, after: true },
  });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    event: row.event,
    label: eventLabel(row.event),
    actor:
      row.actorRole === "SYSTEM"
        ? "Sistema"
        : row.impersonated || row.actorRole === "SUPERADMIN"
          ? "Equipe Mavellium"
          : (row.actorEmail ?? "Usuário da conta"),
    before: row.before,
    after: row.after,
  }));
}
