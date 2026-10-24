import { prisma } from "@/lib/prisma";
import { checkIcloudCalendar } from "./icloud";

/**
 * Monitor de saúde do Calendário da Apple (roda no worker, depois do envio).
 *
 * A senha de app pode ser revogada, e o calendário apagado, sem ninguém avisar o
 * fechai. Sem esta checagem a pessoa só descobriria quando um horário deixasse
 * de chegar ao iPhone (ou o agente parasse de oferecer horário). Uma ida barata à
 * Apple a cada 30 minutos por conta traz o aviso para a tela antes disso.
 *
 * Nunca lança, nunca loga credencial: só contagens.
 */

export const HEALTH_EVERY_MS = 30 * 60_000;
/** Teto por rodada: a Apple não documenta o ritmo que tolera, e a fila roda a cada minuto. */
const MAX_PER_ROUND = 20;

export type IcloudHealthScan = { checked: number; ok: number; revoked: number; calendarMissing: number; unreachable: number };

export async function scanIcloudHealth(now = new Date()): Promise<IcloudHealthScan> {
  const result: IcloudHealthScan = { checked: 0, ok: 0, revoked: 0, calendarMissing: 0, unreachable: 0 };
  try {
    const accounts = await prisma.icloudCalendarIntegration.findMany({
      where: {
        authFailedAt: null,
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: new Date(now.getTime() - HEALTH_EVERY_MS) } }],
        tenant: { status: "active", calendarFeatures: { icloudEnabled: true } },
      },
      select: { tenantId: true },
      orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
      take: MAX_PER_ROUND,
    });

    for (const { tenantId } of accounts) {
      // Marca antes: uma Apple lenta não faz a mesma conta ser checada de novo na rodada seguinte.
      await prisma.icloudCalendarIntegration.update({ where: { tenantId }, data: { lastCheckedAt: now } }).catch(() => {});
      const health = await checkIcloudCalendar(tenantId);
      if (health === "skipped") continue;
      result.checked++;
      if (health === "ok") result.ok++;
      else if (health === "auth") result.revoked++;
      else if (health === "calendar") result.calendarMissing++;
      else result.unreachable++;
    }
  } catch (err) {
    console.error("[icloud] monitor de saúde falhou", err instanceof Error ? err.name : "erro");
  }
  return result;
}
