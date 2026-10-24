import { prisma } from "@/lib/prisma";
import { deleteIcloudEvent, pushEventToIcloud, scheduleContextFor } from "./icloud";

/**
 * Varredura que garante o espelho no Calendário da Apple (roda no worker, ver
 * `workers/follow-up-worker/index.ts`).
 *
 * O envio na hora da marcação (`createAppointment`) é o caminho normal; esta
 * varredura cobre o resto: iCloud fora do ar naquele momento, senha que voltou,
 * remarcação que não chegou lá e — por decisão de produto — as consultas
 * **futuras que já existiam** quando a conta ligou o iCloud. Consulta passada
 * nunca é enviada (evento antigo no calendário do cliente só atrapalha).
 *
 * Nunca lança. Nada de credencial no log: só contagens e o tenant.
 */

/** Teto por conta e por rodada: uma conta com 300 consultas antigas não prende a fila. */
const PER_ACCOUNT = 10;
const PER_ROUND = 50;
/** O envio na hora da marcação ainda pode estar em curso (Clinicorp, Google): dá tempo a ele. */
const NEW_APPOINTMENT_GRACE_MS = 2 * 60_000;
const MAX_BACKOFF_MINUTES = 60;

export type IcloudSyncScan = {
  tenants: number;
  sent: number;
  /** Eventos de consultas canceladas que sobraram no iPhone e foram apagados agora. */
  removed: number;
  failed: number;
  /** Contas paradas nesta rodada porque a Apple recusou a senha. */
  revoked: number;
};

/** 2, 4, 8… minutos até 60, sem limite de tentativas: consulta futura não pode ficar sem evento. */
export function backoffMinutes(attempts: number): number {
  return Math.min(MAX_BACKOFF_MINUTES, 2 ** Math.max(1, attempts));
}

export async function scanIcloudSync(now = new Date()): Promise<IcloudSyncScan> {
  const result: IcloudSyncScan = { tenants: 0, sent: 0, removed: 0, failed: 0, revoked: 0 };
  try {
    const accounts = await prisma.icloudCalendarIntegration.findMany({
      where: {
        syncEnabled: true,
        calendarUrl: { not: null },
        authFailedAt: null,
        // Calendário sumido/somente leitura para a conta até a pessoa escolher de novo.
        connectionError: null,
        tenant: { status: "active", calendarFeatures: { icloudEnabled: true } },
      },
      select: { tenantId: true },
      orderBy: { lastSyncAt: { sort: "asc", nulls: "first" } },
      take: 100,
    });

    let budget = PER_ROUND;
    for (const { tenantId } of accounts) {
      if (budget <= 0) break;
      result.tenants++;

      // Primeiro o que está sobrando: evento de consulta cancelada (o DELETE falhou
      // na hora — iCloud fora, 5xx) continua bloqueando o horário no iPhone.
      const leftovers = await removeLeftovers(tenantId, Math.min(PER_ACCOUNT, budget), now);
      budget -= leftovers.tried;
      result.removed += leftovers.removed;
      result.failed += leftovers.failed;
      if (budget <= 0) break;

      const due = await prisma.appointment.findMany({
        where: {
          tenantId,
          status: "scheduled",
          startsAt: { gt: now },
          icloudEventUrl: null,
          createdAt: { lt: new Date(now.getTime() - NEW_APPOINTMENT_GRACE_MS) },
          OR: [{ icloudNextAttemptAt: null }, { icloudNextAttemptAt: { lte: now } }],
        },
        orderBy: { startsAt: "asc" },
        take: Math.min(PER_ACCOUNT, budget),
        select: { id: true },
      });

      const contexts = new Map<string | null, { timeZone: string; location: string }>();
      for (const { id } of due) {
        budget--;
        const outcome = await syncOne(tenantId, id, contexts, now);
        if (outcome === "sent") result.sent++;
        else if (outcome === "failed") result.failed++;
        else if (outcome === "revoked") { result.revoked++; break; }
        else if (outcome === "stop") break;
      }
    }
  } catch (err) {
    console.error("[icloud] varredura de envio falhou", err instanceof Error ? err.name : "erro");
  }
  return result;
}

/**
 * Apaga do iPhone os eventos de consultas canceladas que ainda têm endereço
 * gravado, com o mesmo recuo (2, 4, 8… até 60 min) e sem limite de tentativas.
 * `deleteIcloudEvent` esquece o endereço depois de 2xx ou 404; aqui também, por
 * garantia. Para na primeira falha: iCloud fora do ar não pede dez timeouts seguidos.
 */
