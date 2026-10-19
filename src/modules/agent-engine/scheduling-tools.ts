import type { LlmToolSchema } from "@/modules/ai";
import { isWithinBusinessHours, type ScheduleConfig } from "@/modules/scheduling/config";
import { cancelAppointment, findLeadAppointment, listFreeSlots, listUpcomingLeadAppointments, rescheduleAppointment } from "@/modules/scheduling/repository";
import { dayKeyInZone, formatInZone, parseLocalDateTime, partsInZone, timeInZone } from "@/modules/scheduling/time";
import type { ToolContext } from "./tools";
import { relativeDayLabel } from "./time-context";
import { describeRanges, getWeeklyAvailability } from "@/modules/scheduling/weekly-availability";
import { clinicorpConfirmationPending } from "@/modules/scheduling/clinicorp";

const DEFAULT_AVAILABILITY_SEARCH_DAYS = 14;
const MAX_AVAILABILITY_SEARCH_DAYS = 14;
const MAX_AVAILABLE_DATES_IN_RESULT = 5;
const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Conflito continua com o agente: consulta alternativas reais e pede uma nova escolha. */
export async function offerAlternativeSlots(
  ctx: ToolContext, cfg: ScheduleConfig, rejectedStart: Date, durationMinutes: number,
): Promise<string> {
  ctx.replyOverride = "Esse horário está ocupado. Não consegui conferir outras opções agora. Podemos tentar novamente em instantes.";
  const rejectedEnd = rejectedStart.getTime() + durationMinutes * 60_000;
  const alternatives: Date[] = [];
  const date = dayKeyInZone(rejectedStart, cfg.timezone);
  try {
    for (let i = 0; i < MAX_AVAILABILITY_SEARCH_DAYS && alternatives.length < 3; i++) {
      const slots = await listFreeSlots(ctx.tenantId, { ...cfg, durationMinutes }, addDays(date, i));
      alternatives.push(...slots.filter((at) =>
        at.getTime() >= rejectedEnd || at.getTime() + durationMinutes * 60_000 <= rejectedStart.getTime(),
      ).slice(0, 3 - alternatives.length));
    }
    ctx.replyOverride = alternatives.length
      ? `Esse horário está ocupado. Encontrei estas opções disponíveis:\n${alternatives.map((at) => `• ${formatInZone(at, cfg.timezone)}`).join("\n")}\nQual fica melhor para você?`
      : "Esse horário está ocupado e não encontrei outra opção livre nos próximos 14 dias a partir dessa data. Você prefere que eu consulte uma data mais adiante?";
  } catch (err) {
    console.error("[tools] consulta de alternativas falhou", err);
  }
  return ctx.replyOverride;
}

export const SCHEDULING_TOOLS: LlmToolSchema[] = [
  {
    name: "list_available_slots",
    description: "Lista um leque de horários LIVRES reais da agenda em vários dias, já descontando consultas, pausas, expediente e antecedência mínima. Use sempre antes de sugerir ou aceitar um horário. Quando o contato rejeitar dias ou datas, envie-os em excludeDates e não os ofereça novamente. Não marca nada.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Primeiro dia a consultar, AAAA-MM-DD. Se o contato rejeitou dias consecutivos, comece depois do último deles." },
        days: { type: "number", description: "Quantos dias corridos pesquisar a partir da data (1 a 14). Padrão 14 para encontrar vários dias úteis. Use 1 somente se o contato pediu uma data exata." },
        excludeDates: {
          type: "array",
          items: { type: "string" },
          description: "Datas AAAA-MM-DD que o contato já recusou ou disse que não pode. Elas não aparecem nas opções.",
        },
        excludeWeekdays: {
          type: "array",
          items: { type: "number" },
          description: "Dias da semana que o contato não pode: 0=domingo, 1=segunda, ..., 6=sábado. Use, por exemplo, [4, 5] para 'não posso quinta nem sexta'.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "list_appointments",
    description: "Consulta os próximos agendamentos deste contato. Use ao retornar, responder a lembretes ou pedir cancelamento/reagendamento. Não cria nem altera horários.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "cancel_meeting",
    description: "Cancela uma consulta deste contato. Primeiro identifique a consulta e pergunte se confirma o cancelamento da data/hora específica. Espere a próxima resposta clara do cliente; só então use confirmed=true. Dúvida ou fala vaga não é confirmação.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "string", description: "ID retornado pela consulta de agendamentos" },
        confirmed: { type: "boolean", description: "True somente após o cliente responder claramente à pergunta de confirmação do cancelamento." },
        reason: { type: "string", description: "Motivo somente quando o contato informou explicitamente. Não invente nem exija motivo para cancelar." },
      },
      required: ["appointmentId", "confirmed"],
    },
  },
  {
    name: "reschedule_meeting",
    description: "Troca a data/hora de uma consulta existente, preservando seu ID e sua duração. Confirme com o contato a consulta original e o novo horário, espere a resposta e só então use confirmed=true. Falha mantém o original.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "string", description: "ID retornado pela consulta de agendamentos" },
        date: { type: "string", description: "Nova data AAAA-MM-DD" },
        time: { type: "string", description: "Nova hora HH:MM no fuso do negócio" },
        confirmed: { type: "boolean", description: "True somente após confirmação clara do cliente à pergunta sobre trocar o horário antigo pelo novo." },
      },
      required: ["appointmentId", "date", "time", "confirmed"],
    },
  },
];

