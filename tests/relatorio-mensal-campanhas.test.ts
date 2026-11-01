import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { findMany: (...args: unknown[]) => findMany(...args) } } }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { MonthlyReportDocument } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportDocument";
import { loadCampaignRows, type CampaignLeadRow } from "@/modules/campaign-reports/queries";
import { evaluateMonthlyMetrics, type MonthlyInput, type MonthlyReport } from "@/modules/reports/monthly";
import { capEvidence, EVIDENCE_LIMIT } from "@/modules/reports/monthly-evidence";
import { monthlyLimitations } from "@/modules/reports/monthly-limitations";
import { blockingIssues, validateMonthlyReport } from "@/modules/reports/monthly-validate";
import type { MonthlyReportData } from "@/modules/reports/monthly-data";
import { v2Input } from "./fixtures/monthly-report-v2";

const texts = { decisionMaker: "Dr. Rafael Teixeira", operationalContact: "Recepção" };
let seq = 0;
function lead(code: string | null, scheduled = false): CampaignLeadRow {
  seq++;
  return {
    leadId: `lead${seq}`, createdAt: new Date("2026-09-10T12:00:00Z"), status: "new", disqualified: false, disqualifiedReason: null,
    appointments: scheduled ? [{ status: "scheduled" }] : [],
    conversation: { needsHuman: false, lastInboundAt: new Date("2026-09-30T12:00:00Z"), followUpReason: null, handoffEvents: 0 },
    insight: null, origin: code ? { code, name: null, sourceId: `src${code}` } : null,
  };
}
const rows = () => [lead("AD27", true), lead("AD27"), lead("AD37"), lead(null, true), lead(null)];
const withCampaigns = (campaigns: MonthlyInput["campaigns"]): MonthlyInput => ({ ...v2Input(), campaigns });
const FIRST = new Date("2026-01-05T12:00:00Z");

