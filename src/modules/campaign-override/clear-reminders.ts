import { prisma } from "@/lib/prisma";
import { parseReminderOverride } from "@/modules/scheduling/reminder-override";
import { resolveScriptActor } from "./actor";
import { resolveCampaignLeadMatches } from "./lead";

/**
 * URG-03 para o que já existe: consultas futuras de leads da campanha de
 * implantes (até o fim da regra, 19/11 23:59:59) passam a **não receber nenhum lembrete** (`reminderOverride = []`) e
 * os disparos pendentes (`ReminderDispatch` em `queued`) delas são dispensados
 * (`skipped`, motivo "campanha implantes"). Consulta nova já nasce assim
 * (`createAppointment`); isto limpa o que foi marcado antes da regra.
 *
 * Simula por padrão. Gravar exige `apply` e um `actorId` válido (superadmin ou
 * usuário da conta). Só conta: nada daqui (retorno, log, auditoria) leva nome,
 * telefone ou id de lead.
 */

export const CLEARED_REASON = "campanha implantes";

export type ClearRemindersResult = {
  /** Consultas futuras de leads da campanha. */
  matched: number;
  /** Quantas mudaram (ou mudariam) para `[]`; as que já eram `[]` ficam de fora. */
  appointments: number;
  /** Disparos `queued` dispensados (ou que seriam). */
  dispatches: number;
  applied: boolean;
};

export async function clearCampaignReminders(input: {
  tenantId: string;
  apply?: boolean;
  actorId?: string;
  now?: Date;
}): Promise<ClearRemindersResult> {
  const { tenantId } = input;
  const apply = input.apply === true;
  const now = input.now ?? new Date();
  if (apply && !input.actorId) throw new Error("--actor <userId> é obrigatório para gravar.");

  // Ator inválido recusa antes de tocar em qualquer linha.
  let actor: Awaited<ReturnType<typeof resolveScriptActor>> | null = null;
  if (apply) {
    actor = await resolveScriptActor(input.actorId as string, tenantId);
    if (!actor.ok) throw new Error(actor.message);
  }

  const appointments = await prisma.appointment.findMany({
    where: { tenantId, status: "scheduled", startsAt: { gt: now }, leadId: { not: null } },
    select: { id: true, leadId: true, startsAt: true, clinicorpAppointmentId: true, reminderOverride: true },
  });
  if (!appointments.length) return { matched: 0, appointments: 0, dispatches: 0, applied: apply };

  // Versão que lança: falha de banco não pode virar "nenhuma consulta da campanha".
  const matches = await resolveCampaignLeadMatches(tenantId, appointments.map((a) => a.leadId as string), now);
  // Só até o fim da regra (19/11 23:59:59): consulta depois disso segue com os lembretes normais.
  const own = appointments.filter((a) => {
    const match = matches.get(a.leadId as string);
    return match !== undefined && a.startsAt.getTime() <= match.override.endsAt.getTime();
  });
  const toClear = own.filter((a) => {
    const current = parseReminderOverride(a.reminderOverride);
    return !(current !== null && current.length === 0);
  });

  // A chave do disparo é a da consulta local ou a do espelho no Clinicorp.
  const sourceKeys = own.flatMap((a) => [`appointment:${a.id}`, ...(a.clinicorpAppointmentId ? [`clinicorp:${a.clinicorpAppointmentId}`] : [])]);
  const queuedWhere = { tenantId, state: "queued", sourceKey: { in: sourceKeys } };
  const dispatches = sourceKeys.length ? await prisma.reminderDispatch.count({ where: queuedWhere }) : 0;

  if (!apply) return { matched: own.length, appointments: toClear.length, dispatches, applied: false };

  let cleared = 0;
  if (toClear.length) {
    const result = await prisma.appointment.updateMany({
      where: { tenantId, status: "scheduled", id: { in: toClear.map((a) => a.id) } },
      data: { reminderOverride: [] },
    });
    cleared = result.count;
  }
  let skipped = 0;
  if (sourceKeys.length) {
    const result = await prisma.reminderDispatch.updateMany({ where: queuedWhere, data: { state: "skipped", reason: CLEARED_REASON } });
    skipped = result.count;
  }

  // Auditoria só com contagens. Carregada aqui para a simulação não puxar sessão nem Redis.
  const { recordAudit } = await import("@/modules/audit/log");
  await recordAudit({
    event: "campaign_override.reminders_cleared",
    target: { type: "CampaignOverride", id: tenantId },
    meta: { appointments: cleared, dispatches: skipped },
    tenantId,
    actor: actor && actor.ok ? actor.actor : undefined,
  });
  return { matched: own.length, appointments: cleared, dispatches: skipped, applied: true };
}
