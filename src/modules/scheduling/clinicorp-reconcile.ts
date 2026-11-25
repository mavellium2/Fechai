import { prisma } from "@/lib/prisma";
import { moveLeadToStage } from "@/modules/crm/automatic-stage";
import { listClinicorpAgenda, type ClinicorpAgenda, type ClinicorpAgendaItem } from "./clinicorp";
import { deleteEventFromGoogle, pushEventToGoogle } from "./google";
import { deleteIcloudEvent, updateIcloudEvent } from "./icloud";
import { dayKeyInZone, timeInZone } from "./time";

/**
 * Acompanha o Clinicorp: o que o fechai espelhou lá pode ser mudado pela
 * recepção, e o fechai tem de seguir a mudança.
 *
 * O envio sempre foi do fechai para o Clinicorp; ninguém lia o caminho de volta.
 * Resultado: consulta remarcada lá seguia no horário antigo aqui (o lembrete
 * saía com a hora velha) e consulta apagada lá seguia de pé (o lembrete ia para
 * quem já não estava na agenda da clínica).
 *
 * **O Clinicorp vence** numa divergência de horário ou cancelamento: foi a
 * clínica quem decidiu. Mas só se age sobre o que a leitura comprova:
 * - remarcada (mesmo id, outro horário) → o agendamento daqui ganha o horário
 *   novo, com histórico, e os lembretes voltam a valer para ele;
 * - cancelada lá → cancelada aqui (sem devolver nada ao Clinicorp);
 * - **ausente** (apagada, ou fora do período lido) → nada é alterado: o
 *   lembrete é que não sai, com o motivo na agenda. Ausência não é prova de
 *   exclusão, então nunca cancela sozinha;
 * - leitura que falhou ou veio incompleta → nada é concluído (`unverified`).
 *
 * Nunca lança: um Clinicorp fora do ar não pode derrubar a varredura.
 */

/** O Clinicorp precisa de um tempo para listar o que acabou de receber. */
const SETTLE_MS = 15 * 60_000;
/** Até onde a leitura olha além da última consulta, para pegar remarcação para frente. */
const READ_PAD_DAYS = 30;
/** A varredura de lembretes roda a cada minuto; a leitura, no máximo a cada 4. */
const RESULT_TTL_MS = 4 * 60_000;

export type MirroredAppointment = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  clinicorpAppointmentId: string;
  /** Última alteração local: consulta recém-criada ou movida ainda pode não constar da lista. */
  updatedAt: Date;
};

export type ReconcileDecision =
  | { kind: "same" }
  | { kind: "moved"; startsAt: Date; endsAt: Date }
  | { kind: "canceled" }
  /** Não está na leitura: lembrete bloqueado, nada alterado. */
  | { kind: "missing" }
  /** Não dá para concluir (leitura incompleta ou consulta recente). */
  | { kind: "unverified" };

const minute = (d: Date) => Math.floor(d.getTime() / 60_000);

/** Regra pura: o que fazer com UMA consulta espelhada, dada a leitura do Clinicorp. */
export function decideReconcile(
  local: MirroredAppointment,
  remote: ClinicorpAgendaItem | undefined,
  context: { readComplete: boolean; now: Date },
): ReconcileDecision {
  if (remote) {
    if (remote.canceled) return { kind: "canceled" };
    if (minute(remote.startsAt) === minute(local.startsAt)) return { kind: "same" };
    // Sem um fim válido, mantém a duração que já tinha.
    const duration = local.endsAt.getTime() - local.startsAt.getTime();
    const endsAt = remote.endsAt && remote.endsAt > remote.startsAt
      ? remote.endsAt
      : new Date(remote.startsAt.getTime() + duration);
    return { kind: "moved", startsAt: remote.startsAt, endsAt };
  }
  if (!context.readComplete) return { kind: "unverified" };
  if (context.now.getTime() - local.updatedAt.getTime() < SETTLE_MS) return { kind: "unverified" };
  return { kind: "missing" };
}

export type ReconcileResult =
  /** Integração desligada ou sem consultas espelhadas: nada a conferir. */
  | { status: "idle" }
  /** A leitura falhou: ninguém pode afirmar que o horário local é o de lá. */
  | { status: "unavailable"; error: string }
  | {
      status: "ok";
      moved: number;
      canceled: number;
      /** Ids locais ausentes do Clinicorp: não lembrar. */
      missing: Set<string>;
      /** Ids locais que não deu para conferir agora: esperar a próxima volta. */
      unverified: Set<string>;
    };