export function schedulingToolAllowed(name: string, cfg: ScheduleConfig): boolean {
  return name === "list_appointments"
    || name === "list_available_slots"
    || (name === "cancel_meeting" && cfg.allowCancellation)
    || (name === "reschedule_meeting" && cfg.allowRescheduling);
}

export async function leadAppointmentsContext(
  ctx: Pick<ToolContext, "tenantId" | "leadId">, cfg: ScheduleConfig, now = new Date(),
): Promise<string> {
  const appointments = await listUpcomingLeadAppointments(ctx.tenantId, ctx.leadId);
  if (!appointments.length) return "Nenhuma consulta futura deste contato na agenda do fechai.";
  const checkSync = appointments.some((a) => !a.clinicorpAppointmentId) && await clinicorpConfirmationPending(ctx.tenantId);
  // Só IDs e horários: títulos/notas livres não viram instruções de sistema.
  // O dia relativo ("é HOJE") vem calculado: com só a data absoluta, o agente
  // repetiu o "amanhã" do lembrete da véspera na manhã da consulta.
  return [
    "Consultas futuras deste contato na agenda do fechai:",
    ...appointments.map((a) =>
      `- ID ${a.id}: ${formatInZone(a.startsAt, cfg.timezone)} (${Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000)} min) — é ${relativeDayLabel(a.startsAt, now, cfg.timezone).toUpperCase()}, às ${timeInZone(a.startsAt, cfg.timezone)}.${checkSync && !a.clinicorpAppointmentId ? " Registro automático no Clinicorp em andamento. Não afirme que já foi concluído nem crie outra reserva." : ""}`,
    ),
    `- Ao mencionar uma dessas consultas, use o dia indicado aqui ("hoje", "amanhã" ou a data), mesmo que uma mensagem anterior da conversa diga outra coisa.`,
  ].join("\n");
}

