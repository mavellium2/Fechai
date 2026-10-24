import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { AvailabilityUnavailableError } from "./availability-error";
import { isWithinBusinessHours, parseScheduleConfig, slotStartTimes, type ScheduleConfig } from "./config";
import { deleteEventFromGoogle, pushEventToGoogle } from "./google";
import {
  cancelAppointmentInClinicorp,
  hasClinicorpConflict,
  listClinicorpBusyBlocks,
  pushAppointmentToClinicorp,
} from "./clinicorp";
import { dayKeyInZone, monthRangeUtc, parseLocalDateTime, partsInZone, timeInZone, zonedTimeToUtc } from "./time";
import { canConfirm, canMarkAttendance, type AppointmentKind, type Attendance } from "./dimensions";
import { syncAppointmentToClinicorp } from "./clinicorp-sync";
import { deleteIcloudEvent, pushEventToIcloud, updateIcloudEvent, type IcloudSyncResult } from "./icloud";

/**
 * Leitura e escrita da agenda. Toda query filtra por tenantId (regra do
 * multi-tenant) e passa por aqui — a tela /agenda, as server actions e a tool
 * `schedule_meeting` compartilham exatamente estas regras.
 */

export type CreateAppointmentInput = {
  tenantId: string;
  agentId?: string | null;
  leadId?: string | null;
  conversationId?: string | null;
  title: string;
  /** Pessoa atendida; pode ser diferente do contato que conversou no WhatsApp. */
  patientName?: string;
  notes?: string | null;
  startsAt: Date;
  durationMinutes: number;
  source: "agent" | "manual";
  serviceType?: string | null;
  /** Só com escolha explícita; null = não classificado (ver `dimensions.ts`). */
  kind?: AppointmentKind | null;
  procedure?: string | null;
  timezone: string;
};

/** Config de agendamento do agente (ou o padrão, se a ação nunca foi tocada). */
export async function getScheduleConfig(agentId: string): Promise<ScheduleConfig> {
  const action = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "schedule_meeting" } },
    select: { config: true },
  });
  return parseScheduleConfig(action?.config);
}

export async function saveScheduleConfig(
  tenantId: string,
  agentId: string,
  config: ScheduleConfig,
): Promise<void> {
  await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId, key: "schedule_meeting" } },
    // Salvar horário de atendimento não liga a ação sozinha — quem liga é o
    // toggle. Daí `enabled: false` na criação.
    create: { tenantId, agentId, key: "schedule_meeting", enabled: false, config },
    update: { config },
  });
}

/**
 * Existe algo marcado que encoste neste intervalo?
 *
 * Sobreposição é `início < fimExistente && fim > inícioExistente` — comparar só
 * o início deixaria passar um horário que começa no meio de outro.
 */
