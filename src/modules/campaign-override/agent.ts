import { prisma } from "@/lib/prisma";
import type { LeadCampaign } from "@/modules/campaigns/active";
import { DEFAULT_RULES, type CampaignRules } from "@/modules/campaigns/rules";
import { getCampaignOverrideForLeadStrict, resolveCampaignLeadMatches, type CampaignOverride } from "./lead";

/**
 * A regra provisória da campanha de implantes (URG-02/03) vestida de
 * `LeadCampaign`. De propósito **não há segunda trava**: `checkCampaignSlot`,
 * `campaignSlotsContext`, o prompt do turno e `remindersFor` já sabem agir sobre
 * uma campanha, então a regra do override só vira uma campanha sintética e todos
 * eles passam a valer para os leads dela, sem mudar um chamador.
 *
 * Campanha real (`Campaign`) vence: `findLeadCampaign` só cai aqui quando o lead
 * não está em nenhuma.
 */

export const OVERRIDE_CAMPAIGN_ID = "override:implantes-2026-11";

/** Frase que o agente recebe quando pede data ou hora fora do evento. */
export const OVERRIDE_REFUSAL = "Para a campanha de implantes, só 18 ou 19/11 com chegada às 09h00. Ofereça essas opções.";

/** Linha do prompt (só do lead da campanha). A `offerText` da regra vem depois, se existir. */
export const OVERRIDE_PROMPT_LINE =
  "Lead da campanha de implantes: o atendimento é no evento de 18 ou 19/11; o paciente deve chegar às 09h00. Não ofereça outras datas nem horários.";

/** A campanha é a regra provisória (não uma `Campaign` do banco)? */
export function isOverrideCampaignId(id: string | null | undefined): boolean {
  return id === OVERRIDE_CAMPAIGN_ID;
}

/**
 * `OverrideRules` → `CampaignRules`. Um horário por dia, então vaga por horário
 * é vaga por dia. **Sem `capacityPerDay` a capacidade é 0**: a regra recusa marcar
 * (e transfere para um humano) em vez de aceitar sem limite — o número é definido
 * com `scripts/campanha-override.ts --set-capacity`.
 */
export function overrideToCampaignRules(override: Pick<CampaignOverride, "rules">): CampaignRules {
  const { dates, time, capacityPerDay, offerText } = override.rules;
  return {
    ...DEFAULT_RULES,
    dates: [...dates],
    times: [time],
    timesByDate: {},
    capacity: capacityPerDay ?? 0,
    arrival: `chegar às ${time.replace(":", "h")}`,
    reminders: "off",
    customReminders: [],
    offer: offerText ?? "",
    outside: "handoff",
    graceDays: 0,
  };
}

/**
 * A campanha sintética do lead, ou null quando ele não é da campanha agora.
 * **Lança** se o banco falhar (mesmo contrato de `findLeadCampaign`): quem chama
 * decide — a agenda recusa, o prompt segue sem campanha.
 */
export async function overrideAsLeadCampaign(tenantId: string, leadId: string, now: Date = new Date()): Promise<LeadCampaign | null> {
  const override = await getCampaignOverrideForLeadStrict(tenantId, leadId, now);
  if (!override) return null;
  return {
    campaign: {
      id: OVERRIDE_CAMPAIGN_ID,
      name: "Campanha de implantes",
      objective: null,
      description: OVERRIDE_PROMPT_LINE,
      timezone: "America/Sao_Paulo",
      startsAt: override.startsAt,
      endsAt: override.endsAt,
      agentId: null,
      baseAgentId: null,
    },
    rules: overrideToCampaignRules(override),
    assets: [],
    sentAssetIds: [],
  };
}

/**
 * Consulta que só existe no Clinicorp (sem `Appointment` nosso): o lead dela é da
 * campanha de implantes e a consulta é até o fim da regra? Então não recebe
 * lembrete. **Nunca lança** e, na dúvida (banco fora do ar), responde `true`:
 * espera a próxima volta em vez de arriscar um lembrete que a campanha proíbe.
 */
export async function overrideSuppressesReminder(tenantId: string, leadId: string, startsAt: Date, now: Date = new Date()): Promise<boolean> {
  try {
    const override = await getCampaignOverrideForLeadStrict(tenantId, leadId, now);
    return override !== null && startsAt.getTime() <= override.endsAt.getTime();
  } catch (err) {
    console.error("[campanha-override] não foi possível conferir o lead; lembrete adiado", tenantId, err instanceof Error ? err.message : "erro");
    return true;
  }
}

/**
 * Para a varredura de lembretes: lead → regras da campanha de implantes (lembretes
 * desligados), só dos leads que têm consulta futura. Uma consulta por conta com a
 * regra em vigor; sem regra em vigor, nada é lido além dela. **Lança** em falha de
 * leitura: o worker espera a próxima volta em vez de arriscar um lembrete.
 */
export async function loadOverrideReminderRules(tenantIds: string[], now: Date = new Date()): Promise<Map<string, CampaignRules>> {
  const result = new Map<string, CampaignRules>();
  if (!tenantIds.length) return result;
  const active = await prisma.campaignOverride.findMany({
    where: { tenantId: { in: tenantIds }, startsAt: { lte: now }, endsAt: { gte: now } },
    select: { tenantId: true },
  });
  const tenants = [...new Set(active.map((row) => row.tenantId))];
  if (!tenants.length) return result;

  const appointments = await prisma.appointment.findMany({
    where: { tenantId: { in: tenants }, status: "scheduled", startsAt: { gte: now }, leadId: { not: null } },
    select: { tenantId: true, leadId: true },
  });
  const byTenant = new Map<string, Set<string>>();
  for (const appt of appointments) {
    if (!appt.leadId) continue;
    byTenant.set(appt.tenantId, (byTenant.get(appt.tenantId) ?? new Set()).add(appt.leadId));
  }
  for (const [tenantId, leadIds] of byTenant) {
    const matches = await resolveCampaignLeadMatches(tenantId, [...leadIds], now);
    for (const [leadId, match] of matches) result.set(leadId, overrideToCampaignRules(match.override));
  }
  return result;
}
