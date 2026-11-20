/** Read-only reconciliation. Run where DATABASE_URL is already configured. */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computePeriodReport } from "../src/modules/reports/service";
import { computeMonthlyReport } from "../src/modules/reports/monthly";
import { monthlyWindow } from "../src/modules/reports/monthly-config";
import { loadLeadQualityDetail } from "../src/modules/lead-insights/queries";

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => args[args.indexOf(name) + 1];
  const tenantId = args.includes("--tenant") ? arg("--tenant") : null;
  const month = args.includes("--month") ? arg("--month") : null;
  if (!tenantId || !month || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Uso: npx tsx scripts/audit-report-metrics.ts --tenant ID --month 2026-09");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está configurada neste ambiente.");
  const monthly = await computeMonthlyReport(tenantId, month, false);
  const config = monthly.assumptions;
  const window = monthlyWindow(month, config.timezone);
  const range = { from: window.start, to: new Date(+window.end - 1), label: month, bucket: "dia" as const, prevFrom: null, prevTo: null };
  const [operational, quality, approved] = await Promise.all([
    computePeriodReport(tenantId, range, { assumptions: config, agentIds: config.agentIds ?? undefined }),
    loadLeadQualityDetail(tenantId, { from: window.start, to: window.end }, { agentIds: config.agentIds ?? undefined }),
    prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true, snapshot: true } }),
  ]);
  const d = monthly.data!;
  const checks = {
    attended: { operational: operational.kpis.attendedContacts, monthly: d.service.contacts.total.value, quality: quality.quality.leads },
    evaluations: { operational: operational.kpis.evaluations, monthly: d.schedule.cohort.total.total.value },
    aiOnly: { operational: operational.attendance.reduce((n, row) => n + row.ai, 0), monthly: d.service.aiOnly.value },
    transferred: { operational: operational.attendance.reduce((n, row) => n + row.human, 0), monthly: d.service.transferred.value },
    city: { quality: quality.quality.withCity, monthly: d.leads.withCity.value },
    contextAttended: { operational: operational.contexts.attended, monthly: d.service.contexts?.attended ?? null },
    contextBase: { operational: operational.contexts.active, monthly: d.service.contexts?.active ?? null },
    contextEvaluations: { operational: operational.contexts.attributedEvaluations, monthly: d.service.contexts?.attributedEvaluations ?? null },
    // O gráfico IA × humano usa só conversas iniciadas pelo paciente (base da autonomia).
    attendanceChart: { chart: operational.attendance.reduce((n, row) => n + row.ai + row.human, 0), base: operational.contexts.autonomy?.base ?? null },
    autonomyBase: { operational: operational.contexts.autonomy?.base ?? null, monthly: d.service.contexts?.autonomy?.base ?? null },
    autonomyAiOnly: { operational: operational.contexts.autonomy?.aiOnly ?? null, monthly: d.service.contexts?.autonomy?.aiOnly ?? null },
    leadsSide: { leads: operational.kpis.leads, parts: operational.leadReconciliation.newAttended + operational.leadReconciliation.unanswered
      + operational.leadReconciliation.noReply + operational.leadReconciliation.noMessages },
    attendedSide: { attended: operational.kpis.attendedContacts, parts: operational.leadReconciliation.newAttended + operational.leadReconciliation.existingAttended },
    appointmentsChart: { chart: operational.closed.reduce((n, row) => n + row.ai + row.human, 0), kpi: operational.kpis.scheduled },
  };
  const inconsistent = Object.entries(checks).filter(([, values]) => new Set(Object.values(values)).size > 1).map(([name]) => name);
  // Only aggregate numbers and report metadata; never messages, lead names or phone numbers.
  const snapshot = approved?.snapshot as { data?: typeof d } | null;
  // Quem iniciou × quem resolveu, por contexto: só contagens.
  const initiators = operational.contexts.groups.filter((g) => g.contacts > 0)
    .map((g) => ({ context: g.key, contacts: g.contacts, attended: g.attended, aiOnly: g.aiOnly, aiAndHuman: g.aiAndHuman, humanOnly: g.humanOnly }));
  console.log(JSON.stringify({ tenantId, month, agentIds: config.agentIds, timezone: config.timezone,
    source: "live", operational: operational.kpis, autonomy: operational.contexts.autonomy, initiators,
    leadReconciliation: operational.leadReconciliation, checks, inconsistent,
    recognizedHistoricalCities: quality.leads.filter((lead) => lead.cityMessageId).length,
    approved: approved?.status === "ready" ? { source: "frozen-snapshot", contacts: snapshot?.data?.service.contacts.total.value,
      evaluations: snapshot?.data?.schedule.cohort.total.total.value, withCity: snapshot?.data?.leads.withCity.value } : null,
  }, null, 2));
  if (inconsistent.length) process.exitCode = 2;
}
main().catch((error: unknown) => {
  const text = error instanceof Error && (error.message.startsWith("Uso:") || error.message.startsWith("DATABASE_URL"))
    ? error.message : "Não foi possível conferir o banco. Verifique a configuração no ambiente autorizado.";
  console.error(text); process.exitCode = 1;
}).finally(() => prisma.$disconnect());
