import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Satisfação no relatório mensal. O que está protegido aqui:
 *
 * - média de uma casa, distribuição que soma as respostas, top 3 só com as
 *   chaves do conjunto fechado e comentários sem motivo contados à parte;
 * - a coorte (nota pelo mês da nota, envio pelo mês do envio) e o escopo de agentes;
 * - o validador bloqueia o fechamento quando a soma ou o top 3 não fecham;
 * - o texto do comentário nunca chega a `data`, à evidência nem ao PDF;
 * - o PDF mostra a média só com 5 ou mais respostas, e o bloco some sem respostas
 *   ou em snapshot anterior à pesquisa.
 */

const db = vi.hoisted(() => ({ satisfactionSurvey: { findMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));

import { MonthlyReportDocument } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportDocument";
import { evaluateMonthlyMetrics, type MonthlyInput, type MonthlyReport, type MonthlySurvey } from "@/modules/reports/monthly";
import { loadMonthlySurveys } from "@/modules/reports/monthly-satisfaction";
import { satisfactionLines } from "@/modules/reports/monthly-executive";
import { allowedNumbers, unknownNumbers } from "@/modules/reports/monthly-text-guard";
import { blockingIssues, validateMonthlyReport } from "@/modules/reports/monthly-validate";
import type { MonthlyReportData } from "@/modules/reports/monthly-data";
import { local, v2Input } from "./fixtures/monthly-report-v2";

const texts = { decisionMaker: "Dr. Rafael Teixeira", operationalContact: "Recepção" };
let n = 0;
function survey(rating: number | null, over: Partial<MonthlySurvey> = {}): MonthlySurvey {
  n++;
  return {
    id: `s${n}`, agentId: "agent-1", conversationId: `c${String(n).padStart(3, "0")}`, sentAt: local(10, 10), ratedAt: rating === null ? null : local(10, 12),
    rating, topics: [], hasComment: false, classified: true, ...over,
  };
}
const withSurveys = (surveys: MonthlySurvey[], over: Partial<MonthlyInput> = {}): MonthlyInput => ({ ...v2Input(), surveys, ...over });
const dataOf = (input: MonthlyInput) => evaluateMonthlyMetrics(input).data;

/** Dez respostas: 5,5,5,4,4,4,3,2,1,5 → média 3,8; cinco enviadas sem resposta. */
function tenAnswers(): MonthlySurvey[] {
  return [
    survey(5), survey(5), survey(5), survey(5),
    survey(4, { topics: ["preco"], hasComment: true }), survey(4, { topics: ["demora"], hasComment: true }), survey(4),
    survey(3, { topics: ["demora", "tom_robotico"], hasComment: true }),
    survey(2, { topics: ["nao_entendeu"], hasComment: true }),
    survey(1, { topics: ["demora"], hasComment: true }),
    ...Array.from({ length: 5 }, () => survey(null)),
  ];
}

beforeEach(() => {
  n = 0;
  db.satisfactionSurvey.findMany.mockReset();
});

describe("números do mês", () => {
  it("média de uma casa, distribuição que soma as respostas e taxa de resposta", () => {
    const sat = dataOf(withSurveys(tenAnswers())).satisfaction!;
    expect(sat.sent).toBe(15);
    expect(sat.answered).toBe(10);
    expect(sat.average.value).toBe(3.8);
    expect(sat.distribution).toEqual([1, 1, 1, 3, 4]);
    expect(sat.distribution.reduce((a, b) => a + b, 0)).toBe(sat.answered);
    expect(sat.responseRatePercent).toBe(67);
    expect(sat.smallSample).toBe(false);
  });

  it("top 3 por contagem de chaves do conjunto fechado, sem texto", () => {
    const sat = dataOf(withSurveys(tenAnswers())).satisfaction!;
    expect(sat.improvementTopics).toEqual([
      { key: "demora", label: "Demora no atendimento", count: 3 },
      { key: "nao_entendeu", label: "O agente não entendeu", count: 1 },
      { key: "preco", label: "Preço", count: 1 },
    ]);
  });

  it("comentário ainda sem motivo é contado à parte", () => {
    const sat = dataOf(withSurveys([survey(2, { hasComment: true, classified: false }), survey(5)])).satisfaction!;
    expect(sat.unclassified).toBe(1);
    expect(sat.withComment).toBe(1);
    expect(sat.improvementTopics).toEqual([]);
  });

  it("a nota conta pelo mês da nota; o envio, pelo mês do envio", () => {
    const august = local(20, 12, 0, 0, 8);
    const sat = dataOf(withSurveys([
      survey(5, { sentAt: august, ratedAt: local(1, 9, 0, 0, 9) }), // enviada em agosto, respondida em setembro: nota entra, envio não
      survey(1, { sentAt: local(30, 10), ratedAt: local(2, 9, 0, 0, 10) }), // respondida em outubro: fora
      survey(null, { sentAt: local(12, 10) }),
    ])).satisfaction!;
    expect(sat.sent).toBe(2);
    expect(sat.answered).toBe(1);
    expect(sat.average.value).toBe(5);
    expect(sat.responseRatePercent).toBe(50);
  });

  it("respeita o escopo de agentes da revisão", () => {
    const input = withSurveys([survey(5, { agentId: "agent-1" }), survey(1, { agentId: "agent-2" })]);
    input.config.agentIds = ["agent-1"];
    const sat = dataOf(input).satisfaction!;
    expect(sat.answered).toBe(1);
    expect(sat.average.value).toBe(5);
  });

  it("sem envio e sem resposta no mês, ou sem leitura, o bloco não existe", () => {
    expect(dataOf(withSurveys([])).satisfaction).toBeUndefined();
    expect(dataOf(v2Input()).satisfaction).toBeUndefined();
  });

  it("a evidência leva só ids, nota e chaves", () => {
    const { evidence } = evaluateMonthlyMetrics(withSurveys(tenAnswers()));
    expect(evidence.surveys).toHaveLength(10);
    expect(Object.keys(evidence.surveys![0]).sort()).toEqual(["conversationId", "rating", "surveyId", "topics"]);
  });
});

describe("validador", () => {
  const keys = (data: MonthlyReportData) => blockingIssues(validateMonthlyReport(data, texts)).map((i) => i.key);
  const fresh = () => structuredClone(dataOf(withSurveys(tenAnswers())));

  it("fecha sem bloqueio quando os números batem", () => {
    expect(keys(fresh())).toEqual([]);
  });

  it("distribuição que não soma as respondidas bloqueia", () => {
    const d = fresh();
    d.satisfaction!.distribution[4] = 9;
    expect(keys(d)).toContain("satisfaction_sum");
  });

  it("média que não bate com a distribuição bloqueia", () => {
    const d = fresh();
    d.satisfaction!.average.value = 4.9;
    expect(keys(d)).toContain("satisfaction_average");
  });

  it("top 3 com chave fora do conjunto fechado, maior que as respostas ou fora de ordem bloqueia", () => {
    const outside = fresh();
    outside.satisfaction!.improvementTopics[0].key = "chave_inventada";
    expect(keys(outside)).toContain("satisfaction_topics");
    const tooMany = fresh();
    tooMany.satisfaction!.improvementTopics[0].count = 99;
    expect(keys(tooMany)).toContain("satisfaction_topics");
    const unordered = fresh();
    unordered.satisfaction!.improvementTopics[1].count = 3;
    unordered.satisfaction!.improvementTopics[0].count = 2;
    expect(keys(unordered)).toContain("satisfaction_topics");
  });

  it("o resumo pode citar a média e as respostas, mas não um número inventado", () => {
    const d = fresh();
    const allowed = allowedNumbers(d, { month: "2026-09", previousMonth: "2026-08" });
    expect(unknownNumbers("Nota média 3,8 em 10 respostas.", allowed)).toEqual([]);
    expect(unknownNumbers("Nota média 4,7 em 10 respostas.", allowed)).toEqual(["4,7"]);
  });
});

describe("texto do comentário nunca entra", () => {
  it("a leitura do mês descarta o texto e mantém só o booleano", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", agentId: "a", conversationId: "c1", sentAt: local(1, 9), ratedAt: local(1, 10), rating: 2, topics: ["demora"],
        comment: "A Maria Souza (11 98765-4321) demorou demais", classifiedAt: new Date() },
      { id: "s2", agentId: "a", conversationId: "c2", sentAt: local(1, 9), ratedAt: null, rating: null, topics: [], comment: "   ", classifiedAt: null },
    ]);
    const rows = await loadMonthlySurveys("tenant-1", local(1, 0), local(30, 23));
    expect(JSON.stringify(rows)).not.toContain("Maria");
    expect(JSON.stringify(rows)).not.toContain("98765");
    expect(rows.map((r) => r.hasComment)).toEqual([true, false]);
    // Sem testes e sempre pela conta.
    const where = (db.satisfactionSurvey.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ tenantId: "tenant-1", isTest: false });
    // O texto também não é consultado para outro fim: só a verificação de vazio.
    expect(Object.keys((db.satisfactionSurvey.findMany.mock.calls[0][0] as { select: object }).select)).toContain("comment");
  });

  it("dados, evidência e frases do relatório não carregam texto de contato", () => {
    const { data, evidence } = evaluateMonthlyMetrics(withSurveys(tenAnswers()));
    const serialized = JSON.stringify({ data: data.satisfaction, evidence: evidence.surveys, lines: satisfactionLines(data.satisfaction) });
    // Só números e rótulos fixos: nenhum campo de comentário.
    expect(serialized).not.toMatch(/"comment"|commentAudio|commentText/);
    expect(Object.keys(data.satisfaction!).sort()).toEqual([
      "answered", "average", "distribution", "improvementTopics", "responseRatePercent", "sent", "smallSample", "unclassified", "withComment",
    ]);
  });
});

