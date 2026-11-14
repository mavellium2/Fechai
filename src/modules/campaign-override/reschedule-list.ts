import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadReminderOverrides } from "@/modules/campaigns/active";
import type { CampaignRules } from "@/modules/campaigns/rules";
import { isReminderTypeAllowed, type ScheduleConfig } from "@/modules/scheduling/config";
import { dayKeyInZone, timeInZone } from "@/modules/scheduling/time";
import { loadAccountScheduleConfigs, remindersFor, staleReminders } from "../../../workers/follow-up-worker/reminders";
import { resolveCampaignLeadMatches } from "./lead";

/**
 * Lista para a recepção (URG-04, só leitura): consultas futuras de leads da
 * campanha que NÃO estão num dos dias do evento às 9h — quem precisa ser
 * chamado para reagendar. Nada aqui escreve em Appointment, Lead ou qualquer
 * outra tabela. O conteúdo tem nome e telefone e vai só para a clínica
 * (planilha); nunca para log, auditoria ou terminal.
 */

/** A conta ainda não tem fuso próprio (ver `Campaign.timezone`). */
export const RESCHEDULE_TIMEZONE = "America/Sao_Paulo";

export type RescheduleRow = {
  name: string;
  phone: string;
  /** "AAAA-MM-DD" e "HH:mm" locais da consulta atual. */
  date: string;
  time: string;
  origin: string;
  clinicorpAppointmentId: string | null;
  reminder: ReminderPlan;
  /**
   * Só no modo `--evento`: a consulta já está num dos dias do evento às 9h (a
   * recepção só a lança à mão no Clinicorp, porque estas não são espelhadas).
   */
  inEvent?: boolean;
};

/** Há lembrete por sair? `unknown` = não deu para ler a config ou as campanhas (nunca vira "não"). */
export type ReminderPlan = { status: "yes" | "no" | "unknown"; pending: number };

/**
 * Quantos disparos desta consulta ainda vão sair, pela MESMA regra do worker
 * (`workers/follow-up-worker/reminders.ts`): os da consulta, senão os da campanha,
 * senão os gerais da conta (`remindersFor`), menos `remindersSent` e menos os que
 * já perderam a janela (`staleReminders`). Público do lembrete incluído.
 */
export function reminderPlan(
  appt: { reminderOverride: unknown; remindersSent: number[]; serviceType: string | null; startsAt: Date; status: string },
  cfg: ScheduleConfig | undefined,
  campaign: CampaignRules | undefined,
  now: Date,
): ReminderPlan {
  if (!cfg || !isReminderTypeAllowed(cfg, appt.serviceType)) return { status: "no", pending: 0 };
  const rules = remindersFor(appt, cfg, campaign);
  const expired = new Set(staleReminders(appt, rules, now, cfg.timezone).map((r) => r.minutesBefore));
  const sent = new Set(appt.remindersSent);
  const pending = rules.filter((r) => !sent.has(r.minutesBefore) && !expired.has(r.minutesBefore)).length;
  return { status: pending > 0 ? "yes" : "no", pending };
}

/** Já está no encaixe do evento (um dos dias, na hora única)? Dia e hora locais, nunca UTC. */
export function isInEventSlot(startsAt: Date, rules: { dates: string[]; time: string }, timeZone: string = RESCHEDULE_TIMEZONE): boolean {
  return rules.dates.includes(dayKeyInZone(startsAt, timeZone)) && timeInZone(startsAt, timeZone) === rules.time;
}

/**
 * Consultas da campanha que precisam de reagendamento, em ordem de data. Com
 * `includeEvent` (`--evento`), entram também as que já estão no encaixe do
 * evento, marcadas com `inEvent` — as da regra não vão ao Clinicorp sozinhas.
 */
