import { prisma } from "@/lib/prisma";
import { partsInZone } from "@/modules/scheduling/time";
import { EMPTY_ASSUMPTIONS, monthlyWindow, parseMonthlyAssumptions, type MonthlyAssumptions } from "./monthly-config";
import { evaluationOf } from "./monthly-data";

const PANEL_TIME_ZONE = "America/Sao_Paulo";

/**
 * A revisão de onde um mês sem revisão própria herda as premissas: a do último
 * mês revisado antes dele. É a única regra de herança — o mensal e o painel
 * usam esta função, senão o mesmo mês contaria avaliações com tipos diferentes
 * (outubro sem revisão saía com as premissas vazias no painel e com as de
 * setembro no mensal: 23 × 24 avaliações).
 */
export function latestRevisionBefore(tenantId: string, month: string) {
  return prisma.monthlyRoiReport.findFirst({
    where: { tenantId, month: { lt: month } }, orderBy: { month: "desc" },
    select: { month: true, assumptions: true },
  });
}

/**
 * Premissas do recorte do painel. Uma competência inteira usa as do relatório
 * mensal (a revisão do mês ou a herdada); qualquer outro recorte usa as padrão.
 */
export async function periodAssumptions(tenantId: string, from: Date | null, toExcl: Date): Promise<MonthlyAssumptions> {
  if (!from) return EMPTY_ASSUMPTIONS;
  const p = partsInZone(from, PANEL_TIME_ZONE);
  const month = `${p.year}-${String(p.month).padStart(2, "0")}`;
  const window = monthlyWindow(month, PANEL_TIME_ZONE);
  if (+from !== +window.start || +toExcl !== +window.end) return EMPTY_ASSUMPTIONS;
  const revision = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { assumptions: true } });
  const raw = revision?.assumptions ?? (await latestRevisionBefore(tenantId, month))?.assumptions ?? EMPTY_ASSUMPTIONS;
  return parseMonthlyAssumptions(raw);
}

/** Avaliação marcada pelo agente, pelas premissas: a regra da coorte do mensal. */
export function isAgentEvaluation(a: { source: string; agentId: string | null; kind: string | null; serviceType: string | null }, config: MonthlyAssumptions) {
  return a.source === "agent" && (!config.agentIds?.length || Boolean(a.agentId && config.agentIds.includes(a.agentId))) && evaluationOf(a, config).evaluation;
}