/** "2026-09-16" + 2 -> "2026-09-18". Aritmética de calendário, sem fuso. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayLabel(date: string, timeZone: string): string {
  const noon = parseLocalDateTime(date, "12:00", timeZone);
  return noon
    ? new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "short", day: "2-digit", month: "short" }).format(noon)
    : date;
}

export async function availableSlotsContext(
  ctx: Pick<ToolContext, "tenantId">,
  cfg: ScheduleConfig,
  date: string,
  days = DEFAULT_AVAILABILITY_SEARCH_DAYS,
  excludeDates: unknown = [],
  excludeWeekdays: unknown = [],
): Promise<string> {
  if (!parseLocalDateTime(date, "12:00", cfg.timezone)) return "Data inválida. Use AAAA-MM-DD.";
  const requestedDays = Number.isFinite(days)
    ? Math.round(days)
    : DEFAULT_AVAILABILITY_SEARCH_DAYS;
  const count = Math.min(Math.max(requestedDays, 1), MAX_AVAILABILITY_SEARCH_DAYS);
  const excluded = new Set(
    (Array.isArray(excludeDates) ? excludeDates : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => parseLocalDateTime(value, "12:00", cfg.timezone) !== null),
  );
  const excludedWeekdays = new Set(
    (Array.isArray(excludeWeekdays) ? excludeWeekdays : [])
      .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6),
  );
  const searchedDates = Array.from({ length: count }, (_, i) => addDays(date, i));
  const dates = searchedDates.filter((candidate) => {
    if (excluded.has(candidate)) return false;
    const noon = parseLocalDateTime(candidate, "12:00", cfg.timezone)!;
    return !excludedWeekdays.has(partsInZone(noon, cfg.timezone).weekday);
  });
  const perDay = await Promise.all(dates.map((d) => listFreeSlots(ctx.tenantId, cfg, d)));
  const week = getWeeklyAvailability(cfg);

  const results = dates.map((d, i) => {
    const noon = parseLocalDateTime(d, "12:00", cfg.timezone)!;
    const weekday = partsInZone(noon, cfg.timezone).weekday;
    const ranges = week[weekday];
    const slots = perDay[i];
    return { date: d, label: dayLabel(d, cfg.timezone), ranges, slots };
  });
  const available = results.filter((result) => result.slots.length).slice(0, MAX_AVAILABLE_DATES_IN_RESULT);
  const unavailable = results.filter((result) => result.ranges.length && !result.slots.length);
  const closed = results.filter((result) => !result.ranges.length);

  const lines = available.map((result) =>
    `- ${result.label} (${result.date}) — funcionamento ${describeRanges(result.ranges)}; horários livres: ${result.slots.map((slot) => timeInZone(slot, cfg.timezone)).join(", ")}`,
  );
  if (!available.length) {
    lines.push(`- Nenhum horário livre entre ${searchedDates[0]} e ${searchedDates.at(-1)} nas datas permitidas pelo contato.`);
  }

  const searchNotes = [
    excluded.size
      ? `Datas descartadas pelo contato (não ofereça novamente): ${[...excluded].sort().join(", ")}.`
      : "",
    excludedWeekdays.size
      ? `Dias da semana descartados pelo contato (não ofereça novamente): ${[...excludedWeekdays].sort().map((day) => WEEKDAY_LABELS[day]).join(", ")}.`
      : "",
    unavailable.length
      ? `Dias de atendimento sem horário livre nesta busca: ${unavailable.map((result) => `${result.label} (${result.date})`).join(", ")}.`
      : "",
    closed.length
      ? `Dias em que não atendemos (sem expediente) foram pulados: ${closed.map((result) => `${result.label} (${result.date})`).join(", ")}.`
      : "",
  ].filter(Boolean);
  // A grade é a da duração padrão: calcular uma por variação daria listas
  // diferentes para o mesmo dia e o agente não teria como escolher entre elas.
  // Um tipo mais curto cabe em qualquer início destes; um mais longo é recusado
  // por `schedule_meeting`, que já devolve os livres do dia junto.
  const note = cfg.durations.length
    ? ` Um tipo de atendimento mais longo pode não caber em todos eles — a checagem final é de schedule_meeting.`
    : "";
  return [
    `Horários livres reais (grade de ${cfg.durationMinutes} min). Ofereça somente estes e não repita datas/horas que o contato já recusou:${note}`,
    ...lines,
    ...searchNotes,
  ].join("\n");
}

/**
 * Complemento da recusa por conflito: já devolve o que está livre no mesmo dia,
 * para o agente não sugerir outro horário ocupado no chute. Nunca lança — a
 * recusa em si é o que importa.
 */
export async function freeSlotsHint(ctx: Pick<ToolContext, "tenantId">, cfg: ScheduleConfig, startsAt: Date): Promise<string> {
  try {
    const date = dayKeyInZone(startsAt, cfg.timezone);
    const slots = await listFreeSlots(ctx.tenantId, cfg, date);
    return slots.length
      ? ` Livres no mesmo dia: ${slots.map((s) => timeInZone(s, cfg.timezone)).join(", ")}. Ofereça somente um destes, ou use list_available_slots para outros dias.`
      : " Não há horário livre nesse dia. Use list_available_slots para os próximos dias antes de sugerir outro.";
  } catch (err) {
    console.error("[tools] horários livres falhou", err);
    return " Use list_available_slots antes de sugerir outro horário.";
  }
}