describe("leads por anúncio no relatório mensal", () => {
  it("a soma fecha e AD27 tem os leads certos", () => {
    const { data } = evaluateMonthlyMetrics(withCampaigns({ rows: rows(), trackedSince: FIRST }));
    const c = data.campaigns!;
    expect(c.leads).toBe(5);
    expect(c.adLeads + c.withoutAd).toBe(c.leads);
    expect(c.lines.find((l) => l.label === "AD27")).toMatchObject({ leads: 2, scheduled: 1 });
    expect(c.withoutAd).toBe(2);
    expect(c.withoutAdScheduled).toBe(1);
    expect(c.partialCapture).toBe(false);
    expect(blockingIssues(validateMonthlyReport(data, texts)).map((i) => i.key)).not.toContain("campaigns_sum");
  });

  it("sem leitura, captura nula ou posterior ao mês, ou sem lead de anúncio: o bloco some", () => {
    expect(evaluateMonthlyMetrics(v2Input()).data.campaigns).toBeUndefined();
    expect(evaluateMonthlyMetrics(withCampaigns({ rows: rows(), trackedSince: null })).data.campaigns).toBeUndefined();
    expect(evaluateMonthlyMetrics(withCampaigns({ rows: rows(), trackedSince: new Date("2026-10-02T12:00:00Z") })).data.campaigns).toBeUndefined();
    expect(evaluateMonthlyMetrics(withCampaigns({ rows: [lead(null), lead(null)], trackedSince: FIRST })).data.campaigns).toBeUndefined();
  });

  it("captura iniciada no meio do mês vira limitação calculada", () => {
    const limitationKeys = (trackedSince: Date) => {
      const input = withCampaigns({ rows: rows(), trackedSince });
      const { metrics, data } = evaluateMonthlyMetrics(input);
      return monthlyLimitations({ current: metrics, assumptions: input.config, clinicorpError: null, data } as never).map((l) => l.key);
    };
    expect(evaluateMonthlyMetrics(withCampaigns({ rows: rows(), trackedSince: new Date("2026-09-15T12:00:00Z") })).data.campaigns!.partialCapture).toBe(true);
    expect(limitationKeys(new Date("2026-09-15T12:00:00Z"))).toContain("campaigns");
    expect(limitationKeys(FIRST)).not.toContain("campaigns");
  });

  it("a evidência leva só ids, chave e agendou", () => {
    const { evidence } = evaluateMonthlyMetrics(withCampaigns({ rows: rows(), trackedSince: FIRST }));
    expect(evidence.campaigns).toHaveLength(5);
    expect(Object.keys(evidence.campaigns![0]).sort()).toEqual(["key", "leadId", "scheduled"]);
    const big = { ...evidence, campaigns: Array.from({ length: EVIDENCE_LIMIT + 3 }, (_, i) => ({ leadId: `l${i}`, key: null, scheduled: false })) };
    capEvidence(big);
    expect(big.campaigns).toHaveLength(EVIDENCE_LIMIT);
    expect(big.truncated.campaigns).toBe(EVIDENCE_LIMIT + 3);
  });

  it("o validador bloqueia soma errada e anúncio com mais agendamentos que leads", () => {
    const data = structuredClone(evaluateMonthlyMetrics(withCampaigns({ rows: rows(), trackedSince: FIRST })).data) as MonthlyReportData;
    const keys = (d: MonthlyReportData) => blockingIssues(validateMonthlyReport(d, texts)).map((i) => i.key);
    const wrongSum = structuredClone(data); wrongSum.campaigns!.leads += 1;
    expect(keys(wrongSum)).toContain("campaigns_sum");
    const over = structuredClone(data); over.campaigns!.lines[0].scheduled = over.campaigns!.lines[0].leads + 1;
    expect(keys(over)).toContain("campaigns_scheduled");
  });

  it("snapshot sem campaigns renderiza sem o bloco e o documento mostra o bloco quando existe", () => {
    const render = (input: MonthlyInput) => {
      const { metrics, data } = evaluateMonthlyMetrics(input);
      const r = { version: 1, tenantName: "Clínica", month: "2026-09", label: "setembro de 2026", previousMonth: "2026-08", assumptions: input.config,
        current: metrics, previous: metrics, data, status: "ready", decisionMaker: "Dr. Rafael Teixeira", decisionMakerRole: "partner", operationalContact: "recepção",
        adjustments: "", nextMonth: "", highlights: "", limitationsNote: "", meetingAt: null, sentAt: null, finalizedAt: null, nextActions: [] } as unknown as MonthlyReport;
      return renderToStaticMarkup(createElement(MonthlyReportDocument, { report: r, print: true })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    };
    expect(render(v2Input())).not.toContain("Leads por anúncio");
    const out = render(withCampaigns({ rows: rows(), trackedSince: FIRST }));
    expect(out).toContain("Leads por anúncio");
    expect(out).toContain("Sem anúncio identificado");
    expect(out).toContain("AD27");
  });
});

describe("loadCampaignRows", () => {
  beforeEach(() => findMany.mockReset());
  const dbLead = (createdAt: string) => ({
    id: "l1", createdAt: new Date("2026-09-10T12:00:00Z"), status: "new", disqualifiedAt: null, disqualifiedReason: null,
    appointments: [{ status: "scheduled", createdAt: new Date(createdAt) }], adOrigin: null, conversation: null,
  });
  const range = { from: new Date("2026-09-01T03:00:00Z"), to: new Date("2026-10-01T03:00:00Z") };

  it("aplica o escopo de agentes na consulta", async () => {
    findMany.mockResolvedValue([]);
    await loadCampaignRows("t1", range, { agentIds: ["a1", "a2"] });
    expect(findMany.mock.calls[0][0].where.conversation).toEqual({ isTest: false, agentId: { in: ["a1", "a2"] } });
    await loadCampaignRows("t1", range, { agentIds: [] });
    expect(findMany.mock.calls[1][0].where.conversation).toEqual({ isTest: false });
    expect(findMany.mock.calls[1][0].where.createdAt).toEqual({ gte: range.from, lt: range.to });
  });

  it("ignora agendamento criado depois do fim do mês", async () => {
    findMany.mockResolvedValue([dbLead("2026-10-05T12:00:00Z")]);
    const [after] = await loadCampaignRows("t1", range, { scheduledBefore: range.to });
    expect(after.appointments).toHaveLength(0);
    findMany.mockResolvedValue([dbLead("2026-09-20T12:00:00Z")]);
    const [inside] = await loadCampaignRows("t1", range, { scheduledBefore: range.to });
    expect(inside.appointments).toHaveLength(1);
  });
});