export async function hasConflict(
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  ignoreId?: string,
): Promise<boolean> {
  const clash = await prisma.appointment.findFirst({
    where: {
      tenantId,
      status: "scheduled",
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  });
  return Boolean(clash);
}

/**
 * Como `hasConflict`, mas olhando também a agenda do Clinicorp quando a conta
 * está conectada.
 *
 * Existe separado porque a nossa agenda não é a agenda inteira da clínica: a
 * recepção marca gente direto no sistema deles o dia todo, e o agente não pode
 * oferecer um horário que já tem paciente na cadeira. A consulta local vem
 * primeiro — é a barata, e quando ela já acusa conflito não há motivo para
 * gastar uma chamada de rede.
 */
export async function hasConflictAnywhere(
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  ignoreId?: string,
  ignoreClinicorpId?: string,
): Promise<boolean> {
  if (await hasConflict(tenantId, startsAt, endsAt, ignoreId)) return true;
  const conflict = await hasClinicorpConflict(tenantId, startsAt, endsAt, timezone, ignoreClinicorpId);
  if (conflict === null) throw new AvailabilityUnavailableError();
  return conflict;
}

/**
 * Horários livres de um dia local, prontos para o agente oferecer.
 *
 * Sem isto o agente só conhecia o expediente: sugeria um horário já ocupado, o
 * contato aceitava e o `schedule_meeting` recusava — o agente então voltava
 * atrás e pedia outra data. Aqui o horário só aparece se passar pelas mesmas
 * regras da gravação: dia atendido, expediente, pausas, antecedência e
 * conflito na nossa base e no Clinicorp.
 *
 * Candidatos: a grade do expediente (e recomeçada ao fim de cada pausa) mais o
 * fim de cada compromisso ocupado, para uma consulta às 09:30 não esconder o
 * encaixe das 10:30 numa grade de hora cheia.
 */
export async function listFreeSlots(
  tenantId: string,
  cfg: ScheduleConfig,
  date: string,
  now = new Date(),
): Promise<Date[]> {
  const earliest = now.getTime() + cfg.minNoticeHours * 3_600_000;
  const durationMs = cfg.durationMinutes * 60_000;
  const valid = (at: Date) =>
    at.getTime() >= earliest && dayKeyInZone(at, cfg.timezone) === date && isWithinBusinessHours(at, cfg);

  const noon = parseLocalDateTime(date, "12:00", cfg.timezone);
  if (!noon) return [];
  const localDay = partsInZone(noon, cfg.timezone);
  const grid = slotStartTimes(cfg, localDay.weekday)
    .map((time) => parseLocalDateTime(date, time, cfg.timezone))
    .filter((at): at is Date => at !== null && valid(at));
  const dayStart = zonedTimeToUtc(localDay.year, localDay.month, localDay.day, 0, 0, cfg.timezone);
  const dayEnd = zonedTimeToUtc(localDay.year, localDay.month, localDay.day + 1, 0, 0, cfg.timezone);
  if (!dayStart || !dayEnd || !grid.length) return [];

  const [local, clinicorp] = await Promise.all([
    prisma.appointment.findMany({
      where: { tenantId, status: "scheduled", startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      select: { startsAt: true, endsAt: true },
    }),
    listClinicorpBusyBlocks(tenantId, date, cfg.timezone),
  ]);
  if (clinicorp === null) throw new AvailabilityUnavailableError();
  const busy = [...local, ...clinicorp];

  const candidates = new Map<number, Date>();
  for (const at of [...grid, ...busy.map((b) => b.endsAt).filter(valid)]) candidates.set(at.getTime(), at);

  // Mesma regra de sobreposição do `hasConflict`: encostar não é conflito.
  return [...candidates.values()]
    .filter((at) => !busy.some((b) => at < b.endsAt && at.getTime() + durationMs > b.startsAt.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
}

/**
 * A própria conversa já tem esse horário marcado?
 *
 * O agente confirma um agendamento chamando `schedule_meeting` de novo mais
 * tarde na mesma conversa (o LLM não tem garantia de lembrar que já marcou —
 * só vê o resultado em texto no histórico). Sem checar isto antes, a segunda
 * chamada batia em `hasConflict` contra o compromisso que ELE MESMO acabara de
 * criar, o agente achava que o horário fora tomado por outra pessoa, oferecia
 * outro, marcava esse, e repetia — nunca fechando o agendamento.
 */
export async function findOwnAppointment(
  tenantId: string,
  conversationId: string,
  startsAt: Date,
  endsAt: Date,
) {
  return prisma.appointment.findFirst({
    where: {
      tenantId,
      conversationId,
      status: "scheduled",
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
  });
}

export async function createAppointment(input: CreateAppointmentInput) {
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);

  const appointment = await prisma.appointment.create({
    data: {
      tenantId: input.tenantId,
      agentId: input.agentId ?? null,
      leadId: input.leadId ?? null,
      conversationId: input.conversationId ?? null,
      title: input.title,
      patientName: input.patientName ?? null,
      notes: input.notes ?? null,
      startsAt: input.startsAt,
      endsAt,
      source: input.source,
      serviceType: input.serviceType ?? null,
      kind: input.kind ?? null,
      procedure: input.procedure?.trim() || null,
      // Não deixe o worker enviar lembrete enquanto a tentativa ainda está
      // aguardando a resposta que pode recusá-la por conflito.
      reminderOverride: [],
    },
  });

  // O Clinicorp liga o horário ao cadastro do paciente pelo telefone, então
  // precisa do contato — o Google não usa nada disso.
  const lead = input.leadId
    ? await prisma.lead
        .findUnique({ where: { id: input.leadId }, select: { name: true, phone: true, isTest: true } })
        .catch(() => null)
    : null;

  // Uma recusa explícita por conflito é diferente de uma falha do espelho:
  // essa tentativa não pode ficar como consulta marcada nem ir para o Google.
  const clinicorpSync = await syncAppointmentToClinicorp(input.tenantId, appointment.id, {
    title: input.title,
    patientName: input.patientName,
    notes: input.notes,
    serviceType: input.serviceType,
    procedure: input.procedure,
    startsAt: input.startsAt,
    endsAt,
    timeZone: input.timezone,
    lead,
  });
  const clinicorpAppointmentId = clinicorpSync.status === "synced" ? clinicorpSync.appointmentId : null;

  if (clinicorpSync.status === "failed" && clinicorpSync.reason === "conflict") {
    await prisma.appointment.updateMany({
      where: { id: appointment.id, tenantId: input.tenantId, status: "scheduled" },
      data: {
        status: "canceled",
        reminderOverride: [],
        notes: [input.notes, "Tentativa recusada pelo Clinicorp: horário ocupado. Nenhuma consulta confirmada; o agente oferece outras opções."].filter(Boolean).join("\n\n"),
      },
    });
    return { ...appointment, status: "canceled", googleEventId: null, clinicorpAppointmentId: null, clinicorpSync };
  }

  if (input.leadId) {
    await prisma.lead.update({ where: { id: input.leadId }, data: { status: "scheduled" } }).catch(() => {});
  }
  const googleEventId = await pushEventToGoogle(input.tenantId, {
    title: input.title, description: input.notes ?? undefined,
    startsAt: input.startsAt, endsAt, timeZone: input.timezone,
  });

  // Lead de teste (chat do agente) marca o título e não leva o telefone ao iPhone.
  const icloud = await pushEventToIcloud(
    input.tenantId,
    {
      appointmentId: appointment.id, title: input.title, patientName: input.patientName, procedure: input.procedure,
      phone: lead?.isTest ? null : lead?.phone, notes: input.notes, startsAt: input.startsAt, endsAt,
      timeZone: input.timezone, isTest: lead?.isTest,
    },
    { agentId: input.agentId ?? null },
  );
  const icloudEventUrl = icloud.status === "synced" ? icloud.url : null;

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      reminderOverride: Prisma.DbNull,
      ...(googleEventId ? { googleEventId } : {}),
      ...(clinicorpAppointmentId ? { clinicorpAppointmentId } : {}),
      ...(icloudEventUrl ? { icloudEventUrl } : {}),
    },
  });

  return { ...appointment, reminderOverride: null, googleEventId, clinicorpAppointmentId, icloudEventUrl, clinicorpSync };
}

export async function cancelAppointment(tenantId: string, id: string, leadId?: string, options: {
  timezone?: string; reason?: string; source?: "agent" | "human";
} = {}) {
  const appointment = await prisma.appointment.findFirst({ where: { id, tenantId, ...(leadId ? { leadId } : {}) } });
  if (!appointment) return null;
  if (appointment.status === "canceled") return appointment;
  if (appointment.status !== "scheduled") return null;

  const now = new Date();
  const timezone = options.timezone ?? parseScheduleConfig(null).timezone;
  const date = dayKeyInZone(now, timezone).split("-").reverse().join("/");
  const reason = options.reason?.trim().replace(/\s+/g, " ").slice(0, 500);
  const observation = `Cancelado em ${date} às ${timeInZone(now, timezone)} (${timezone}) pelo ${options.source === "agent" ? "agente" : "painel"}.${reason ? ` Motivo informado: ${reason}` : ""}`;
  const notes = [appointment.notes, observation].filter(Boolean).join("\n\n");
  const changed = await prisma.appointment.updateMany({
    // Não sobrescreve observações editadas entre a leitura e o clique.
    where: { id, tenantId, status: "scheduled", notes: appointment.notes, startsAt: appointment.startsAt, endsAt: appointment.endsAt, ...(leadId ? { leadId } : {}) },
    data: { status: "canceled", notes },
  });
  if (!changed.count) return null;
  const [, clinicorpCancellationAccepted] = await Promise.all([
    appointment.googleEventId
      ? deleteEventFromGoogle(tenantId, appointment.googleEventId)
      : Promise.resolve(),
    appointment.clinicorpAppointmentId
      ? cancelAppointmentInClinicorp(tenantId, appointment.clinicorpAppointmentId)
      : Promise.resolve(true),
    // Sem endereço gravado apaga o endereço fixo do evento (404 = nada a remover).
    deleteIcloudEvent(tenantId, appointment.icloudEventUrl ?? null, appointment.id),
  ]);
  return { ...appointment, status: "canceled", notes, clinicorpCancellationAccepted };
}

/** Consultas futuras do contato, inclusive as combinadas em outra conversa. */
export async function listUpcomingLeadAppointments(tenantId: string, leadId: string) {
  return prisma.appointment.findMany({
    where: { tenantId, leadId, status: "scheduled", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
  });
}

export async function findLeadAppointment(tenantId: string, leadId: string, id: string) {
  return prisma.appointment.findFirst({ where: { id, tenantId, leadId } });
}

/** Mantém o ID ativo e guarda o horário anterior na mesma transação. */
export async function rescheduleAppointment(input: {
  tenantId: string; leadId: string; id: string; startsAt: Date; timezone: string;
}) {
  const previous = await findLeadAppointment(input.tenantId, input.leadId, input.id);
  if (!previous || previous.status !== "scheduled" || previous.startsAt <= new Date()) return { status: "unavailable" } as const;
  if (previous.startsAt.getTime() === input.startsAt.getTime()) return { status: "unchanged" } as const;
  const endsAt = new Date(input.startsAt.getTime() + previous.endsAt.getTime() - previous.startsAt.getTime());
  if (await hasConflictAnywhere(input.tenantId, input.startsAt, endsAt, input.timezone, previous.id, previous.clinicorpAppointmentId ?? undefined)) {
    return { status: "conflict" } as const;
  }
  const changedAt = new Date();
  const history = await prisma.$transaction(async (tx) => {
    const changed = await tx.appointment.updateMany({
      where: { id: previous.id, tenantId: input.tenantId, leadId: input.leadId, status: "scheduled", startsAt: previous.startsAt, endsAt: previous.endsAt,
        notes: previous.notes, rescheduledAt: previous.rescheduledAt },
      // Confirmação e lembretes enviados eram do horário antigo.
      data: { startsAt: input.startsAt, endsAt, rescheduledAt: changedAt, confirmedAt: null, confirmationSource: null,
        remindersSent: { set: [] }, reminderSentAt: null },
    });
    if (!changed.count) return null;
    return tx.appointmentReschedule.create({ data: {
      tenantId: input.tenantId, appointmentId: previous.id,
      startsAt: previous.startsAt, endsAt: previous.endsAt,
      nextStartsAt: input.startsAt, nextEndsAt: endsAt,
      notes: previous.notes, clinicorpAppointmentId: previous.clinicorpAppointmentId,
      createdAt: changedAt,
    } });
  });
  if (!history) return { status: "unavailable" } as const;

  // A alteração local já está confirmada. Espelhos são opcionais e nunca lançam.
  const [googleRemoved, clinicorpRemoved] = await Promise.all([
    previous.googleEventId ? deleteEventFromGoogle(input.tenantId, previous.googleEventId) : Promise.resolve(true),
    previous.clinicorpAppointmentId ? cancelAppointmentInClinicorp(input.tenantId, previous.clinicorpAppointmentId) : Promise.resolve(true),
  ]);
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, tenantId: input.tenantId }, select: { name: true, phone: true, isTest: true },
  }).catch(() => null);
  const event = { title: previous.title, startsAt: input.startsAt, endsAt, timeZone: input.timezone };
  const [googleEventId, clinicorpSync] = await Promise.all([
    googleRemoved ? pushEventToGoogle(input.tenantId, { ...event, description: previous.notes ?? undefined }) : Promise.resolve(previous.googleEventId),
    clinicorpRemoved ? pushAppointmentToClinicorp(input.tenantId, {
      ...event,
      patientName: previous.patientName ?? undefined,
      notes: previous.notes,
      serviceType: previous.serviceType,
      procedure: previous.procedure,
      lead,
    })
      : Promise.resolve({ status: "failed", error: "Não foi possível remover o horário anterior no Clinicorp." } as const),
  ]);
  // Preserva o ID antigo se sua remoção falhou: não cria duplicata nem perde
  // a referência para uma tentativa posterior de cancelamento.
  const clinicorpAppointmentId = clinicorpSync.status === "synced" ? clinicorpSync.appointmentId
    : clinicorpRemoved ? null : previous.clinicorpAppointmentId;
  if (clinicorpSync.status === "failed" && "reason" in clinicorpSync && clinicorpSync.reason === "conflict") {
    // A clínica recusou o novo horário. Reponha o original, que já havia sido
    // combinado, e deixe o agente consultar alternativas para uma nova escolha.
    const reverted = await prisma.$transaction(async (tx) => {
      const changed = await tx.appointment.updateMany({
        where: { id: previous.id, tenantId: input.tenantId, status: "scheduled", startsAt: input.startsAt, endsAt, rescheduledAt: changedAt },
        // A remarcação recusada não pode perder a confirmação nem seus lembretes.
        data: {
          startsAt: previous.startsAt, endsAt: previous.endsAt, rescheduledAt: previous.rescheduledAt,
          confirmedAt: previous.confirmedAt, confirmationSource: previous.confirmationSource,
          remindersSent: { set: previous.remindersSent }, reminderSentAt: previous.reminderSentAt,
        },
      });
      if (changed.count) await tx.appointmentReschedule.deleteMany({ where: { id: history.id, tenantId: input.tenantId, appointmentId: previous.id } });
      return changed;
    });
    if (!reverted.count) return { status: "unavailable" } as const;
    const newGoogleRemoved = googleRemoved && googleEventId
      ? await deleteEventFromGoogle(input.tenantId, googleEventId) : true;
    const [restoredGoogleId, restoredClinicorp] = await Promise.all([
      googleRemoved && newGoogleRemoved ? pushEventToGoogle(input.tenantId, {
        title: previous.title, description: previous.notes ?? undefined,
        startsAt: previous.startsAt, endsAt: previous.endsAt, timeZone: input.timezone,
      }) : Promise.resolve(googleEventId),
      clinicorpRemoved && previous.clinicorpAppointmentId ? pushAppointmentToClinicorp(input.tenantId, {
        title: previous.title, patientName: previous.patientName ?? undefined, notes: previous.notes,
        serviceType: previous.serviceType, procedure: previous.procedure,
        startsAt: previous.startsAt, endsAt: previous.endsAt, timeZone: input.timezone, lead,
      }) : Promise.resolve({ status: "skipped" } as const),
    ]);
    await prisma.appointment.updateMany({
      where: { id: previous.id, tenantId: input.tenantId, status: "scheduled", startsAt: previous.startsAt, endsAt: previous.endsAt },
      data: {
        googleEventId: restoredGoogleId,
        clinicorpAppointmentId: restoredClinicorp.status === "synced" ? restoredClinicorp.appointmentId : null,
        ...(restoredClinicorp.status === "failed" && restoredClinicorp.reason === "conflict" ? { reminderOverride: [] } : {}),
      },
    });
    return { status: "conflict" } as const;
  }
  // O Clinicorp aceitou (ou não é usado): agora o evento do iPhone vai para o
  // novo horário, no mesmo endereço. Quem nunca foi enviado fica por conta da
  // varredura do worker, que já lê o horário novo no banco.
  const icloud: IcloudSyncResult = previous.icloudEventUrl
    ? await updateIcloudEvent(input.tenantId, previous.icloudEventUrl, {
        appointmentId: previous.id, title: previous.title, patientName: previous.patientName, procedure: previous.procedure,
        phone: lead?.isTest ? null : lead?.phone, notes: previous.notes, startsAt: input.startsAt, endsAt,
        timeZone: input.timezone, isTest: lead?.isTest,
      }, { agentId: previous.agentId ?? null })
    : { status: "skipped" };
  // Não deu para mover o evento: esquece o endereço para a varredura reenviar o
  // horário atual (sobrescrevendo o antigo) assim que o iCloud responder.
  const icloudData = !previous.icloudEventUrl || icloud.status === "synced" ? {}
    : { icloudEventUrl: null, icloudSyncAttempts: 0, icloudNextAttemptAt: icloud.status === "failed" && icloud.reason === "transient" ? new Date(Date.now() + 2 * 60_000) : null };
  await prisma.appointment.updateMany({
    where: { id: previous.id, tenantId: input.tenantId, status: "scheduled", startsAt: input.startsAt, endsAt, rescheduledAt: changedAt },
    data: {
      googleEventId, clinicorpAppointmentId, ...icloudData,
    },
  });
  return { status: "rescheduled", clinicorpSync } as const;
}