export async function listRescheduleCandidates(
  tenantId: string,
  now: Date = new Date(),
  timeZone: string = RESCHEDULE_TIMEZONE,
  options: { includeEvent?: boolean } = {},
): Promise<RescheduleRow[]> {
  const appointments = await prisma.appointment.findMany({
    where: { tenantId, status: "scheduled", startsAt: { gt: now }, leadId: { not: null }, lead: { isTest: false } },
    select: {
      id: true,
      startsAt: true,
      status: true,
      leadId: true,
      patientName: true,
      clinicorpAppointmentId: true,
      serviceType: true,
      reminderOverride: true,
      remindersSent: true,
      lead: { select: { name: true, phone: true } },
    },
    orderBy: { startsAt: "asc" },
  });
  // O filtro do banco é o principal; repetido aqui para a regra não depender só dele.
  const future = appointments.filter((a) => a.status === "scheduled" && a.startsAt.getTime() > now.getTime() && a.leadId);
  if (!future.length) return [];

  // Versão que lança: falha de banco não pode virar lista vazia ("ninguém para reagendar").
  const matches = await resolveCampaignLeadMatches(tenantId, future.map((a) => a.leadId as string), now);
  const outside = future.filter((a) => {
    const match = matches.get(a.leadId as string);
    if (!match) return false;
    return options.includeEvent ? true : !isInEventSlot(a.startsAt, match.override.rules, timeZone);
  });
  if (!outside.length) return [];

  // Lembretes: a config geral da conta e as campanhas que mexem neles, como o worker lê.
  // Falha ao ler = "não sei" (nunca "não"); o resto da lista segue.
  let cfg: ScheduleConfig | undefined;
  let campaigns: Map<string, CampaignRules> | null = null;
  let readable = true;
  try {
    cfg = (await loadAccountScheduleConfigs()).get(tenantId);
    campaigns = await loadReminderOverrides([tenantId], now);
  } catch (err) {
    readable = false;
    console.error("[campanha-override] não foi possível ler a configuração de lembretes", err instanceof Error ? err.message : "erro");
  }

  return outside.map((a) => ({
    // O paciente da consulta (pode não ser quem escreveu); sem ele, o nome do contato.
    name: a.patientName?.trim() || a.lead?.name?.trim() || "(sem nome)",
    phone: a.lead?.phone ?? "",
    date: dayKeyInZone(a.startsAt, timeZone),
    time: timeInZone(a.startsAt, timeZone),
    origin: matches.get(a.leadId as string)!.origin.label,
    clinicorpAppointmentId: a.clinicorpAppointmentId,
    reminder: readable ? reminderPlan(a, cfg, campaigns?.get(a.leadId as string), now) : { status: "unknown", pending: 0 },
    ...(options.includeEvent ? { inEvent: isInEventSlot(a.startsAt, matches.get(a.leadId as string)!.override.rules, timeZone) } : {}),
  }));
}

const COLUMNS: { header: string; key: keyof RescheduleRow | "reminder"; width: number }[] = [
  { header: "Nome", key: "name", width: 32 },
  { header: "Telefone", key: "phone", width: 18 },
  { header: "Data atual", key: "date", width: 14 },
  { header: "Hora atual", key: "time", width: 12 },
  { header: "Origem", key: "origin", width: 18 },
  { header: "ID Clinicorp", key: "clinicorpAppointmentId", width: 22 },
  { header: "Lembrete agendado", key: "reminder", width: 20 },
];

export function reminderLabel(plan: ReminderPlan): string {
  if (plan.status === "unknown") return "não sei";
  if (plan.status === "no") return "não";
  return `sim (${plan.pending} ${plan.pending === 1 ? "pendente" : "pendentes"})`;
}

/** Monta a planilha. Data em "dd/mm/aaaa" e telefone como texto (não vira número). */
export function buildRescheduleWorkbook(rows: RescheduleRow[], options: { withEvent?: boolean } = {}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reagendar");
  sheet.columns = [
    ...COLUMNS.map(({ header, key, width }) => ({ header, key, width })),
    // `--evento`: o que a recepção faz com cada linha.
    ...(options.withEvent ? [{ header: "O que fazer", key: "action", width: 26 }] : []),
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const [year, month, day] = row.date.split("-");
    sheet.addRow({
      ...row,
      date: `${day}/${month}/${year}`,
      clinicorpAppointmentId: row.clinicorpAppointmentId ?? "",
      reminder: reminderLabel(row.reminder),
      action: row.inEvent ? "Lançar no Clinicorp" : "Reagendar",
    });
  }
  sheet.getColumn("phone").numFmt = "@";
  return workbook;
}

/** Nome do arquivo sem dado pessoal: `campanha-implantes-reagendar-AAAAMMDD-HHMM.xlsx` (hora de Brasília). */
export function rescheduleFileName(now: Date, timeZone: string = RESCHEDULE_TIMEZONE): string {
  const stamp = `${dayKeyInZone(now, timeZone).replace(/-/g, "")}-${timeInZone(now, timeZone).replace(":", "")}`;
  return `campanha-implantes-reagendar-${stamp}.xlsx`;
}