/** O que a varredura de lembretes faz com uma consulta espelhada. */
export function reminderVerdict(result: ReconcileResult | undefined, appointmentId: string): "send" | "wait" | "missing" {
  if (!result || result.status === "idle") return "send";
  if (result.status === "unavailable") return "wait";
  if (result.missing.has(appointmentId)) return "missing";
  if (result.unverified.has(appointmentId)) return "wait";
  return "send";
}

export const MISSING_IN_CLINICORP_REASON =
  "Esta consulta não foi encontrada no Clinicorp. Confira a agenda da clínica antes de lembrar o paciente.";

const cache = new Map<string, { at: number; result: ReconcileResult }>();

/** Só para os testes. */
export function resetReconcileCache() {
  cache.clear();
}

export async function reconcileMirroredAppointments(
  tenantId: string,
  timezone: string,
  now: Date = new Date(),
  options: {
    /** Até quando olhar à frente. */
    horizonMs?: number;
    read?: (from: string, to: string) => Promise<ClinicorpAgenda>;
  } = {},
): Promise<ReconcileResult> {
  const hit = cache.get(tenantId);
  if (hit && now.getTime() - hit.at >= 0 && now.getTime() - hit.at < RESULT_TTL_MS) return hit.result;
  const result = await run(tenantId, timezone, now, options);
  cache.set(tenantId, { at: now.getTime(), result });
  return result;
}

async function run(
  tenantId: string,
  timezone: string,
  now: Date,
  options: { horizonMs?: number; read?: (from: string, to: string) => Promise<ClinicorpAgenda> },
): Promise<ReconcileResult> {
  try {
    const horizon = new Date(now.getTime() + (options.horizonMs ?? 30 * 24 * 60 * 60_000));
    const rows = await prisma.appointment.findMany({
      where: { tenantId, status: "scheduled", clinicorpAppointmentId: { not: null }, startsAt: { gte: now, lte: horizon } },
      select: { id: true, startsAt: true, endsAt: true, clinicorpAppointmentId: true, updatedAt: true },
    });
    const locals: MirroredAppointment[] = rows.flatMap((r) => r.clinicorpAppointmentId ? [{ ...r, clinicorpAppointmentId: r.clinicorpAppointmentId }] : []);
    if (locals.length === 0) return { status: "idle" };

    // Um dia antes de hoje e uma margem depois: a consulta pode ter sido movida
    // para fora do período em que está gravada aqui.
    const last = locals.reduce((max, a) => (a.startsAt > max ? a.startsAt : max), locals[0].startsAt);
    const from = dayKeyInZone(new Date(now.getTime() - 24 * 60 * 60_000), timezone);
    const to = dayKeyInZone(new Date(last.getTime() + READ_PAD_DAYS * 24 * 60 * 60_000), timezone);
    const agenda = await (options.read ? options.read(from, to) : listClinicorpAgenda(tenantId, from, to, timezone, { fresh: true }));
    if (agenda.status === "off") return { status: "idle" };
    if (agenda.status !== "ok") return { status: "unavailable", error: agenda.error };

    const byId = new Map(agenda.items.map((item) => [item.id, item]));
    // Linha que a leitura não soube posicionar pode ser justamente a consulta
    // que falta: com `skipped`, ausência não prova nada.
    const readComplete = agenda.skipped === 0;
    let moved = 0;
    let canceled = 0;
    const missing = new Set<string>();
    const unverified = new Set<string>();
    for (const local of locals) {
      const decision = decideReconcile(local, byId.get(local.clinicorpAppointmentId), { readComplete, now });
      if (decision.kind === "moved") {
        if (await applyMove(tenantId, timezone, local, decision.startsAt, decision.endsAt, now)) moved++;
      } else if (decision.kind === "canceled") {
        if (await applyCancel(tenantId, timezone, local, now)) canceled++;
      } else if (decision.kind === "missing") missing.add(local.id);
      else if (decision.kind === "unverified") unverified.add(local.id);
    }
    if (moved || canceled || missing.size) {
      console.log(`[clinicorp] conta=${tenantId} remarcadas=${moved} canceladas=${canceled} ausentes=${missing.size}`);
    }
    return { status: "ok", moved, canceled, missing, unverified };
  } catch (err) {
    console.error("[clinicorp] conferir consultas espelhadas falhou", err);
    return { status: "unavailable", error: "Não foi possível conferir as consultas com o Clinicorp." };
  }
}

