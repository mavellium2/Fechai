import { prisma } from "@/lib/prisma";
import { median } from "@/modules/reports/monthly-operations";

/**
 * Indicadores do transbordo por pessoa e período (CRM-11), lidos da trilha:
 *
 * - **assumidos:** eventos `handoff.assumed` da pessoa no período (painel,
 *   grupo ou celular);
 * - **mediana até assumir:** dos tempos de espera gravados nesses eventos
 *   (`waitSeconds`; assunção sem espera aberta não entra);
 * - **mediana até a 1ª resposta:** das esperas que a pessoa assumiu no período,
 *   do transbordo até a 1ª resposta humana (`HandoffNotice.firstReplyAt`);
 * - **devolvidos para a IA:** eventos `handoff.returned_to_ai` da pessoa.
 *
 * Quem assumiu sem estar identificado (número não vinculado no grupo, resposta
 * pelo celular sem responsável) fica numa linha própria, e as devoluções
 * automáticas (CRM-12) na linha do Fechai. Só ids e tempos: nenhum dado do contato.
 */

export type HandoffIndicatorRow = {
  key: string;
  name: string;
  assumed: number;
  medianAssumeSeconds: number | null;
  medianFirstReplySeconds: number | null;
  returned: number;
};

const UNIDENTIFIED = "nao-identificado";
const SYSTEM = "fechai";

type Bucket = { assumed: number; waits: number[]; replies: number[]; returned: number };

export async function handoffIndicators(tenantId: string, from: Date, to: Date): Promise<HandoffIndicatorRow[]> {
  const [events, notices, users] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId, createdAt: { gte: from, lt: to }, event: { in: ["handoff.assumed", "handoff.returned_to_ai"] } },
      select: { event: true, actorId: true, actorRole: true, meta: true },
    }),
    prisma.handoffNotice.findMany({
      where: { tenantId, assumedAt: { gte: from, lt: to }, firstReplyAt: { not: null }, conversation: { isTest: false } },
      select: { assignedUserId: true, createdAt: true, firstReplyAt: true },
    }),
    prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true, email: true } }),
  ]);

  const buckets = new Map<string, Bucket>();
  const bucket = (key: string) => {
    let found = buckets.get(key);
    if (!found) buckets.set(key, found = { assumed: 0, waits: [], replies: [], returned: 0 });
    return found;
  };
  const keyOf = (actorId: string | null, actorRole: string) =>
    actorId ?? (actorRole === "SYSTEM" ? SYSTEM : UNIDENTIFIED);

  for (const event of events) {
    const row = bucket(keyOf(event.actorId, event.actorRole));
    if (event.event === "handoff.returned_to_ai") {
      row.returned++;
      continue;
    }
    row.assumed++;
    const meta = event.meta && typeof event.meta === "object" && !Array.isArray(event.meta) ? event.meta as Record<string, unknown> : {};
    if (typeof meta.waitSeconds === "number") row.waits.push(meta.waitSeconds);
  }
  for (const notice of notices) {
    if (!notice.firstReplyAt) continue;
    bucket(notice.assignedUserId ?? UNIDENTIFIED).replies.push(Math.max(0, Math.round((+notice.firstReplyAt - +notice.createdAt) / 1000)));
  }

  const names = new Map(users.map(({ id, name, email }) => [id, name?.trim() || email]));
  const label = (key: string) =>
    key === UNIDENTIFIED ? "Não identificado" : key === SYSTEM ? "Fechai (automático)" : names.get(key) ?? "Pessoa removida";
  return [...buckets.entries()]
    .map(([key, row]) => ({
      key,
      name: label(key),
      assumed: row.assumed,
      medianAssumeSeconds: median(row.waits),
      medianFirstReplySeconds: median(row.replies),
      returned: row.returned,
    }))
    // Pessoas primeiro, por quem mais assumiu; não identificado e automático no fim.
    .sort((a, b) => Number(a.key === UNIDENTIFIED || a.key === SYSTEM) - Number(b.key === UNIDENTIFIED || b.key === SYSTEM)
      || b.assumed - a.assumed || a.name.localeCompare(b.name, "pt-BR"));
}
