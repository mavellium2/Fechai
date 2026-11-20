import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ reminderDispatch: { findMany: vi.fn() }, broadcastRecipient: { findMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { periodContactActivity, resolutionOf } from "@/modules/reports/contact-activity";
import { summarizeContactContexts, type ContextContact, type ContextMessage } from "@/modules/reports/contact-context";
import { loadAutomatedSendEvents } from "@/modules/reports/automated-sends";

const start = new Date("2026-09-01T03:00:00Z"), end = new Date("2026-12-01T03:00:00Z");
const at = (day: number, minute = 0) => new Date(Date.UTC(2026, 8, day, 13, minute));
const msg = (id: string, role: string, sentBy: string | null, day: number, minute = 0): ContextMessage =>
  ({ id, role, sentBy, createdAt: at(day, minute) });
/** Conversa cujo histórico começa na primeira mensagem da lista (cadastro criado ali). */
const conversation = (id: string, messages: ContextMessage[]): ContextContact =>
  ({ id, messages, firstMessage: { ...messages[0], contactCreatedAt: messages[0].createdAt } });

/** O paciente escreve; responde quem estiver em `replies`, na ordem. */
const patient = (id: string, ...replies: ("agent" | "human")[]) =>
  conversation(id, [msg(`${id}-u`, "user", null, 2), ...replies.map((by, n) => msg(`${id}-r${n}`, "assistant", by, 2, n + 1))]);
/** A atendente aborda pelo celular, o paciente responde e ela segue. */
const teamApproach = (id: string) =>
  conversation(id, [msg(`${id}-h`, "assistant", "human", 3), msg(`${id}-u`, "user", null, 3, 5), msg(`${id}-h2`, "assistant", "human", 3, 6)]);

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("três formas de resolver uma conversa", () => {
  it("separa só IA, IA + humano e só humano, e o transbordo tira de só IA", () => {
    const reply = (sentBy: string) => ({ role: "assistant", sentBy, createdAt: at(2) });
    expect(resolutionOf([reply("agent")], 0)).toBe("ai_only");
    expect(resolutionOf([reply("agent")], 1)).toBe("ai_and_human");
    expect(resolutionOf([reply("agent"), reply("human")], 0)).toBe("ai_and_human");
    expect(resolutionOf([reply("human")], 0)).toBe("human_only");
    expect(resolutionOf([], 0)).toBeNull();
  });
});

describe("resolução autônoma só sobre o que o paciente iniciou", () => {
  // 2 só IA, 1 IA + humano, 1 só humano iniciadas pelo paciente; 5 abordagens da equipe.
  const sample = () => [patient("p1", "agent"), patient("p2", "agent", "agent"), patient("p3", "agent", "human"), patient("p4", "human"),
    ...Array.from({ length: 5 }, (_, n) => teamApproach(`t${n}`))];

  it("abordagens da equipe não derrubam a taxa: 2 de 4, não 2 de 9", () => {
    const { summary } = summarizeContactContexts({ start, end, conversations: sample(), bookings: [] });
    expect(summary.attended).toBe(9);
    expect(summary.autonomy).toEqual({ aiOnly: 2, aiAndHuman: 1, humanOnly: 1, base: 4, percent: 50 });
    expect(summary.groups.find((g) => g.key === "outbound_human")).toMatchObject({ contacts: 5, attended: 5, aiOnly: 0, aiAndHuman: 0, humanOnly: 5 });
    // A régua antiga dividia pelos atendidos de todos os contextos.
    const old = periodContactActivity(sample().flatMap((c) => c.messages.map((m) => ({ ...m, conversationId: c.id }))));
    expect(Math.round(old.aiOnly.size / old.attended.size * 100)).toBe(22);
  });

  it("cada grupo fecha com os seus atendidos e só IA bate com o operacional", () => {
    const conversations = sample();
    const { summary } = summarizeContactContexts({ start, end, conversations, bookings: [] });
    for (const g of summary.groups) expect((g.aiOnly ?? 0) + (g.aiAndHuman ?? 0) + (g.humanOnly ?? 0)).toBe(g.attended);
    const activity = periodContactActivity(conversations.flatMap((c) => c.messages.map((m) => ({ ...m, conversationId: c.id }))));
    expect(summary.groups.reduce((n, g) => n + (g.aiOnly ?? 0), 0)).toBe(activity.aiOnly.size);
  });

  it("contato da base que volta a escrever entra; continuidade e contexto desconhecido ficam fora", () => {
    const returning = patient("back", "agent");
    returning.firstMessage = { ...msg("old", "user", null, 1), createdAt: new Date("2025-03-01T12:00:00Z") };
    const unknown = patient("legacy", "agent"); delete unknown.firstMessage;
    const continuing = patient("cont", "agent");
    continuing.firstMessage = { ...continuing.firstMessage!, beforeWindow: { role: "user", sentBy: null, createdAt: new Date(+at(2) - 3600_000) } };
    const { summary } = summarizeContactContexts({ start, end, conversations: [returning, unknown, continuing], bookings: [] });
    expect(summary.autonomy).toMatchObject({ base: 1, aiOnly: 1, percent: 100 });
  });

  it("sem conversa iniciada pelo paciente, a taxa é null, não zero", () => {
    const { summary } = summarizeContactContexts({ start, end, conversations: [teamApproach("t")], bookings: [] });
    expect(summary.autonomy).toEqual({ aiOnly: 0, aiAndHuman: 0, humanOnly: 0, base: 0, percent: null });
  });

  it("transbordo registrado no período conta; o de fora da janela não", () => {
    const events = [{ kind: "handoff", conversationId: "p1", createdAt: at(2, 30) }, { kind: "handoff", conversationId: "p2", createdAt: end }];
    const { summary } = summarizeContactContexts({ start, end, conversations: [patient("p1", "agent"), patient("p2", "agent")], bookings: [], events });
    expect(summary.autonomy).toMatchObject({ aiOnly: 1, aiAndHuman: 1, base: 2 });
  });
});

describe("envio automático não é resposta da equipe", () => {
  it("disparo depois da conversa (gravado como humano) não tira o paciente de só IA", () => {
    const c = patient("p", "agent");
    c.messages = [...c.messages, msg("broadcast", "assistant", "human", 20)];
    const events = [{ kind: "contact_campaign", conversationId: "p", messageId: "broadcast", createdAt: at(20) }];
    expect(summarizeContactContexts({ start, end, conversations: [c], bookings: [], events }).summary.autonomy).toMatchObject({ aiOnly: 1, aiAndHuman: 0 });
    expect(summarizeContactContexts({ start, end, conversations: [c], bookings: [] }).summary.autonomy).toMatchObject({ aiOnly: 0, aiAndHuman: 1 });
  });

  it("eco de lembrete gravado como humano vira lembrete, não abordagem da equipe", () => {
    const c = conversation("r", [msg("echo", "assistant", "human", 5), msg("r-u", "user", null, 5, 10), msg("r-a", "assistant", "agent", 5, 11)]);
    const events = [{ kind: "contact_reminder", conversationId: "r", messageId: "echo", createdAt: at(5) }];
    const { summary, records } = summarizeContactContexts({ start, end, conversations: [c], bookings: [], events });
    expect(records[0]).toMatchObject({ context: "outbound_reminder", resolution: "ai_only" });
    expect(summary.groups.find((g) => g.key === "outbound_human")?.contacts).toBe(0);
    expect(summary.autonomy?.base).toBe(0);
  });

  it("o operacional usa o mesmo conjunto: o atendido só pelo lembrete não conta como respondido", () => {
    const messages = [{ ...msg("u", "user", null, 2), conversationId: "c" }, { ...msg("reminder", "assistant", "human", 3), conversationId: "c" }];
    expect(periodContactActivity(messages).attended.size).toBe(1);
    expect(periodContactActivity(messages, [], new Set(["reminder"])).attended.size).toBe(0);
  });
});

describe("lembretes e disparos reconhecidos pelo id da operação", () => {
  const sent = [
    { id: "m1", conversationId: "c1", role: "assistant", createdAt: at(4), whatsappMessageId: "wa-reminder" },
    { id: "m2", conversationId: "c2", role: "assistant", createdAt: at(5), whatsappMessageId: "wa-broadcast" },
    { id: "m3", conversationId: "c3", role: "assistant", createdAt: at(6), whatsappMessageId: "wa-human" },
    { id: "m4", conversationId: "c4", role: "user", createdAt: at(6), whatsappMessageId: "wa-reminder-2" },
  ];
  it("casa pelo id do WhatsApp, só da conta, sem texto", async () => {
    db.reminderDispatch.findMany.mockResolvedValue([{ messageId: "wa-reminder" }, { messageId: "wa-reminder-2" }, { messageId: "elsewhere" }]);
    db.broadcastRecipient.findMany.mockResolvedValue([{ whatsappMessageId: "wa-broadcast" }]);
    const events = await loadAutomatedSendEvents("t", sent, start, end);
    expect(events).toEqual([
      { kind: "contact_reminder", conversationId: "c1", messageId: "m1", createdAt: at(4) },
      { kind: "contact_campaign", conversationId: "c2", messageId: "m2", createdAt: at(5) },
    ]);
    expect(db.reminderDispatch.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t" });
    expect(db.reminderDispatch.findMany.mock.calls[0][0].select).toEqual({ messageId: true });
    expect(db.broadcastRecipient.findMany.mock.calls[0][0].where).toMatchObject({ campaign: { tenantId: "t" } });
    expect(db.broadcastRecipient.findMany.mock.calls[0][0].select).toEqual({ whatsappMessageId: true });
  });
  it("sem id para conferir não consulta; falha devolve vazio e nunca lança", async () => {
    expect(await loadAutomatedSendEvents("t", [{ ...sent[0], whatsappMessageId: null }], start, end)).toEqual([]);
    expect(db.reminderDispatch.findMany).not.toHaveBeenCalled();
    db.reminderDispatch.findMany.mockRejectedValue(new Error("unavailable"));
    db.broadcastRecipient.findMany.mockResolvedValue([]);
    await expect(loadAutomatedSendEvents("t", sent, start, end)).resolves.toEqual([]);
  });
});