describe("documento (painel e PDF)", () => {
  function report(input: MonthlyInput, over: Partial<MonthlyReport> = {}): MonthlyReport {
    const { metrics, data } = evaluateMonthlyMetrics(input);
    return { version: 1, tenantName: "Clínica Exemplo Odonto", month: "2026-09", label: "setembro de 2026", previousMonth: "2026-08",
      assumptions: input.config, current: metrics, previous: metrics, data, status: "ready", decisionMaker: "Dr. Rafael Teixeira", decisionMakerRole: "partner",
      operationalContact: "recepção", adjustments: "", nextMonth: "", highlights: "", limitationsNote: "", meetingAt: null, sentAt: null, finalizedAt: null,
      nextActions: [], ...over } as unknown as MonthlyReport;
  }
  const text = (r: MonthlyReport) => renderToStaticMarkup(createElement(MonthlyReportDocument, { report: r, print: true })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("com 5 ou mais respostas mostra a média, a distribuição e os pontos de melhoria dentro do atendimento", () => {
    const out = text(report(withSurveys(tenAnswers())));
    expect(out).toContain("Satisfação dos contatos");
    expect(out).toContain("3,8");
    expect(out).toContain("nota média, de 1 a 5");
    expect(out).toContain("Demora no atendimento");
    // Sub-bloco do 01: antes da Agenda (02). A ordem das seis partes não muda.
    expect(out.indexOf("Satisfação dos contatos")).toBeGreaterThan(out.indexOf("Atendimento"));
    expect(out.indexOf("Satisfação dos contatos")).toBeLessThan(out.indexOf("Agenda"));
  });

  it("com menos de 5 respostas diz amostra pequena e não mostra a média", () => {
    const out = text(report(withSurveys([survey(5), survey(4), survey(1)])));
    expect(out).toContain("Satisfação dos contatos");
    expect(out).toContain("amostra pequena");
    expect(out).not.toContain("nota média, de 1 a 5");
    expect(out).not.toContain("3,3");
  });

  it("sem respostas, ou em snapshot anterior à pesquisa, o bloco some", () => {
    expect(text(report(withSurveys([survey(null), survey(null)])))).not.toContain("Satisfação dos contatos");
    expect(text(report(v2Input()))).not.toContain("Satisfação dos contatos");
  });

  it("as frases do painel seguem a mesma regra da amostra", () => {
    const big = dataOf(withSurveys(tenAnswers())).satisfaction;
    expect(satisfactionLines(big)[0]).toContain("Nota média 3,8 de 5");
    expect(satisfactionLines(big)[1]).toContain("Demora no atendimento (3)");
    const small = dataOf(withSurveys([survey(5), survey(4)])).satisfaction;
    expect(satisfactionLines(small)[0]).toContain("amostra pequena");
    expect(satisfactionLines(undefined)).toEqual([]);
  });
});
