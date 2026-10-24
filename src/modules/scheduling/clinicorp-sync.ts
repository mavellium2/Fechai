import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCalendarFeatures } from "./features";
import { parseScheduleConfig } from "./config";
import { deleteEventFromGoogle } from "./google";
import { deleteIcloudEvent } from "./icloud";
import {
  cancelAppointmentInClinicorp, getClinicorpStatus, lookupClinicorpAppointment,
  pushAppointmentToClinicorp, type ClinicorpEventInput, type ClinicorpSyncResult,
} from "./clinicorp";

const RETRY_MS = 2 * 60_000;
const LEASE_MS = 3 * 60_000;
const payloadSchema = z.object({
  title: z.string(), patientName: z.string().optional(), notes: z.string().nullable().optional(),
  serviceType: z.string().nullable().optional(), procedure: z.string().nullable().optional(),
  startsAt: z.string().datetime(), endsAt: z.string().datetime(), timeZone: z.string(),
  recoverExisting: z.boolean().optional(),
  lead: z.object({ name: z.string().nullable(), phone: z.string().nullable(), isTest: z.boolean().optional() }).nullable().optional(),
});
const targetSchema = z.object({
  subscriberId: z.string(), businessId: z.string().min(1), dentistId: z.string().nullable(), categoryDescription: z.string().nullable(),
});

/** Persistido antes de chamar a API: reiniciar web/worker não perde o envio. */
export async function syncAppointmentToClinicorp(tenantId: string, appointmentId: string, input: ClinicorpEventInput): Promise<ClinicorpSyncResult> {
  try {
    const [features, status] = await Promise.all([getCalendarFeatures(tenantId), getClinicorpStatus(tenantId)]);
    if (!features.clinicorpEnabled || status?.syncEnabled === false) return { status: "skipped" };
    const target = status?.businessId ? {
      subscriberId: status.subscriberId, businessId: status.businessId,
      dentistId: status.dentistId, categoryDescription: status.categoryDescription,
    } : {};
    // Uma consulta já enviada pode ter sido reagendada e o novo POST falhado.
    // Só substitua uma versão terminal, nunca um envio ainda incerto.
    await prisma.clinicorpAppointmentSync.updateMany({
      where: { appointmentId, tenantId, state: { in: ["synced", "canceled"] }, appointment: { status: "scheduled", clinicorpAppointmentId: null } },
      data: { payload: JSON.parse(JSON.stringify(input)), target, state: "queued", attempts: 0, nextAttemptAt: new Date(), externalId: null, lastError: null },
    });
    const job = await prisma.clinicorpAppointmentSync.upsert({
      where: { appointmentId },
      create: { tenantId, appointmentId, payload: JSON.parse(JSON.stringify(input)), target },
      // Uma segunda chamada não troca o destino nem reinicia um envio incerto.
      update: {},
      select: { id: true, tenantId: true },
    });
    if (job.tenantId !== tenantId) return { status: "failed", error: "O envio não pertence a esta conta." };
    return await processClinicorpSync(job.id);
  } catch {
    return { status: "failed", error: "Não foi possível iniciar o envio automático ao Clinicorp. A consulta foi preservada." };
  }
}

