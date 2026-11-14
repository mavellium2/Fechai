import type { Campaign, CampaignAsset } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadOverrideReminderRules, overrideAsLeadCampaign } from "@/modules/campaign-override/agent";
import { parseCampaignRules, type CampaignRules } from "./rules";

/**
 * Qual campanha manda no atendimento de um lead AGORA. Fonte única do turno do
 * agente, das ferramentas de agenda, de `createAppointment` e dos lembretes.
 *
 * Uma campanha vale para o lead quando:
 *
 * - o lead está nela (`CampaignLead`);
 * - foi ativada, não está arquivada e o início já chegou;
 * - não está pausada (pausar desliga as regras: é o botão de "pare tudo");
 * - ainda não terminou — ou terminou há no máximo `graceDays` e o lead tem
 *   consulta marcada a partir do início da campanha (a extensão é para "os
 *   agendamentos já feitos", não para reabrir a campanha a quem não marcou).
 *
 * Quando várias valem, ganha a de atribuição mais recente. Teste não tem
 * exceção: o chat de teste usa a mesma regra para o dono conferir a campanha.
 *
 * Sem campanha real, vale a regra provisória da campanha de implantes
 * (`campaign-override`, URG-02/03), vestida de campanha sintética: uma
 * `Campaign` real ligada ao lead sempre vence.
 *
 * Nada aqui grava, e o fim da campanha não precisa de cron: passou da data (e
 * da extensão), a consulta simplesmente deixa de devolvê-la e o lead volta ao
 * fluxo padrão.
 */

const DAY_MS = 86_400_000;
/** O maior `graceDays` aceito (`RULE_LIMITS.graceDays`): limita a busca no banco. */
const MAX_GRACE_DAYS = 30;

export type LeadCampaign = {
  campaign: Pick<Campaign, "id" | "name" | "objective" | "description" | "timezone" | "startsAt" | "endsAt" | "agentId" | "baseAgentId">;
  rules: CampaignRules;
  assets: Pick<CampaignAsset, "id" | "name" | "kind" | "url" | "mime" | "instruction" | "usage">[];
  sentAssetIds: string[];
};

type Candidate = {
  assignedAt: Date;
  campaign: Pick<Campaign, "id" | "startsAt" | "endsAt" | "rules">;
};

/** Filtro de banco das campanhas que PODEM valer (a extensão é conferida depois, em memória). */
export function candidateCampaignWhere(now: Date) {
  return {
    archivedAt: null,
    activatedAt: { not: null },
    pausedAt: null,
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gte: new Date(now.getTime() - MAX_GRACE_DAYS * DAY_MS) } }],
  };
}

/**
 * A campanha vale neste instante? `hasBooking` só é consultado depois do fim,
 * dentro da extensão (quem chama decide se precisa ir ao banco).
 */
export function inRulesWindow(
  campaign: { startsAt: Date | null; endsAt: Date | null; rules: unknown },
  now: Date,
  hasBooking: boolean,
): boolean {
  if (!campaign.startsAt || campaign.startsAt > now) return false;
  if (!campaign.endsAt || campaign.endsAt >= now) return true;
  const grace = parseCampaignRules(campaign.rules).graceDays;
  return hasBooking && grace > 0 && campaign.endsAt.getTime() + grace * DAY_MS >= now.getTime();
}

/** Escolhe a campanha de atribuição mais recente entre as que valem. */
export function pickCampaign<T extends Candidate>(rows: T[], now: Date, bookedSince: (startsAt: Date) => boolean): T | null {
  const valid = rows
    .filter((row) => inRulesWindow(row.campaign, now, row.campaign.startsAt ? bookedSince(row.campaign.startsAt) : false))
    .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
  return valid[0] ?? null;
}

/**
 * A campanha em vigor para o lead, com regras e arquivos. `null` = fluxo
 * padrão. Falha do banco sobe para quem chama: o turno decide se segue sem
 * campanha (prompt) ou recusa (agenda).
 */
