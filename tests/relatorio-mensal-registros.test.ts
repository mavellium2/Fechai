import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const leadFindMany = vi.fn();
vi.mock("@/modules/lead-insights/historical-city-store", () => ({ loadHistoricalCities: vi.fn(async () => new Map()) }));
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { findMany: (...args: unknown[]) => leadFindMany(...args) },
  reportEvent: { findMany: async () => [] }, reminderDispatch: { findMany: async () => [] }, broadcastRecipient: { findMany: async () => [] } } }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
vi.mock("@/modules/lead-insights/service-area-store", () => ({ getServiceArea: vi.fn(async () => ({ baseCity: "Marília", cities: [] })) }));
import { PDFDocument } from "pdf-lib";
import type { ClinicorpReportData } from "@/modules/scheduling/clinicorp";
import { evaluateMonthlyMetrics, type MonthlyAppointment } from "@/modules/reports/monthly";
import { capEvidence, emptyEvidence, EVIDENCE_LIMIT, isScheduledCounted } from "@/modules/reports/monthly-evidence";
import { monthlyQuality } from "@/modules/reports/monthly-quality";
import { applyMonthlyOverrides } from "@/modules/reports/monthly-overrides";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { loadLeadQualityDetail } from "@/modules/lead-insights/queries";
import { MonthlyView } from "@/app/(dashboard)/relatorios/MonthlyView";
import { roiAppointment, roiConversation, roiFixture, roiInput } from "./fixtures/monthly-roi";

const total = (s: { inside: number; outside: number; unclassified: number }) => s.inside + s.outside + s.unclassified;

describe("registros por trás de cada número", () => {
  it("cada lista soma exatamente o número do relatório", () => {
    const input = roiInput();
    input.conversations.push(roiConversation("inside", "2026-09-15T15:00:00Z"));
    // Só a equipe respondeu: aparece na lista, fora da conta.
    input.conversations.push({ ...roiConversation("human"), messages: [
      { id: "human-in", role: "user", sentBy: null, createdAt: new Date("2026-09-16T12:00:00Z") },
      { id: "human-reply", role: "assistant", sentBy: "human", createdAt: new Date("2026-09-16T12:05:00Z") }] });
    const { metrics: m, evidence: e } = evaluateMonthlyMetrics(input);
    expect(e.conversations.filter((c) => c.counted)).toHaveLength(total(m.conversations));
    expect(e.conversations.find((c) => c.conversationId === "human")).toMatchObject({ counted: false, excluded: "human_only" });
    expect(e.conversations.filter((c) => c.counted && c.newContact)).toHaveLength(m.newContacts);
    expect(e.responses).toHaveLength(3);
    expect(e.responses.reduce((s, r) => s + r.seconds, 0) / e.responses.length).toBeCloseTo(m.firstResponseSeconds!);
    expect(e.appointments.filter((a) => a.createdInMonth && isScheduledCounted(a))).toHaveLength(total(m.scheduled));
    expect(e.appointments.filter((a) => a.attended === "attended")).toHaveLength(total(m.attended));
    expect(e.messages.filter((x) => x.kind === "text")).toHaveLength(m.time!.textMessages);
    expect(e.messagesExcluded.humanFirst).toBe(1);
    expect(e.hours.reduce((s, n) => s + n, 0)).toBe(3);
    expect(e.events).toEqual([expect.objectContaining({ kind: "qualified", conversationId: "outside", procedure: "Implante" })]);
  });

  it("explica 10 agendamentos: 1 sem horário, 8 sem tipo e 1 cancelado", () => {
    const input = roiInput();
    input.conversations[0].firstInbound = null;
    const untyped = (i: number): MonthlyAppointment => ({ ...roiAppointment(`untyped-${i}`), serviceType: null });
    input.appointments = [roiAppointment("counted"), ...Array.from({ length: 8 }, (_, i) => untyped(i)), { ...roiAppointment("canceled"), status: "canceled" }];
    const { metrics: m, evidence: e } = evaluateMonthlyMetrics(input);
    expect(m.scheduled).toEqual({ inside: 0, outside: 0, unclassified: 1 });
    expect(m.untypedAppointments).toBe(8);
    const created = e.appointments.filter((a) => a.createdInMonth);
    expect(created).toHaveLength(10);
    expect(created.filter((a) => a.scheduled === "untyped")).toHaveLength(8);
    expect(created.find((a) => a.appointmentId === "canceled")?.scheduled).toBe("canceled");
    expect(created.find((a) => a.appointmentId === "counted")).toMatchObject({ scheduled: "counted", bucket: "unclassified", arrivalAt: null });
    const q = monthlyQuality({ ...roiFixture(), current: m, automatic: { current: m, previous: m }, evidence: e });
    expect(q.scheduled?.status).toBe("partial");
    expect(q.scheduled?.reasons.join(" ")).toMatch(/1 avaliação agendada sem horário.*8 agendamentos sem tipo/);
  });

  it("marca comparecimento pendente, futuro e cancelado no Clinicorp com o motivo", () => {
    const input = roiInput();
    input.now = new Date("2026-09-20T12:00:00Z");
    input.appointments = [
      { ...roiAppointment("pending"), status: "scheduled" },
      { ...roiAppointment("future"), startsAt: new Date("2026-09-25T15:00:00Z") },
      { ...roiAppointment("external"), clinicorpAppointmentId: "99" },
    ];
    const clinicorp: ClinicorpReportData = { available: true, error: null, appointments: [{ id: "99", statusType: null, canceled: true }], statusTypes: [] };
    const { metrics: m, evidence: e } = evaluateMonthlyMetrics({ ...input, clinicorp });
    expect(m.attendanceUnknown).toBe(1);
    expect(Object.fromEntries(e.appointments.map((a) => [a.appointmentId, a.attended]))).toEqual({ pending: "unknown", future: "future", external: "canceled_external" });
  });

  it("corta listas enormes, mas anota o total real", () => {
    const e = emptyEvidence();
    e.messages = Array.from({ length: EVIDENCE_LIMIT + 7 }, (_, i) => ({ messageId: String(i), conversationId: "c", at: "", kind: "text" as const, seconds: null }));
    capEvidence(e);
    expect(e.messages).toHaveLength(EVIDENCE_LIMIT);
    expect(e.truncated.messages).toBe(EVIDENCE_LIMIT + 7);
  });
});