export async function runSchedulingTool(name: string, ctx: ToolContext, args: Record<string, unknown>, cfg: ScheduleConfig): Promise<string> {
  if (!schedulingToolAllowed(name, cfg)) return "Esta opção de agendamento está desabilitada. Ofereça atendimento humano.";
  if (name === "list_appointments") return leadAppointmentsContext(ctx, cfg);
  if (name === "list_available_slots") {
    if (typeof args.date !== "string") return "Informe a data em AAAA-MM-DD.";
    return availableSlotsContext(
      ctx,
      cfg,
      args.date.trim(),
      typeof args.days === "number" ? args.days : undefined,
      args.excludeDates,
      args.excludeWeekdays,
    );
  }
  if (typeof args.appointmentId !== "string" || !args.appointmentId.trim()) return "Consulte os agendamentos do contato e identifique a consulta antes de alterar.";
  const appointment = await findLeadAppointment(ctx.tenantId, ctx.leadId, args.appointmentId);
  if (!appointment) return "Consulta não encontrada para este contato. Consulte os agendamentos novamente.";
  if (name === "cancel_meeting" && appointment.status === "canceled") return "Essa consulta já está cancelada. Não é necessário cancelar novamente.";
  if (appointment.status !== "scheduled" || appointment.startsAt <= new Date()) return "Essa consulta não está disponível para alteração. Consulte os próximos horários do contato.";
  const previous = formatInZone(appointment.startsAt, cfg.timezone);
  if (args.confirmed !== true) return `Nenhuma alteração foi feita. Confirme com o cliente ${name === "cancel_meeting" ? "o cancelamento" : "a troca"} da consulta de ${previous} e espere a resposta clara antes de chamar novamente com confirmed=true.`;

  if (name === "cancel_meeting") {
    const canceled = await cancelAppointment(ctx.tenantId, appointment.id, ctx.leadId, {
      timezone: cfg.timezone, source: "agent", reason: typeof args.reason === "string" ? args.reason : undefined,
    });
    if (!canceled) return "A consulta mudou enquanto conversávamos. Consulte novamente antes de confirmar o cancelamento.";
    if ("clinicorpCancellationAccepted" in canceled && !canceled.clinicorpCancellationAccepted) {
      return `Cancelamento registrado no Fechai para ${previous}, preservando a consulta e suas observações. O Clinicorp não confirmou a alteração. Não afirme que foi concluída na agenda da clínica; informe que precisa ser conferida pela equipe.`;
    }
    return `Cancelamento feito para ${previous}. A consulta permanece no histórico do Fechai com a observação de cancelamento. Encerre com gentileza e se coloque à disposição.`;
  }

  const startsAt = typeof args.date === "string" && typeof args.time === "string"
    ? parseLocalDateTime(args.date, args.time, cfg.timezone) : null;
  if (!startsAt) return "Nova data/hora inválida. O horário original continua reservado.";
  if (startsAt.getTime() === appointment.startsAt.getTime()) {
    if (!appointment.clinicorpAppointmentId && await clinicorpConfirmationPending(ctx.tenantId)) {
      ctx.replyOverride = `A reserva para ${previous} ainda precisa ser conferida na agenda da clínica antes da confirmação. Não fiz outra reserva.`;
      return ctx.replyOverride;
    }
    return `A consulta já está marcada para ${previous}. Nenhuma alteração necessária.`;
  }
  if (startsAt.getTime() < Date.now() + cfg.minNoticeHours * 3_600_000) return "O novo horário já passou ou não respeita a antecedência mínima. O horário original continua reservado.";
  const durationMinutes = (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000;
  if (!isWithinBusinessHours(startsAt, { ...cfg, durationMinutes })) return "O novo horário fica fora do expediente ou atravessa uma pausa. O horário original continua reservado. Combine outro horário.";
  const result = await rescheduleAppointment({ tenantId: ctx.tenantId, leadId: ctx.leadId, id: appointment.id, startsAt, timezone: cfg.timezone });
  if (result.status === "conflict") return offerAlternativeSlots(ctx, cfg, startsAt, durationMinutes);
  if (result.status === "unavailable") return "A consulta mudou ou não está mais disponível. Consulte os agendamentos novamente antes de confirmar qualquer alteração.";
  const when = formatInZone(startsAt, cfg.timezone);
  if (result.status === "unchanged") return `A consulta já está marcada para ${when}. Nenhuma alteração necessária.`;
  if (result.status === "rescheduled" && result.clinicorpSync.status === "failed") {
    ctx.replyOverride = `Ainda não consegui confirmar a mudança da sua consulta para ${when} na agenda da clínica. A reserva precisa ser conferida pela equipe antes da confirmação.`;
    return ctx.replyOverride;
  }
  return `Consulta reagendada para ${when}${cfg.location ? ` (${cfg.location})` : ""}. O horário anterior foi liberado e permanece na data original no histórico do Fechai como remarcado, com a nova data.`;
}