/**
 * Leva o horário do Clinicorp para cá. O que foi enviado e confirmado era do
 * horário antigo, então os lembretes voltam a valer (uma consulta remarcada para
 * ainda hoje recebe o aviso com a hora certa). O histórico guarda o horário
 * anterior, como em `rescheduleAppointment`.
 */
async function applyMove(tenantId: string, timezone: string, local: MirroredAppointment, startsAt: Date, endsAt: Date, now: Date): Promise<boolean> {
  const moved = await prisma.$transaction(async (tx) => {
    const changed = await tx.appointment.updateMany({
      // Só se ninguém mexeu entre a leitura e a gravação.
      where: { id: local.id, tenantId, status: "scheduled", startsAt: local.startsAt, endsAt: local.endsAt },
      data: {
        startsAt, endsAt, rescheduledAt: now, confirmedAt: null, confirmationSource: null,
        remindersSent: { set: [] }, reminderSentAt: null,
      },
    });
    if (!changed.count) return false;
    await tx.appointmentReschedule.create({ data: {
      tenantId, appointmentId: local.id,
      startsAt: local.startsAt, endsAt: local.endsAt, nextStartsAt: startsAt, nextEndsAt: endsAt,
      clinicorpAppointmentId: local.clinicorpAppointmentId, createdAt: now,
    } });
    return true;
  });
  if (!moved) return false;
  await mirrorMoveElsewhere(tenantId, timezone, local.id, startsAt, endsAt);
  return true;
}

/** Google e iCloud acompanham, sem nunca derrubar a conferência. */
async function mirrorMoveElsewhere(tenantId: string, timezone: string, id: string, startsAt: Date, endsAt: Date) {
  try {
    const appt = await prisma.appointment.findFirst({
      where: { id, tenantId },
      include: { lead: { select: { phone: true, isTest: true } } },
    });
    if (!appt) return;
    if (appt.googleEventId) {
      const removed = await deleteEventFromGoogle(tenantId, appt.googleEventId);
      if (removed) {
        const googleEventId = await pushEventToGoogle(tenantId, {
          title: appt.title, description: appt.notes ?? undefined, startsAt, endsAt, timeZone: timezone,
        });
        await prisma.appointment.updateMany({ where: { id, tenantId }, data: { googleEventId } });
      }
    }
    if (appt.icloudEventUrl) {
      await updateIcloudEvent(tenantId, appt.icloudEventUrl, {
        appointmentId: appt.id, title: appt.title, patientName: appt.patientName, procedure: appt.procedure,
        phone: appt.lead?.isTest ? null : appt.lead?.phone, notes: appt.notes, startsAt, endsAt,
        timeZone: timezone, isTest: appt.lead?.isTest,
      }, { agentId: appt.agentId ?? null });
    }
  } catch (err) {
    console.error("[clinicorp] acompanhar a remarcação no Google/iCloud falhou", id, err);
  }
}

/**
 * Cancelada no Clinicorp: cancela aqui. Não volta ao Clinicorp (já está
 * cancelada lá), só ao Google e ao iPhone. A observação diz de onde veio.
 */
async function applyCancel(tenantId: string, timezone: string, local: MirroredAppointment, now: Date): Promise<boolean> {
  const current = await prisma.appointment.findFirst({ where: { id: local.id, tenantId, status: "scheduled" } });
  if (!current) return false;
  const date = dayKeyInZone(now, timezone).split("-").reverse().join("/");
  const observation = `Cancelado em ${date} às ${timeInZone(now, timezone)} (${timezone}) no Clinicorp.`;
  const changed = await prisma.appointment.updateMany({
    where: { id: current.id, tenantId, status: "scheduled", notes: current.notes },
    data: { status: "canceled", notes: [current.notes, observation].filter(Boolean).join("\n\n") },
  });
  if (!changed.count) return false;
  try {
    if (current.leadId) {
      await moveLeadToStage(tenantId, current.leadId, "booking_canceled", "system",
        { reason: "appointment_canceled", key: current.id, appointmentId: current.id, at: now });
    }
    await Promise.all([
      current.googleEventId ? deleteEventFromGoogle(tenantId, current.googleEventId) : Promise.resolve(),
      deleteIcloudEvent(tenantId, current.icloudEventUrl ?? null, current.id),
    ]);
  } catch (err) {
    console.error("[clinicorp] acompanhar o cancelamento falhou", current.id, err);
  }
  return true;
}