describe("selo de qualidade", () => {
  it("contagem conferida é verificada; dinheiro é estimado", () => {
    const q = roiFixture().quality!;
    expect(q.newContacts?.status).toBe("verified");
    expect(q.attended?.status).toBe("verified");
    expect(q.revenue?.status).toBe("estimated");
    expect(q.roi?.status).toBe("estimated");
    expect(q.assumedHours?.status).toBe("estimated");
  });
  it("correção manual que os registros não sustentam é inconsistente; igual ao registro, não", () => {
    const r = roiFixture();
    const other = { ...r, current: applyMonthlyOverrides(r.automatic!.current, { newContacts: 10 }, r.assumptions) };
    expect(monthlyQuality(other).newContacts).toMatchObject({ status: "inconsistent", reasons: expect.arrayContaining([expect.stringContaining("ajustado manualmente para 10; os registros somam 1")]) });
    const same = { ...r, current: applyMonthlyOverrides(r.automatic!.current, { newContacts: 1 }, r.assumptions) };
    expect(monthlyQuality(same).newContacts?.status).toBe("verified");
  });
  it("sem expediente é pendente; sem cobertura histórica é parcial; soma por procedimento errada é inconsistente", () => {
    const r = roiFixture();
    const noHours = { ...r, assumptions: { ...r.assumptions, humanHours: null } };
    expect(monthlyQuality(noHours).conversations?.status).toBe("pending");
    const partial = { ...r, current: { ...r.current, trackingComplete: false } };
    expect(monthlyQuality(partial).qualified?.status).toBe("partial");
    const wrong = { ...r, current: applyMonthlyOverrides(r.automatic!.current, { procedures: [{ name: "Implante", qualified: 1, attendedOutside: 3 }] }, r.assumptions) };
    expect(monthlyQuality(wrong).attended?.status).toBe("inconsistent");
    expect(monthlyQuality(wrong).revenue?.status).toBe("pending");
  });
});

