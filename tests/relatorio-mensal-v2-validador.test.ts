import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { evaluateMonthlyMetrics } from "@/modules/reports/monthly";
import type { MonthlyReportData } from "@/modules/reports/monthly-data";
import { blockingIssues, validateMonthlyReport } from "@/modules/reports/monthly-validate";
import { buildPendencyBoard } from "@/modules/reports/monthly-pendencies";
import { monthlyLimitations } from "@/modules/reports/monthly-limitations";
import { v2Input } from "./fixtures/monthly-report-v2";

const texts = { decisionMaker: "Dr. Rafael Teixeira", operationalContact: "Recepção" };
const fresh = () => structuredClone(evaluateMonthlyMetrics(v2Input()).data);
const keys = (data: MonthlyReportData, t = texts) => blockingIssues(validateMonthlyReport(data, t)).map((i) => i.key);

describe("validador do relatório mensal v2 - bloqueantes", () => {
  it("a fixture de aceite fecha sem bloqueio", () => expect(keys(fresh())).toEqual([]));
  it("só agente + transferidas ≠ contatos", () => {
    const d = fresh(); d.service.aiOnly.value = 150;
    // O número adulterado também deixa de bater com a divisão por contexto.
    expect(keys(d)).toEqual(["autonomy_sum", "service_sum"]);
  });
  it("só IA, IA + humano e só humano precisam fechar com os atendidos e a base do paciente", () => {
    const d = fresh();
    expect(d.service.contexts?.autonomy).toBeDefined();
    d.service.contexts!.autonomy!.percent = 99;
    expect(keys(d)).toEqual(["autonomy_sum"]);
    const g = fresh(); const group = g.service.contexts!.groups.find((x) => x.attended > 0)!;
    group.humanOnly = (group.humanOnly ?? 0) + 1;
    expect(keys(g)).toContain("autonomy_sum");
    const old = fresh(); delete old.service.contexts!.autonomy;
    expect(keys(old)).toEqual([]);
  });
  it("total da coorte ≠ compareceram + faltaram + aguardando + não verificado", () => {
    const d = fresh(); d.schedule.cohort.no_show.total.value = 9;
    expect(keys(d)).toContain("cohort_sum");
  });
  it("expediente + fora ≠ total em qualquer quebra", () => {
    const d = fresh(); d.schedule.qualified.inside.value = 50;
    expect(keys(d)).toEqual(["split_sum"]);
    const noHours = fresh(); noHours.service.contacts.inside.value = null; noHours.service.contacts.outside.value = null;
    expect(keys(noHours)).toEqual([]);
  });
  it("soma dos motivos ≠ contatos − agendaram", () => {
    const d = fresh(); d.leads.reasons[0].contacts = 100;
    expect(keys(d)).toEqual(["reasons_sum"]);
  });
  it("decisor ausente ou igual ao contato operacional (D7)", () => {
    expect(keys(fresh(), { decisionMaker: " ", operationalContact: "Recepção" })).toEqual(["decision_maker"]);
    expect(keys(fresh(), { decisionMaker: "Ana Lúcia", operationalContact: "ana lucia" })).toEqual(["decision_maker"]);
    expect(keys(fresh(), { decisionMaker: "Ana Lúcia", operationalContact: "" })).toEqual([]);
  });
});

describe("validador do relatório mensal v2 - avisos e pendências", () => {
  const warnings = (data: MonthlyReportData) => validateMonthlyReport(data, texts).filter((i) => i.severity === "warning").map((i) => i.key);
  it("a fixture avisa só o que os dados mostram", () => {
    expect(warnings(fresh())).toEqual(["reception", "attendance"]);
  });
  it("qualificados abaixo dos agendados, transbordo sem registro, resposta lenta e cidade com pouca cobertura", () => {
    const d = fresh();
    d.schedule.qualified.total.status = "partial";
    d.service.handoffEvents.value = 0;
    d.service.agentFirstResponseSeconds.value = 6494;
    d.leads.withCity.status = "partial";
    expect(warnings(d)).toEqual(expect.arrayContaining(["qualification", "handoff", "agent_response", "city"]));
  });
  it("falta de ticket, conversão ou custo da equipe não é problema nem limitação (D4)", () => {
    const input = v2Input();
    input.config.procedures = []; input.config.attendantMonthlyCents = null;
    const { metrics, data } = evaluateMonthlyMetrics(input);
    expect(data.estimatedReturn).toBeNull();
    expect(validateMonthlyReport(data, texts).some((i) => /ticket|custo/i.test(i.message))).toBe(false);
    const limits = monthlyLimitations({ current: metrics, assumptions: input.config, clinicorpError: null, data });
    expect(limits.map((l) => l.key)).not.toEqual(expect.arrayContaining(["ticket", "team"]));
    const rows = buildPendencyBoard({ metrics, config: input.config, monthName: "setembro", tracking: [], data });
    expect(rows.filter((r) => r.optional).map((r) => r.topic).sort()).toEqual(["consistency", "team", "ticket"]);
    expect(rows.find((r) => r.topic === "team")?.status).not.toBe("confirmed");
  });
  it("os avisos do motor viram tópicos da central", () => {
    const input = v2Input();
    input.events = input.events.filter((e) => e.kind !== "qualified" && e.kind !== "handoff");
    const { metrics, data } = evaluateMonthlyMetrics(input);
    const rows = buildPendencyBoard({ metrics, config: input.config, monthName: "setembro", tracking: [], data });
    expect(rows.find((r) => r.topic === "qualification")).toMatchObject({ ownerLabel: "Mavellium", status: "check" });
    expect(rows.find((r) => r.topic === "handoff")?.details[0]).toContain("55 conversas");
    expect(rows.find((r) => r.topic === "city")?.status).toBe("confirmed");
    // Sem o relatório v2 (mês antigo), os tópicos novos nem aparecem.
    expect(buildPendencyBoard({ metrics, config: input.config, monthName: "setembro", tracking: [] }).some((r) => r.topic === "qualification")).toBe(false);
  });
});
