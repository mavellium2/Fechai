import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { dayKeyInZone, timeInZone } from "@/modules/scheduling/time";
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
  reminderQueued: boolean;
};

/** Já está no encaixe do evento (um dos dias, na hora única)? Dia e hora locais, nunca UTC. */
export function isInEventSlot(startsAt: Date, rules: { dates: string[]; time: string }, timeZone: string = RESCHEDULE_TIMEZONE): boolean {
  return rules.dates.includes(dayKeyInZone(startsAt, timeZone)) && timeInZone(startsAt, timeZone) === rules.time;
}

/** Consultas da campanha que precisam de reagendamento, em ordem de data. */
export async function listRescheduleCandidates(
  tenantId: string,
  now: Date = new Date(),
  timeZone: string = RESCHEDULE_TIMEZONE,
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
    return match ? !isInEventSlot(a.startsAt, match.override.rules, timeZone) : false;
  });
  if (!outside.length) return [];

  // Lembrete ainda na fila: a linha da consulta (id próprio ou do Clinicorp) para aquele horário.
  const keysOf = (a: (typeof outside)[number]) => [`appointment:${a.id}`, ...(a.clinicorpAppointmentId ? [`clinicorp:${a.clinicorpAppointmentId}`] : [])];
  const queued = await prisma.reminderDispatch.findMany({
    where: { tenantId, state: "queued", sourceKey: { in: outside.flatMap(keysOf) } },
    select: { sourceKey: true, startsAt: true },
  });
  const queuedSet = new Set(queued.map((r) => `${r.sourceKey}|${r.startsAt.getTime()}`));

  return outside.map((a) => ({
    name: a.lead?.name?.trim() || a.patientName?.trim() || "(sem nome)",
    phone: a.lead?.phone ?? "",
    date: dayKeyInZone(a.startsAt, timeZone),
    time: timeInZone(a.startsAt, timeZone),
    origin: matches.get(a.leadId as string)!.origin.label,
    clinicorpAppointmentId: a.clinicorpAppointmentId,
    reminderQueued: keysOf(a).some((key) => queuedSet.has(`${key}|${a.startsAt.getTime()}`)),
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

/** Monta a planilha. Data em "dd/mm/aaaa" e telefone como texto (não vira número). */
export function buildRescheduleWorkbook(rows: RescheduleRow[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reagendar");
  sheet.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const [year, month, day] = row.date.split("-");
    sheet.addRow({
      ...row,
      date: `${day}/${month}/${year}`,
      clinicorpAppointmentId: row.clinicorpAppointmentId ?? "",
      reminder: row.reminderQueued ? "sim" : "não",
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
