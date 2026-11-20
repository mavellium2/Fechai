import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  message: { findMany: vi.fn() },
  lead: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  conversation: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  reportEvent: { findMany: vi.fn() }, appointment: { findMany: vi.fn() }, agent: { findMany: vi.fn() },
  monthlyRoiReport: { findUnique: vi.fn() }, tenantServiceArea: { findUnique: vi.fn() },
  reminderDispatch: { findMany: vi.fn() }, broadcastRecipient: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { computePeriodReport, resolveRange } from "@/modules/reports/service";
import { EMPTY_ASSUMPTIONS } from "@/modules/reports/monthly-config";
import { loadLeadQualityDetail } from "@/modules/lead-insights/queries";
import { loadHistoricalCities } from "@/modules/lead-insights/historical-city-store";
const date = (day = 10) => new Date(`2026-09-${String(day).padStart(2, "0")}T13:00:00Z`);
/**
 * Histórico de `loadConversationStarts`: o contato escreveu primeiro, no dia
 * da sua primeira mensagem na janela, e o cadastro nasceu ali. Sem isto o
 * contexto é "não identificado" e a conversa fica fora da base da autonomia.
 */
function patientStarted(starts: Record<string, { at?: Date; role?: string; sentBy?: string | null }> = {}) {
  db.conversation.findMany.mockImplementation(async ({ where, orderBy }) => {
    // Outras leituras de conversa (follow-up) e a última mensagem antes da janela: não há.
    if (!where?.id?.in || orderBy?.[0]?.createdAt === "desc") return [];
    return (where.id.in as string[]).map((id) => {
      const s = starts[id] ?? {};
      return { id, lead: { createdAt: s.at ?? date(1) },
        messages: [{ id: `${id}-first`, role: s.role ?? "user", sentBy: s.sentBy ?? null, createdAt: s.at ?? date(1) }] };
    });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.lead.findMany.mockResolvedValue([]); db.lead.groupBy.mockResolvedValue([]); db.lead.count.mockResolvedValue(0);
  db.conversation.findMany.mockResolvedValue([]); db.conversation.groupBy.mockResolvedValue([]); db.conversation.count.mockResolvedValue(0);
  db.appointment.findMany.mockResolvedValue([]); db.agent.findMany.mockResolvedValue([]);
  db.reportEvent.findMany.mockResolvedValue([]);
  db.message.findMany.mockResolvedValue([]); db.monthlyRoiReport.findUnique.mockResolvedValue(null);
  db.tenantServiceArea.findUnique.mockResolvedValue(null);
  db.reminderDispatch.findMany.mockResolvedValue([]); db.broadcastRecipient.findMany.mockResolvedValue([]);
});

describe("consultas do operacional", () => {
  it("compara competências completas por mês civil, inclusive fevereiro e virada de ano", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
      const september = resolveRange("30", "2026-09-01", "2026-09-30");
      expect(september.prevFrom?.toISOString()).toBe("2026-08-01T03:00:00.000Z");
      expect(september.prevTo?.toISOString()).toBe("2026-09-01T02:59:59.999Z");
      expect(resolveRange("30", "2026-02-01", "2026-02-28").prevFrom?.toISOString()).toBe("2026-01-01T03:00:00.000Z");
      expect(resolveRange("30", "2026-01-01", "2026-01-31").prevFrom?.toISOString()).toBe("2025-12-01T03:00:00.000Z");
      expect(resolveRange("30", "2026-09-10", "2026-09-20").prevFrom?.toISOString()).toBe("2026-08-30T03:00:00.000Z");
    } finally { vi.useRealTimers(); }
  });

  it("conta pelos registros do mês, não updatedAt, e alinha todos os gráficos ao total", async () => {
    db.message.findMany.mockResolvedValue([
      { conversationId: "old", role: "user", sentBy: null, createdAt: date(1) },
      { conversationId: "old", role: "assistant", sentBy: "agent", createdAt: new Date(+date(1) + 20_000) },
      { conversationId: "old", role: "assistant", sentBy: "human", createdAt: date(20) },
      { conversationId: "other", role: "user", sentBy: null, createdAt: date(2) },
      { conversationId: "other", role: "assistant", sentBy: "agent", createdAt: new Date(+date(2) + 30_000) },
      { conversationId: "unanswered", role: "user", sentBy: null, createdAt: date(3) },
      { conversationId: "unanswered", role: "user", sentBy: null, createdAt: date(4) },
    ]);
    db.appointment.findMany.mockImplementation(async ({ select }) => select.attendance ? [] : [
      { createdAt: date(30), source: "agent", kind: "evaluation", serviceType: null, agentId: "a" },
      { createdAt: date(30), source: "manual", kind: "evaluation", serviceType: null, agentId: "a" },
      { createdAt: date(30), source: "agent", kind: "treatment", serviceType: null, agentId: "a" },
    ]);
    patientStarted();
    const range = { ...resolveRange("mes", "2026-09-01", "2026-09-30"), prevFrom: null, prevTo: null };
    const r = await computePeriodReport("tenant", range, { assumptions: EMPTY_ASSUMPTIONS });
    expect(r.kpis).toMatchObject({ conversations: 3, attendedContacts: 2, responseRate: 2 / 3, inbound: 4, outbound: 3, scheduled: 3, evaluations: 1 });
    expect(r.attendance.reduce((n, b) => n + b.ai + b.human, 0)).toBe(2);
    expect(r.autonomyRate.current).toBe(0.5);
    expect(r.closed.reduce((n, b) => n + b.ai + b.human, 0)).toBe(3);
    expect(r.results.reduce((n, b) => n + b.appts, 0)).toBe(3);
    for (const call of db.appointment.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ tenantId: "tenant", lead: { isTest: false }, conversation: { isTest: false } });
    }
    expect(db.appointment.findMany.mock.calls[0][0].where).toHaveProperty("createdAt");
    expect(JSON.stringify(db.conversation.groupBy.mock.calls)).not.toContain("updatedAt");
    expect(db.message.findMany.mock.calls[0][0].where.conversation).toMatchObject({ tenantId: "tenant", isTest: false, lead: { isTest: false } });
  });
  it("separa quem iniciou, mede a autonomia só no que o paciente começou e explica leads × atendidos", async () => {
    const m = (id: string, conversationId: string, role: string, sentBy: string | null, day: number, minute = 0, whatsappMessageId: string | null = null) =>
      ({ id, conversationId, role, sentBy, createdAt: new Date(+date(day) + minute * 60_000), whatsappMessageId });
    db.message.findMany.mockResolvedValue([
      // Paciente novo, só a IA respondeu.
      m("a1", "ai", "user", null, 2), m("a2", "ai", "assistant", "agent", 2, 1),
      // Paciente novo, IA e depois a recepção.
      m("b1", "mixed", "user", null, 3), m("b2", "mixed", "assistant", "agent", 3, 1), m("b3", "mixed", "assistant", "human", 3, 9),
      // Abordagem da atendente pelo celular: a conversa nasceu humana.
      m("c1", "team", "assistant", "human", 4), m("c2", "team", "user", null, 4, 5), m("c3", "team", "assistant", "human", 4, 6),
      // Lembrete do Clinicorp cujo eco foi gravado como "humano"; o paciente confirma e a IA responde.
      m("d1", "reminder", "assistant", "human", 5, 0, "wa-reminder"), m("d2", "reminder", "user", null, 5, 10), m("d3", "reminder", "assistant", "agent", 5, 11),
      // Escreveu e ninguém respondeu.
      m("e1", "silent", "user", null, 6),
      // Lembrete sem resposta do paciente.
      m("f1", "unreplied", "assistant", null, 7, 0, "wa-reminder-2"),
    ]);
    db.reminderDispatch.findMany.mockResolvedValue([{ messageId: "wa-reminder" }, { messageId: "wa-reminder-2" }]);
    patientStarted({
      ai: { at: date(2) }, mixed: { at: date(3) }, team: { at: date(4), role: "assistant", sentBy: "human" },
      reminder: { at: date(5), role: "assistant", sentBy: "human" }, silent: { at: date(6) }, unreplied: { at: date(7), role: "assistant", sentBy: null },
    });
    // Leads novos: os seis acima mais um cadastro sem mensagem e um sem conversa.
    db.lead.findMany.mockResolvedValue([...["ai", "mixed", "team", "reminder", "silent", "unreplied", "imported"]
      .map((id) => ({ createdAt: date(2), conversation: { id } })), { createdAt: date(2), conversation: null }]);
    const range = { ...resolveRange("mes", "2026-09-01", "2026-09-30"), prevFrom: null, prevTo: null };
    const r = await computePeriodReport("tenant", range, { assumptions: EMPTY_ASSUMPTIONS });

    const group = (key: string) => r.contexts.groups.find((g) => g.key === key);
    expect(group("outbound_human")).toMatchObject({ contacts: 1, attended: 1, humanOnly: 1 });
    expect(group("outbound_reminder")).toMatchObject({ contacts: 2, attended: 1, aiOnly: 1 });
    expect(r.contexts.autonomy).toEqual({ aiOnly: 1, aiAndHuman: 1, humanOnly: 0, base: 2, percent: 50 });
    expect(r.autonomyRate.current).toBe(0.5);
    // O gráfico IA × humano usa a mesma base: a abordagem da equipe não é "precisou de humano".
    expect(r.attendance.reduce((n, b) => n + b.ai, 0)).toBe(1);
    expect(r.attendance.reduce((n, b) => n + b.aiAndHuman, 0)).toBe(1);
    expect(r.attendance.reduce((n, b) => n + b.humanOnly, 0)).toBe(0);
    expect(r.kpis.attendedContacts).toBe(4);

    const lr = r.leadReconciliation;
    expect(lr).toMatchObject({ newLeads: 8, attended: 4, newAttended: 4, existingAttended: 0, unanswered: 1, noReply: 1, noMessages: 2 });
    expect(lr.newAttended + lr.unanswered + lr.noReply + lr.noMessages).toBe(lr.newLeads);
    expect(lr.newAttended + lr.existingAttended).toBe(lr.attended);
    expect(lr.byContext.find((g) => g.key === "outbound_reminder")).toMatchObject({ leads: 2, attended: 1 });
  });

  it("usa as regras da revisão mensal para avaliações de uma competência inteira", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue({ assumptions: { ...EMPTY_ASSUMPTIONS, evaluationTypes: ["Check-up"], agentIds: ["chosen"] } });
    db.appointment.findMany.mockImplementation(async ({ select }) => select.attendance ? [] : [
      { createdAt: date(), source: "agent", kind: null, serviceType: "Check-up", agentId: "chosen" },
      { createdAt: date(), source: "agent", kind: null, serviceType: "Check-up", agentId: "other" },
    ]);
    const r = await computePeriodReport("tenant", { ...resolveRange("mes", "2026-09-01", "2026-09-30"), prevFrom: null, prevTo: null });
    expect(r.kpis.evaluations).toBe(1);
    expect(db.monthlyRoiReport.findUnique.mock.calls[0][0].where).toEqual({ tenantId_month: { tenantId: "tenant", month: "2026-09" } });
  });
});

