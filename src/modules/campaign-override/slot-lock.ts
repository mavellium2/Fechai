import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CampaignRuleError, slotFullProblem } from "@/modules/campaigns/slots";
import type { SlotCheck } from "@/modules/campaigns/slots";
import { dayKeyInZone, timeInZone } from "@/modules/scheduling/time";
import { isOverrideCampaignId } from "./agent";

/**
 * Trava de corrida da vaga da campanha de implantes (só da regra provisória; as
 * `Campaign` reais seguem como no #28).
 *
 * `checkCampaignSlot` conta os agendamentos e `createAppointment` grava depois:
 * dois leads do mesmo horário podiam passar juntos pela contagem e ultrapassar o
 * limite do dia. Aqui contar e gravar acontecem na mesma transação, sob um
 * `pg_advisory_xact_lock` por conta e horário — o segundo espera o primeiro
 * terminar e já enxerga a vaga ocupada. O lock se solta sozinho no commit.
 */

/** A vaga lotou entre a checagem e a gravação. O agente oferece o outro dia. */
export class OverrideSlotFullError extends CampaignRuleError {
  constructor(message: string) {
    super(message);
    this.name = "OverrideSlotFullError";
  }
}

/** A checagem diz que o horário é uma vaga de evento da regra provisória? */
export function overrideSlotCapacity(slot: Pick<SlotCheck, "campaign" | "eventSlot">): number | null {
  if (!slot.eventSlot || !slot.campaign || !isOverrideCampaignId(slot.campaign.campaign.id)) return null;
  return slot.campaign.rules.capacity;
}

/**
 * Roda `work` na transação com o horário travado. Conta de novo (ignorando a
 * própria consulta, na remarcação) e lança `OverrideSlotFullError` se já lotou.
 */
export async function withOverrideSlotLock<T>(
  input: { tenantId: string; startsAt: Date; capacity: number; timezone: string; ignoreAppointmentId?: string },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const key = `${input.tenantId}|${input.startsAt.toISOString()}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const taken = await tx.appointment.count({
      where: {
        tenantId: input.tenantId,
        status: "scheduled",
        startsAt: input.startsAt,
        ...(input.ignoreAppointmentId ? { id: { not: input.ignoreAppointmentId } } : {}),
      },
    });
    if (taken >= input.capacity) {
      throw new OverrideSlotFullError(
        slotFullProblem(dayKeyInZone(input.startsAt, input.timezone), timeInZone(input.startsAt, input.timezone)),
      );
    }
    return work(tx);
  });
}