export async function findLeadCampaign(tenantId: string, leadId: string, now = new Date()): Promise<LeadCampaign | null> {
  const links = await prisma.campaignLead.findMany({
    where: { tenantId, leadId, campaign: { tenantId, ...candidateCampaignWhere(now) } },
    select: {
      assignedAt: true,
      sentAssetIds: true,
      campaign: {
        select: {
          id: true,
          name: true,
          objective: true,
          description: true,
          timezone: true,
          startsAt: true,
          endsAt: true,
          agentId: true,
          baseAgentId: true,
          rules: true,
          assets: {
            where: { usage: { in: ["agent", "both"] } },
            select: { id: true, name: true, kind: true, url: true, mime: true, instruction: true, usage: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!links.length) return overrideAsLeadCampaign(tenantId, leadId, now);

  // Só vai ao banco atrás de consulta quando alguma campanha já terminou.
  const ended = links.some((link) => link.campaign.endsAt && link.campaign.endsAt < now);
  const bookings = ended
    ? await prisma.appointment.findMany({
        where: { tenantId, leadId, status: "scheduled" },
        select: { createdAt: true },
      })
    : [];
  const chosen = pickCampaign(links, now, (startsAt) => bookings.some((b) => b.createdAt >= startsAt));
  if (!chosen) return overrideAsLeadCampaign(tenantId, leadId, now);
  const { rules, assets, ...campaign } = chosen.campaign;
  return { campaign, rules: parseCampaignRules(rules), assets, sentAssetIds: chosen.sentAssetIds };
}

/**
 * Para a varredura de lembretes: lead → regras da campanha em vigor, só dos
 * leads cujas campanhas mexem nos lembretes (desligado ou personalizado).
 * Uma consulta por varredura, não uma por consulta.
 */
export async function loadReminderOverrides(
  tenantIds: string[],
  now = new Date(),
): Promise<Map<string, CampaignRules>> {
  const result = await loadCampaignReminderOverrides(tenantIds, now);
  // Campanha de implantes: lembretes desligados. A campanha real do lead (que
  // mexe nos lembretes) vence; falha de leitura sobe, como a das campanhas.
  for (const [leadId, rules] of await loadOverrideReminderRules(tenantIds, now)) {
    if (!result.has(leadId)) result.set(leadId, rules);
  }
  return result;
}

async function loadCampaignReminderOverrides(
  tenantIds: string[],
  now: Date,
): Promise<Map<string, CampaignRules>> {
  const result = new Map<string, CampaignRules>();
  if (!tenantIds.length) return result;
  const links = await prisma.campaignLead.findMany({
    where: { tenantId: { in: tenantIds }, campaign: candidateCampaignWhere(now) },
    select: {
      leadId: true,
      tenantId: true,
      assignedAt: true,
      campaign: { select: { id: true, startsAt: true, endsAt: true, rules: true } },
    },
  });
  // Só interessa o lead em que ALGUMA campanha mexe nos lembretes; mas a
  // escolha considera todas as dele — vale a campanha em vigor mais recente,
  // como no turno do agente, mesmo que ela deixe os lembretes no padrão.
  const touched = new Set(
    links.filter((link) => parseCampaignRules(link.campaign.rules).reminders !== "default").map((link) => link.leadId),
  );
  if (!touched.size) return result;
  const byLead = new Map<string, typeof links>();
  for (const link of links) {
    if (touched.has(link.leadId)) byLead.set(link.leadId, [...(byLead.get(link.leadId) ?? []), link]);
  }

  const bookings = await prisma.appointment.findMany({
    where: { leadId: { in: [...touched] }, status: "scheduled" },
    select: { leadId: true, createdAt: true },
  });
  for (const [leadId, rows] of byLead) {
    const own = bookings.filter((b) => b.leadId === leadId);
    const chosen = pickCampaign(rows, now, (startsAt) => own.some((b) => b.createdAt >= startsAt));
    if (!chosen) continue;
    const rules = parseCampaignRules(chosen.campaign.rules);
    if (rules.reminders !== "default") result.set(leadId, rules);
  }
  return result;
}