/** Claim no banco, compartilhado pela tentativa imediata e pelo worker. */
export async function processClinicorpSync(id: string, now = new Date()): Promise<ClinicorpSyncResult> {
  const token = randomUUID();
  const claimed = await prisma.clinicorpAppointmentSync.updateMany({
    where: {
      id, state: { in: ["queued", "retry", "processing"] }, nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    data: { state: "processing", lockToken: token, lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (!claimed.count) {
    const row = await prisma.clinicorpAppointmentSync.findUnique({ where: { id }, select: { state: true, externalId: true } });
    return row?.state === "synced" && row.externalId
      ? { status: "synced", appointmentId: row.externalId }
      : row?.state === "conflict"
        ? { status: "failed", reason: "conflict", error: "O Clinicorp recusou o horário ocupado." }
        : row?.state === "canceled" ? { status: "skipped" }
          : { status: "failed", automatic: Boolean(row), error: "O envio ao Clinicorp está sendo concluído automaticamente." };
  }
  const finish = (data: Prisma.ClinicorpAppointmentSyncUpdateManyMutationInput) => prisma.clinicorpAppointmentSync.updateMany({
    where: { id, lockToken: token }, data: { ...data, lockedUntil: null, lockToken: null },
  });
  try {
    const job = await prisma.clinicorpAppointmentSync.findUnique({ where: { id }, include: { appointment: true } });
    if (!job || job.tenantId !== job.appointment.tenantId) throw new Error("Escopo inválido");
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new Error("Dados do envio inválidos");
    let target = targetSchema.safeParse(job.target);
    if (!target.success) {
      const status = await getClinicorpStatus(job.tenantId);
      target = targetSchema.safeParse(status);
      if (!target.success) throw new Error("Conexão da clínica ainda não disponível");
      await prisma.clinicorpAppointmentSync.updateMany({ where: { id, lockToken: token }, data: { target: target.data } });
    }
    const input: ClinicorpEventInput = {
      ...parsed.data, startsAt: new Date(parsed.data.startsAt), endsAt: new Date(parsed.data.endsAt),
      referenceId: id, target: target.data,
    };
    const current = job.appointment;
    const stale = current.status !== "scheduled" || current.startsAt.getTime() !== input.startsAt.getTime() || current.endsAt.getTime() !== input.endsAt.getTime();
    if (stale) {
      // Um timeout pode ter criado a consulta depois do cancelamento local.
      // Confira e remova o envio antigo; jamais recrie um horário cancelado.
      const existing = await lookupClinicorpAppointment(job.tenantId, input);
      if (existing.status === "unavailable") throw new Error("Ainda não foi possível conferir o envio antigo");
      if (existing.status === "found" && !await cancelAppointmentInClinicorp(job.tenantId, existing.appointmentId, target.data)) throw new Error("Limpeza do envio antigo ainda não confirmada");
      await finish({ state: "canceled", lastError: null });
      return { status: "skipped" };
    }
    if (current.clinicorpAppointmentId) {
      await finish({ state: "synced", externalId: current.clinicorpAppointmentId, lastError: null });
      return { status: "synced", appointmentId: current.clinicorpAppointmentId };
    }
    const result = await pushAppointmentToClinicorp(job.tenantId, input);
    if (result.status === "synced") {
      const linked = await prisma.appointment.updateMany({
        where: { id: current.id, tenantId: job.tenantId, status: "scheduled", startsAt: input.startsAt, endsAt: input.endsAt, clinicorpAppointmentId: null },
        data: { clinicorpAppointmentId: result.appointmentId },
      });
      if (!linked.count) {
        // A consulta mudou durante o POST. O próximo ciclo limpa a versão antiga.
        throw new Error("Consulta mudou durante o envio");
      }
      await finish({ state: "synced", externalId: result.appointmentId, lastError: null });
    } else if (result.status === "failed" && result.reason === "conflict") {
      const canceled = await prisma.appointment.updateMany({
        where: { id: current.id, tenantId: job.tenantId, status: "scheduled", startsAt: input.startsAt, endsAt: input.endsAt, clinicorpAppointmentId: null },
        data: { status: "canceled", reminderOverride: [], updatedAt: new Date() },
      });
      if (canceled.count && current.googleEventId) await deleteEventFromGoogle(job.tenantId, current.googleEventId);
      // O horário não existe: o evento do iPhone também sai (senão bloqueia o horário e confunde o cliente).
      if (canceled.count) await deleteIcloudEvent(job.tenantId, current.icloudEventUrl ?? null, current.id);
      await finish({ state: "conflict", lastError: result.error.slice(0, 500) });
    } else {
      const error = result.status === "failed" ? result.error : "O envio aguarda a integração ser religada.";
      await finish({ state: "retry", lastError: error.slice(0, 500), nextAttemptAt: new Date(now.getTime() + RETRY_MS) });
    }
    return result.status === "failed" && result.reason !== "conflict" ? { ...result, automatic: true }
      : result.status === "skipped" ? { status: "failed", automatic: true, error: "O envio será retomado automaticamente quando a integração estiver ligada." } : result;
  } catch {
    await finish({ state: "retry", lastError: "O envio será conferido e retomado automaticamente.", nextAttemptAt: new Date(now.getTime() + RETRY_MS) });
    return { status: "failed", automatic: true, error: "O envio ao Clinicorp será conferido e retomado automaticamente." };
  }
}

/** Recupera também consultas que ficaram sem envio antes da fila existir. */
export async function scanClinicorpSync(now = new Date()) {
  const legacy = await prisma.appointment.findMany({
    where: {
      status: "scheduled", clinicorpAppointmentId: null,
      OR: [{ clinicorpSync: null }, { clinicorpSync: { state: { in: ["synced", "canceled"] } } }],
      startsAt: { gte: now }, tenant: { status: "active", calendarFeatures: { clinicorpEnabled: true }, clinicorp: { syncEnabled: true } },
    },
    take: 20, orderBy: { createdAt: "asc" }, include: { lead: { select: { name: true, phone: true, isTest: true } } },
  });
  for (const appointment of legacy) {
    const action = appointment.agentId ? await prisma.tenantAction.findUnique({ where: { agentId_key: { agentId: appointment.agentId, key: "schedule_meeting" } }, select: { config: true } }) : null;
    const timezone = parseScheduleConfig(action?.config).timezone;
    await syncAppointmentToClinicorp(appointment.tenantId, appointment.id, {
      title: appointment.title, patientName: appointment.patientName ?? undefined,
      notes: appointment.notes, serviceType: appointment.serviceType, procedure: appointment.procedure,
      startsAt: appointment.startsAt, endsAt: appointment.endsAt, timeZone: timezone,
      lead: appointment.lead, recoverExisting: true,
    });
  }
  const due = await prisma.clinicorpAppointmentSync.findMany({
    where: {
      state: { in: ["queued", "retry", "processing"] }, nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      appointment: { tenant: { status: "active" } },
    },
    orderBy: { nextAttemptAt: "asc" }, take: 30, select: { id: true },
  });
  // A varredura pode durar minutos: cada lease começa na hora da tentativa,
  // não no início da varredura (senão já nasceria expirada para as últimas).
  for (const job of due) await processClinicorpSync(job.id);
  return { recovered: legacy.length, processed: due.length };
}
