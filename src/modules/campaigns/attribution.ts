import { prisma } from "@/lib/prisma";

/**
 * Como um lead entra numa campanha. Ordem da spec: anúncio → disparo →
 * palavra-chave → manual. Cada caminho grava um `CampaignLead` com a origem; o
 * mesmo lead na mesma campanha é uma linha só (a primeira origem fica).
 *
 * Toda função daqui **nunca lança**: atribuir é um extra do webhook e do turno
 * do agente, e uma falha não pode derrubar a mensagem do contato.
 */

export type AttributionSource = "anuncio" | "disparo" | "palavra_chave" | "manual";

export const SOURCE_LABEL: Record<AttributionSource, string> = {
  anuncio: "Anúncio",
  disparo: "Disparo",
  palavra_chave: "Palavra-chave",
  manual: "Manual",
};

export function isAttributionSource(value: unknown): value is AttributionSource {
  return value === "anuncio" || value === "disparo" || value === "palavra_chave" || value === "manual";
}

/**
 * Campanhas que aceitam lead novo: ativadas, não arquivadas e não terminadas.
 * Agendada (início no futuro) aceita — o lead do anúncio que já está no ar
 * fica guardado e as regras passam a valer quando a campanha começa.
 */
function openCampaignWhere(at: Date) {
  return { archivedAt: null, activatedAt: { not: null }, OR: [{ endsAt: null }, { endsAt: { gte: at } }] };
}

/** Grava o vínculo. `created` diz se é novo. Nunca lança. */
export async function attributeLead(input: {
  tenantId: string;
  campaignId: string;
  leadId: string;
  source: AttributionSource;
  at?: Date;
  assignedById?: string | null;
}): Promise<{ created: boolean }> {
  try {
    const result = await prisma.campaignLead.createMany({
      data: [
        {
          tenantId: input.tenantId,
          campaignId: input.campaignId,
          leadId: input.leadId,
          source: input.source,
          assignedAt: input.at ?? new Date(),
          assignedById: input.assignedById ?? null,
        },
      ],
      skipDuplicates: true,
    });
    return { created: result.count > 0 };
  } catch (err) {
    console.error("[campanhas] atribuição não gravada", input.campaignId, input.leadId, err);
    return { created: false };
  }
}

/** Lead de teste nunca entra por atribuição automática de anúncio ou disparo. */
async function isTestLead(tenantId: string, leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { isTest: true } });
  return !lead || lead.isTest;
}

/**
 * Lead que chegou por anúncio: entra nas campanhas que têm esse anúncio
 * vinculado (pelo id do anúncio da Meta ou pelo código escrito no anúncio).
 */
export async function attributeByAd(input: {
  tenantId: string;
  leadId: string;
  origin: { sourceId: string | null; code: string | null };
  at: Date;
}): Promise<void> {
  try {
    const { sourceId, code } = input.origin;
    if (!sourceId && !code) return;
    if (await isTestLead(input.tenantId, input.leadId)) return;
    const ads = await prisma.campaignAd.findMany({
      where: {
        tenantId: input.tenantId,
        OR: [...(sourceId ? [{ adId: sourceId }] : []), ...(code ? [{ code: { equals: code, mode: "insensitive" as const } }] : [])],
        campaign: { tenantId: input.tenantId, ...openCampaignWhere(input.at) },
      },
      select: { campaignId: true },
    });
    for (const campaignId of new Set(ads.map((ad) => ad.campaignId))) {
      await attributeLead({ tenantId: input.tenantId, campaignId, leadId: input.leadId, source: "anuncio", at: input.at });
    }
  } catch (err) {
    console.error("[campanhas] atribuição por anúncio falhou", input.leadId, err);
  }
}

/** Lead que respondeu a um disparo vinculado a uma campanha. */
export async function attributeByBroadcast(input: {
  tenantId: string;
  leadId: string;
  broadcastId: string;
  at: Date;
}): Promise<void> {
  try {
    const broadcast = await prisma.broadcastCampaign.findFirst({
      where: { id: input.broadcastId, tenantId: input.tenantId, campaignId: { not: null } },
      select: { campaign: { select: { id: true, tenantId: true, archivedAt: true, activatedAt: true, endsAt: true } } },
    });
    const campaign = broadcast?.campaign;
    if (!campaign || campaign.tenantId !== input.tenantId || campaign.archivedAt || !campaign.activatedAt) return;
    if (campaign.endsAt && campaign.endsAt < input.at) return;
    if (await isTestLead(input.tenantId, input.leadId)) return;
    await attributeLead({ tenantId: input.tenantId, campaignId: campaign.id, leadId: input.leadId, source: "disparo", at: input.at });
  } catch (err) {
    console.error("[campanhas] atribuição por disparo falhou", input.leadId, err);
  }
}

/** Minúsculas e sem acento: "IMPLANTE", "Implânte" e "implante" são o mesmo termo. */
export function normalizeKeyword(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A mensagem contém o termo como palavra (ou expressão) inteira? */
export function messageHasKeyword(message: string, keyword: string): boolean {
  const term = normalizeKeyword(keyword);
  if (!term) return false;
  const text = ` ${normalizeKeyword(message).replace(/[^\p{L}\p{N} ]+/gu, " ")} `;
  return text.includes(` ${term} `);
}

/**
 * A PRIMEIRA mensagem do contato desde o início da campanha contém um termo
 * configurado? Então o lead entra nela. Teste entra também: é assim que o dono
 * confere a campanha no chat de teste (a lista de leads da campanha esconde
 * teste). Só é chamado no turno do agente, com a mensagem já gravada.
 */
export async function attributeByKeyword(input: {
  tenantId: string;
  leadId: string;
  conversationId: string;
  message: string;
  now?: Date;
}): Promise<void> {
  try {
    const now = input.now ?? new Date();
    const campaigns = await prisma.campaign.findMany({
      where: {
        tenantId: input.tenantId,
        ...openCampaignWhere(now),
        startsAt: { lte: now },
        keywords: { isEmpty: false },
        leads: { none: { leadId: input.leadId } },
      },
      select: { id: true, startsAt: true, keywords: true },
    });
    for (const campaign of campaigns) {
      if (!campaign.keywords.some((k) => messageHasKeyword(input.message, k))) continue;
      const inbound = await prisma.message.count({
        where: { conversationId: input.conversationId, role: "user", createdAt: { gte: campaign.startsAt ?? now } },
      });
      // A mensagem atual já está gravada: a "inicial" é a única desde o início.
      if (inbound > 1) continue;
      await attributeLead({ tenantId: input.tenantId, campaignId: campaign.id, leadId: input.leadId, source: "palavra_chave", at: now });
    }
  } catch (err) {
    console.error("[campanhas] atribuição por palavra-chave falhou", input.leadId, err);
  }
}