async function removeLeftovers(tenantId: string, take: number, now: Date) {
  const out = { tried: 0, removed: 0, failed: 0 };
  try {
    const rows = await prisma.appointment.findMany({
      where: {
        tenantId,
        status: "canceled",
        icloudEventUrl: { not: null },
        OR: [{ icloudNextAttemptAt: null }, { icloudNextAttemptAt: { lte: now } }],
      },
      orderBy: { updatedAt: "asc" },
      take,
      select: { id: true, icloudEventUrl: true, icloudSyncAttempts: true },
    });
    for (const row of rows) {
      out.tried++;
      if (await deleteIcloudEvent(tenantId, row.icloudEventUrl, row.id)) {
        await prisma.appointment.updateMany({
          where: { id: row.id, tenantId, status: "canceled" },
          data: { icloudEventUrl: null, icloudSyncAttempts: 0, icloudNextAttemptAt: null },
        });
        out.removed++;
      } else {
        const attempts = row.icloudSyncAttempts + 1;
        await prisma.appointment.updateMany({
          where: { id: row.id, tenantId, status: "canceled" },
          data: { icloudSyncAttempts: attempts, icloudNextAttemptAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000) },
        });
        out.failed++;
        break;
      }
    }
  } catch (err) {
    console.error(`[icloud] limpar eventos cancelados falhou tenant=${tenantId}`, err instanceof Error ? err.name : "erro");
  }
  return out;
}

type Outcome = "sent" | "failed" | "skipped" | "revoked" | "stop";

async function syncOne(
  tenantId: string,
  id: string,
  contexts: Map<string | null, { timeZone: string; location: string }>,
  now: Date,
): Promise<Outcome> {
  try {
    // Relê: a consulta pode ter sido cancelada ou enviada desde a listagem.
    const a = await prisma.appointment.findFirst({
      where: { id, tenantId },
      select: {
        id: true, status: true, startsAt: true, endsAt: true, icloudEventUrl: true, icloudSyncAttempts: true,
        title: true, patientName: true, procedure: true, notes: true, agentId: true, leadId: true,
      },
    });
    if (!a || a.status !== "scheduled" || a.icloudEventUrl || a.startsAt <= now) return "skipped";

    const lead = a.leadId
      ? await prisma.lead.findFirst({ where: { id: a.leadId, tenantId }, select: { phone: true, isTest: true } }).catch(() => null)
      : null;
    let context = contexts.get(a.agentId);
    if (!context) {
      context = await scheduleContextFor(tenantId, a.agentId);
      contexts.set(a.agentId, context);
    }

    const sync = await pushEventToIcloud(tenantId, {
      appointmentId: a.id, title: a.title, patientName: a.patientName, procedure: a.procedure,
      phone: lead?.isTest ? null : lead?.phone, notes: a.notes, location: context.location,
      startsAt: a.startsAt, endsAt: a.endsAt, timeZone: context.timeZone, isTest: lead?.isTest,
    });

    if (sync.status === "skipped") return "stop";
    if (sync.status === "failed") {
      if (sync.reason === "auth") return "revoked";
      if (sync.reason === "calendar") return "stop";
      const attempts = a.icloudSyncAttempts + 1;
      await prisma.appointment.updateMany({
        where: { id, tenantId, icloudEventUrl: null },
        data: { icloudSyncAttempts: attempts, icloudNextAttemptAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000) },
      });
      return "failed";
    }

    // Só liga o endereço se a consulta ainda é exatamente a que foi enviada.
    const linked = await prisma.appointment.updateMany({
      where: { id, tenantId, status: "scheduled", startsAt: a.startsAt, endsAt: a.endsAt, icloudEventUrl: null },
      data: { icloudEventUrl: sync.url, icloudSyncAttempts: 0, icloudNextAttemptAt: null },
    });
    if (!linked.count) {
      // Cancelou durante o envio: o evento recém-criado não pode ficar no iPhone.
      // Remarcou durante o envio: nada a fazer — a próxima rodada reenvia o horário novo.
      const current = await prisma.appointment.findFirst({ where: { id, tenantId }, select: { status: true } });
      if (current && current.status !== "scheduled") await deleteIcloudEvent(tenantId, sync.url, id);
      return "skipped";
    }
    return "sent";
  } catch (err) {
    console.error(`[icloud] enviar consulta falhou tenant=${tenantId}`, err instanceof Error ? err.name : "erro");
    return "failed";
  }
}
