import { prisma } from "@/lib/prisma";
import { broadcastPhoneVariants } from "@/modules/broadcasts/phone";
import { normalizeAdCode, parseOverrideRules, type OverrideRules } from "./config";

/**
 * Quem é "lead da campanha" enquanto a regra provisória vale (URG-01).
 *
 * Tudo aqui **nunca lança**: é consultado no caminho do agente e do relatório, e
 * um banco fora do ar não pode derrubar uma conversa. Na dúvida, não é lead da
 * campanha (`false`/`null`) — o corte da regra é rígido e a falha não o amplia.
 * A resposta nunca carrega nome, telefone ou texto de conversa.
 */

export type CampaignOverride = {
  id: string;
  key: string;
  adCodes: string[];
  adSourceIds: string[];
  broadcastCampaignIds: string[];
  leadIds: string[];
  startsAt: Date;
  endsAt: Date;
  rules: OverrideRules;
};

/** Por onde o lead entrou: `label` é "anúncio AD27", "disparo" ou "manual". */
export type CampaignLeadOrigin = {
  kind: "anuncio" | "disparo" | "manual";
  label: string;
};

export type CampaignLeadMatch = { override: CampaignOverride; origin: CampaignLeadOrigin };

/** Regras do tenant que valem em `now`. Corte rígido: fim às 23:59:59, sem carência. */
async function activeOverrides(tenantId: string, now: Date): Promise<CampaignOverride[]> {
  const rows = await prisma.campaignOverride.findMany({
    where: { tenantId, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    adCodes: (row.adCodes ?? []).map((code) => normalizeAdCode(code)).filter((code): code is string => code !== null),
    adSourceIds: row.adSourceIds ?? [],
    broadcastCampaignIds: row.broadcastCampaignIds ?? [],
    leadIds: row.leadIds ?? [],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    rules: parseOverrideRules(row.rules),
  }));
}

const digits = (value: string) => value.replace(/\D/g, "");

/**
 * Resolve vários leads de uma vez (uma consulta por origem, não por lead).
 * Prioridade da origem: anúncio, depois disparo, depois marcação manual.
 */
export async function resolveCampaignLeadMatches(tenantId: string, leadIds: string[], now: Date): Promise<Map<string, CampaignLeadMatch>> {
  const found = new Map<string, CampaignLeadMatch>();
  const ids = [...new Set(leadIds)];
  if (!ids.length) return found;
  const overrides = await activeOverrides(tenantId, now);

  for (const override of overrides) {
    const pending = () => ids.filter((id) => !found.has(id));
    const claim = (leadId: string, origin: CampaignLeadOrigin) => {
      if (!found.has(leadId)) found.set(leadId, { override, origin });
    };

    // Anúncio: `LeadAdOrigin` do lead, por código (sem diferença de maiúsculas) ou id do anúncio.
    if ((override.adCodes.length || override.adSourceIds.length) && pending().length) {
      const origins = await prisma.leadAdOrigin.findMany({
        where: { tenantId, leadId: { in: pending() } },
        select: { leadId: true, code: true, sourceId: true },
      });
      for (const origin of origins) {
        const code = normalizeAdCode(origin.code);
        if (code && override.adCodes.includes(code)) claim(origin.leadId, { kind: "anuncio", label: `anúncio ${code}` });
        else if (origin.sourceId && override.adSourceIds.includes(origin.sourceId)) {
          claim(origin.leadId, { kind: "anuncio", label: `anúncio ${code ?? origin.sourceId}` });
        }
      }
    }

    // Disparo: destinatário real (não teste) de um disparo da lista, ligado ao lead pela
    // conversa gravada no envio ou pelo telefone (o celular pode chegar com ou sem o nono dígito).
    if (override.broadcastCampaignIds.length && pending().length) {
      const leads = await prisma.lead.findMany({
        where: { tenantId, id: { in: pending() } },
        select: { id: true, phone: true, conversation: { select: { id: true } } },
      });
      const byConversation = new Map<string, string>();
      const byPhone = new Map<string, string>();
      for (const lead of leads) {
        if (lead.conversation?.id) byConversation.set(lead.conversation.id, lead.id);
        for (const variant of broadcastPhoneVariants(digits(lead.phone))) byPhone.set(variant, lead.id);
      }
      if (byConversation.size || byPhone.size) {
        const recipients = await prisma.broadcastRecipient.findMany({
          where: {
            campaignId: { in: override.broadcastCampaignIds },
            campaign: { tenantId },
            isTest: false,
            status: { in: ["sent", "unknown"] },
            OR: [{ conversationId: { in: [...byConversation.keys()] } }, { phone: { in: [...byPhone.keys()] } }],
          },
          select: { conversationId: true, phone: true },
        });
        for (const recipient of recipients) {
          const leadId =
            (recipient.conversationId ? byConversation.get(recipient.conversationId) : undefined) ?? byPhone.get(recipient.phone);
          if (leadId) claim(leadId, { kind: "disparo", label: "disparo" });
        }
      }
    }

    // Marcação manual: vale também para lead de teste, para validar no sandbox.
    for (const id of pending()) {
      if (override.leadIds.includes(id)) claim(id, { kind: "manual", label: "manual" });
    }
  }
  return found;
}

/** Vários leads de uma vez, para a lista da recepção. Erro devolve mapa vazio. */
export async function campaignLeadMatches(tenantId: string, leadIds: string[], now: Date = new Date()): Promise<Map<string, CampaignLeadMatch>> {
  try {
    return await resolveCampaignLeadMatches(tenantId, leadIds, now);
  } catch (err) {
    console.error("[campanha-override] não foi possível resolver os leads da campanha", tenantId, err instanceof Error ? err.message : "erro");
    return new Map();
  }
}

/** A regra pela qual este lead é da campanha agora, ou null. */
export async function getCampaignOverrideForLead(tenantId: string, leadId: string, now: Date = new Date()): Promise<CampaignOverride | null> {
  return (await campaignLeadMatches(tenantId, [leadId], now)).get(leadId)?.override ?? null;
}

/** Origem do lead na campanha ("anúncio AD27", "disparo", "manual") ou null. Sem dado pessoal. */
export async function campaignLeadOrigin(tenantId: string, leadId: string, now: Date = new Date()): Promise<CampaignLeadOrigin | null> {
  return (await campaignLeadMatches(tenantId, [leadId], now)).get(leadId)?.origin ?? null;
}

/** O lead é da campanha agora? Nunca lança; qualquer erro é `false`. */
export async function isCampaignLead(tenantId: string, leadId: string, now: Date = new Date()): Promise<boolean> {
  try {
    return (await resolveCampaignLeadMatches(tenantId, [leadId], now)).has(leadId);
  } catch {
    return false;
  }
}