describe("histórico de cidades na população do mês", () => {
  it("inclui o contato antigo atendido e devolve apenas a origem, sem mensagem nem dados pessoais", async () => {
    const conversation = { id: "old", needsHuman: false, lastInboundAt: date(), followUpReason: null, reportEvents: [], insight: null,
      messages: [{ role: "user", sentBy: null, createdAt: date() }, { role: "assistant", sentBy: "agent", createdAt: new Date(+date() + 20_000) }] };
    db.lead.findMany.mockResolvedValue([{ id: "lead", createdAt: new Date("2025-01-01T00:00:00Z"), status: "new", disqualifiedAt: null, disqualifiedReason: null, appointments: [], conversation }]);
    db.message.findMany.mockResolvedValue([{ id: "literal", conversationId: "old", role: "user", content: "Sou de Marília", createdAt: new Date("2026-08-01T12:00:00Z") }]);
    const r = await loadLeadQualityDetail("tenant", { from: date(1), to: new Date("2026-10-01T03:00:00Z") });
    expect(r.quality).toMatchObject({ leads: 1, withCity: 1, areaConfigured: false });
    expect(r.leads[0]).toMatchObject({ city: "Marília", verdict: "unknown", cityMessageId: "literal", cityDeclaredAt: "2026-08-01T12:00:00.000Z" });
    expect(JSON.stringify(r)).not.toContain("Sou de");
    expect(db.lead.findMany.mock.calls[0][0].where).not.toHaveProperty("createdAt");
    expect(db.message.findMany.mock.calls[0][0].where).toMatchObject({ conversation: { tenantId: "tenant", isTest: false, lead: { isTest: false } }, createdAt: { lt: new Date("2026-10-01T03:00:00Z") } });
  });
  it("mantém a pergunta anterior entre páginas e não trunca o histórico", async () => {
    const noise = Array.from({ length: 999 }, (_, n) => ({ id: String(n), conversationId: "old", role: "user", content: "Olá", createdAt: date(1) }));
    db.message.findMany.mockResolvedValueOnce([...noise, { id: "question", conversationId: "old", role: "assistant", content: "Qual sua cidade?", createdAt: date(2) }])
      .mockResolvedValueOnce([{ id: "answer", conversationId: "old", role: "user", content: "Garça", createdAt: date(3) }]);
    const result = await loadHistoricalCities("tenant", ["old"], date(30));
    expect(result.get("old")).toMatchObject({ cityKey: "garca", messageId: "answer" });
    expect(db.message.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: "question" }, skip: 1 });
  });
  it("preserva o registro explícito do agente e ignora contatos sem resposta", async () => {
    const conversation = { id: "old", needsHuman: false, lastInboundAt: date(), followUpReason: null, reportEvents: [],
      insight: { city: "Garça", cityKey: "garca", firstQuestionKey: null, lossReasonKey: null },
      messages: [{ role: "user", sentBy: null, createdAt: date() }, { role: "assistant", sentBy: "human", createdAt: new Date(+date() + 1000) }] };
    const lead = { id: "lead", createdAt: date(), status: "new", disqualifiedAt: null, disqualifiedReason: null, appointments: [], conversation };
    db.lead.findMany.mockResolvedValue([lead, { ...lead, id: "no-response", conversation: { ...conversation, id: "unanswered", messages: [conversation.messages[0]] } }]);
    expect((await loadLeadQualityDetail("tenant", { from: date(1), to: date(30) })).quality).toMatchObject({ leads: 1, withCity: 1 });
    expect(db.message.findMany).not.toHaveBeenCalled();
  });
});