export type MarkResult = "ok" | "not_found" | "not_allowed";

/**
 * Comparecimento marcado por alguém da clínica. `unknown` desfaz a marcação.
 *
 * A trava de horário vai no próprio WHERE (e não só num `if` antes): uma
 * consulta remarcada para depois entre a leitura e a escrita não pode ganhar
 * "compareceu" antes de acontecer. Linha legada `done` entra e sai normalizada.
 */
export async function setAppointmentAttendance(
  tenantId: string,
  id: string,
  attendance: Attendance,
  now = new Date(),
): Promise<MarkResult> {
  const row = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { status: true, startsAt: true } });
  if (!row) return "not_found";
  if (!canMarkAttendance(row, now)) return "not_allowed";
  const { count } = await prisma.appointment.updateMany({
    where: { id, tenantId, status: { in: ["scheduled", "done"] }, startsAt: { lte: now } },
    data: {
      status: "scheduled",
      attendance,
      attendanceSource: attendance === "unknown" ? null : "human",
      attendanceAt: attendance === "unknown" ? null : now,
    },
  });
  return count ? "ok" : "not_allowed";
}

/** Confirmação da presença futura. Não toca em `attendance`. */
export async function setAppointmentConfirmed(
  tenantId: string,
  id: string,
  confirmed: boolean,
  now = new Date(),
): Promise<MarkResult> {
  const row = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { status: true, startsAt: true } });
  if (!row) return "not_found";
  if (!canConfirm(row, now)) return "not_allowed";
  const { count } = await prisma.appointment.updateMany({
    where: { id, tenantId, status: "scheduled", startsAt: { gt: now } },
    data: confirmed ? { confirmedAt: now, confirmationSource: "human" } : { confirmedAt: null, confirmationSource: null },
  });
  return count ? "ok" : "not_allowed";
}

