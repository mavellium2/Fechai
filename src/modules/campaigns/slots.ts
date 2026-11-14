import { prisma } from "@/lib/prisma";
import { isWithinBusinessHours, type ScheduleConfig } from "@/modules/scheduling/config";
import { dayKeyInZone, parseLocalDateTime, timeInZone } from "@/modules/scheduling/time";
import { isOverrideCampaignId, OVERRIDE_REFUSAL } from "@/modules/campaign-override/agent";
import { findLeadCampaign, type LeadCampaign } from "./active";
import { campaignSlotProblem, formatRuleDay, restrictsSchedule, timesFor, type CampaignRules } from "./rules";

/**
 * A agenda da campanha, no backend. É a trava que a IA não contorna: a mesma
 * função responde a `schedule_meeting`, `reschedule_meeting` e
 * `createAppointment` (que recusa com `CampaignRuleError`).
 */

/** Horário recusado pela regra da campanha do lead. A mensagem é a frase da recusa. */
export class CampaignRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignRuleError";
  }
}

export type SlotCheck = {
  campaign: LeadCampaign | null;
  /** Recusa da regra (data, horário ou lotação), ou null. */
  problem: string | null;
  /** Vaga de evento: o horário dispensa expediente e conflito de agenda. */
  eventSlot: boolean;
};

/** A frase da recusa por lotação (também usada pela trava de corrida da campanha de implantes). */
export function slotFullProblem(day: string, time: string): string {
  return `As vagas de ${formatRuleDay(day)} às ${time} da campanha estão esgotadas. Ofereça outra opção da campanha.`;
}

/** Quantos agendamentos já ocupam este instante (vaga de evento). */
async function bookedAt(tenantId: string, startsAt: Date, ignoreId?: string): Promise<number> {
  return prisma.appointment.count({
    where: { tenantId, status: "scheduled", startsAt, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
  });
}

/**
 * Confere um horário contra a campanha em vigor para o lead. Sem lead ou sem
 * campanha: nada a recusar. `timezone` é o da agenda — é nele que "18/11 às
 * 09:00" foi escrito.
 */
export async function checkCampaignSlot(input: {
  tenantId: string;
  leadId: string | null | undefined;
  startsAt: Date;
  timezone: string;
  /** Remarcação: a própria consulta não conta na lotação. */
  ignoreAppointmentId?: string;
  now?: Date;
  /** Já carregada no turno: evita ler de novo. */
  campaign?: LeadCampaign | null;
}): Promise<SlotCheck> {
  if (!input.leadId) return { campaign: null, problem: null, eventSlot: false };
  const campaign =
    input.campaign !== undefined ? input.campaign : await findLeadCampaign(input.tenantId, input.leadId, input.now);
  if (!campaign || !restrictsSchedule(campaign.rules)) return { campaign, problem: null, eventSlot: false };

  const rules = campaign.rules;
  const day = dayKeyInZone(input.startsAt, input.timezone);
  const time = timeInZone(input.startsAt, input.timezone);
  const problem = campaignSlotProblem(rules, day, time);
  // Campanha de implantes: a recusa ao agente é a frase fixa do card.
  if (problem) return { campaign, problem: isOverrideCampaignId(campaign.campaign.id) ? OVERRIDE_REFUSAL : problem, eventSlot: false };

  if (rules.capacity !== null && timesFor(rules, day).length) {
    const taken = await bookedAt(input.tenantId, input.startsAt, input.ignoreAppointmentId);
    if (taken >= rules.capacity) {
      return { campaign, problem: slotFullProblem(day, time), eventSlot: true };
    }
    return { campaign, problem: null, eventSlot: true };
  }
  return { campaign, problem: null, eventSlot: false };
}

/** Recusa no backend: lança `CampaignRuleError` quando o horário fere a regra. */
export async function assertCampaignSlot(input: Parameters<typeof checkCampaignSlot>[0]): Promise<SlotCheck> {
  const check = await checkCampaignSlot(input);
  if (check.problem) throw new CampaignRuleError(check.problem);
  return check;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const MAX_DATES_IN_RESULT = 5;

/**
 * Vagas reais da campanha para `list_available_slots`. Datas da regra (ou os
 * próximos dias, quando só os horários são fixos) × horários da regra (ou a
 * grade normal). Vaga de evento conta lotação; horário normal passa pela
 * agenda de sempre (expediente, antecedência, conflito em todas as agendas).
 */
export async function campaignSlotsContext(input: {
  tenantId: string;
  cfg: ScheduleConfig;
  rules: CampaignRules;
  campaignName: string;
  fromDate: string;
  days: number;
  now?: Date;
  listFreeSlots: (date: string) => Promise<Date[]>;
  hasConflict: (startsAt: Date, endsAt: Date) => Promise<boolean>;
  /** Chamado quando não sobra nenhuma vaga em nenhuma data (a campanha de implantes transfere aqui). */
  onNoSlots?: () => Promise<void>;
}): Promise<string> {
  const { cfg, rules } = input;
  const now = input.now ?? new Date();
  const earliest = now.getTime() + cfg.minNoticeHours * 3_600_000;
  // Com datas fixas, vale a lista inteira a partir de hoje, qualquer que seja o
  // dia que a IA pediu: pedir "a partir do dia 20" não pode esconder o dia 18.
  const today = dayKeyInZone(now, cfg.timezone);
  const candidates = rules.dates.length
    ? rules.dates.filter((d) => d >= today)
    : Array.from({ length: Math.min(Math.max(input.days, 1), 14) }, (_, i) => addDays(input.fromDate, i));

  const lines: string[] = [];
  const full: string[] = [];
  for (const day of candidates) {
    if (lines.length >= MAX_DATES_IN_RESULT) break;
    const times = timesFor(rules, day);
    let free: string[] = [];
    if (!times.length) {
      free = (await input.listFreeSlots(day)).map((at) => timeInZone(at, cfg.timezone));
    } else {
      for (const time of times) {
        const at = parseLocalDateTime(day, time, cfg.timezone);
        if (!at || at.getTime() < earliest) continue;
        if (rules.capacity !== null) {
          const taken = await prisma.appointment.count({ where: { tenantId: input.tenantId, status: "scheduled", startsAt: at } });
          if (taken < rules.capacity) free.push(`${time} (${rules.capacity - taken} vaga${rules.capacity - taken === 1 ? "" : "s"})`);
          continue;
        }
        if (!isWithinBusinessHours(at, cfg)) continue;
        const end = new Date(at.getTime() + cfg.durationMinutes * 60_000);
        if (!(await input.hasConflict(at, end))) free.push(time);
      }
    }
    if (free.length) lines.push(`- ${formatRuleDay(day)} (${day}): ${free.join(", ")}`);
    else if (times.length || rules.dates.length) full.push(formatRuleDay(day));
  }

  const header = `Vagas da campanha "${input.campaignName}" (a regra da campanha vale para este contato; ofereça SOMENTE estas):`;
  if (!lines.length) {
    await input.onNoSlots?.();
    return [
      header,
      "- Nenhuma vaga livre nas datas e horários da campanha.",
      full.length ? `Sem vaga: ${full.join(", ")}.` : "",
      rules.outside === "handoff"
        ? "Registre o interesse e transfira para um atendente."
        : "Explique que as vagas da campanha acabaram e pergunte se o contato quer que a equipe entre em contato.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [header, ...lines, full.length ? `Datas da campanha já sem vaga: ${full.join(", ")}.` : ""].filter(Boolean).join("\n");
}