describe("painel e PDF", () => {
  const render = (report: ReturnType<typeof roiFixture>) => renderToStaticMarkup(createElement(MonthlyView, { report }));
  it("mostra o selo e o acesso aos registros de cada indicador", () => {
    const html = render(roiFixture());
    // Número medido não leva selo; "estimativa" só no que é estimado.
    expect(html).toContain("Selo");
    expect(html).not.toContain("Verificado");
    expect(html).toContain("Estimativa");
    expect(html).toContain("Ver registros (1)");
    expect(html).toContain("Ver cálculo");
  });
  it("relatório fechado antes do detalhamento não mostra selo nem registros", async () => {
    const report = roiFixture(); delete report.quality; delete report.evidence;
    const html = render(report);
    expect(html).not.toContain("Ver registros"); expect(html).not.toContain("Verificado");
    expect((await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount()).toBeGreaterThanOrEqual(2);
  });
});

describe("leads do mês, um a um", () => {
  it("devolve o registro de cada lead com o mesmo resultado do agregado, sem dado pessoal", async () => {
    const now = new Date("2026-09-30T12:00:00Z");
    const messages = [{ role: "user", sentBy: null, createdAt: new Date("2026-09-10T12:00:00Z") },
      { role: "assistant", sentBy: "agent", createdAt: new Date("2026-09-10T12:00:30Z") }];
    const lead = (id: string, extra: object) => ({ id, createdAt: new Date("2026-09-10T12:00:00Z"), status: "new", disqualifiedAt: null, disqualifiedReason: null,
      appointments: [], conversation: { id: `c-${id}`, needsHuman: false, lastInboundAt: new Date("2026-09-29T12:00:00Z"), followUpReason: null, reportEvents: [],
        insight: null, messages }, ...extra });
    leadFindMany.mockResolvedValueOnce([
      lead("a", { appointments: [evaluation()] }),
      lead("b", { conversation: { id: "c-b", messages, needsHuman: false, lastInboundAt: null, followUpReason: null, reportEvents: [], insight: { city: "Garça", cityKey: "garca", firstQuestionKey: "preco", lossReasonKey: null } } }),
    ]);
    const { quality, leads } = await loadLeadQualityDetail("t1", { from: null, to: now }, { now });
    expect(leads).toHaveLength(quality.leads);
    expect(leads.map((l) => l.outcome)).toEqual(["scheduled", "lost"]);
    expect(leads[1]).toEqual({ leadId: "b", conversationId: "c-b", createdAt: "2026-09-10T12:00:00.000Z", city: "Garça", verdict: "out", outcome: "lost", lossKey: "sumiu", doubtKey: "preco" });
    expect(Object.keys(leadFindMany.mock.calls[0][0].select)).not.toContain("name");
  });

  it("agendou é a avaliação do agente criada no período, como na coorte do mensal", async () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const range = { from: new Date("2026-09-01T03:00:00Z"), to: new Date("2026-10-01T03:00:00Z") };
    const messages = [{ role: "user", sentBy: null, createdAt: new Date("2026-09-10T12:00:00Z") },
      { role: "assistant", sentBy: "agent", createdAt: new Date("2026-09-10T12:00:30Z") }];
    const lead = (id: string, appointments: object[]) => ({ id, createdAt: new Date("2026-09-10T12:00:00Z"), status: "new", disqualifiedAt: null, disqualifiedReason: null,
      appointments, conversation: { id: `c-${id}`, needsHuman: false, lastInboundAt: new Date("2026-09-10T12:00:00Z"), followUpReason: null, reportEvents: [], insight: null, messages } });
    leadFindMany.mockResolvedValueOnce([
      lead("agent", [evaluation()]),
      lead("later", [evaluation({ createdAt: new Date("2026-10-05T12:00:00Z") })]),
      lead("before", [evaluation({ createdAt: new Date("2026-08-20T12:00:00Z") })]),
      lead("team", [evaluation({ source: "manual" })]),
      lead("treatment", [evaluation({ kind: "treatment" })]),
      lead("canceled", [evaluation({ status: "canceled" })]),
    ]);
    const { leads } = await loadLeadQualityDetail("t1", range, { now });
    expect(leads.filter((l) => l.outcome === "scheduled").map((l) => l.leadId)).toEqual(["agent"]);
  });
});

function evaluation(extra: object = {}) {
  return { status: "scheduled", createdAt: new Date("2026-09-10T12:05:00Z"), source: "agent", agentId: "a", kind: "evaluation", serviceType: null, ...extra };
}