/** Tipo e procedimento corrigidos à mão. `kind: null` volta a "não classificado". */
export async function setAppointmentClassification(
  tenantId: string,
  id: string,
  input: { kind: AppointmentKind | null; procedure: string | null },
): Promise<boolean> {
  const { count } = await prisma.appointment.updateMany({
    where: { id, tenantId },
    data: { kind: input.kind, procedure: input.procedure?.trim() || null },
  });
  return count > 0;
}

const withLead = {
  lead: { select: { id: true, name: true, phone: true, status: true } },
  agent: { select: { id: true, name: true } },
} as const;

/** Horários antigos, inclusive quando o agendamento atual já está em outro mês. */
export async function listMonthAppointmentReschedules(tenantId: string, year: number, month: number, timezone: string) {
  const { start, end } = monthRangeUtc(year, month, timezone);
  return prisma.appointmentReschedule.findMany({
    where: { tenantId, appointment: { tenantId }, startsAt: { gte: start, lt: end } },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    include: { appointment: { include: withLead } },
  });
}

/** Compromissos de um mês (do fuso do tenant), já agrupados por dia local. */
export async function listMonthAppointments(
  tenantId: string,
  year: number,
  month: number,
  timezone: string,
) {
  const { start, end } = monthRangeUtc(year, month, timezone);
  const rows = await prisma.appointment.findMany({
    where: { tenantId, startsAt: { gte: start, lt: end } },
    orderBy: { startsAt: "asc" },
    include: { ...withLead, clinicorpSync: { select: { state: true } } },
  });

  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = dayKeyInZone(row.startsAt, timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }
  return { rows, byDay };
}

/** Próximos compromissos ainda de pé — usado na home e na lateral da agenda. */
export async function listUpcomingAppointments(tenantId: string, take = 5) {
  return prisma.appointment.findMany({
    where: { tenantId, status: "scheduled", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take,
    include: withLead,
  });
}

export async function listLeadAppointments(tenantId: string, leadId: string) {
  return prisma.appointment.findMany({
    where: { tenantId, leadId },
    orderBy: { startsAt: "asc" },
  });
}
