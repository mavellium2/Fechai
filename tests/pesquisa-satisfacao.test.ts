import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, WhatsAppProvider } from "@/modules/whatsapp/provider";

/**
 * Pesquisa de satisfação pós-conversa. O que está protegido aqui:
 *
 * - só nota inequívoca vira nota (o resto segue o atendimento);
 * - cada exclusão (transbordo, "pare", follow-up, Disparo, 30 dias, teste...);
 * - janela de 24h e faixa de horas da conta;
 * - envio: claim antes do POST, erro vira `unknown` e nunca repete, o canal é o
 *   do contato e, fora do ar, espera sem trocar de número;
 * - webhook: o eco não pausa o agente; nota e comentário ficam fora do turno,
 *   sem `Message`; reentrega é idempotente;
 * - a lista interativa da Meta chega como texto + id;
 * - o follow-up não sai depois da pesquisa.
 */

const db = vi.hoisted(() => ({
  conversation: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  tenantAction: { findMany: vi.fn() },
  satisfactionSurvey: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  satisfactionSurveySettings: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  agent: { findMany: vi.fn() },
  lead: { findFirst: vi.fn() },
  whatsappInstance: { findMany: vi.fn(), findFirst: vi.fn() },
  message: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  reportEvent: { count: vi.fn() },
}));
const blocked = vi.hoisted(() => ({ isPhoneBlocked: vi.fn(async (): Promise<boolean> => false) }));
const provider = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn(async (...args: unknown[]): Promise<string | null> => { void args; return "wa-text"; }),
  sendRatingPrompt: vi.fn(async (...args: unknown[]): Promise<string | null> => { void args; return "wa-list"; }),
}));
const engine = vi.hoisted(() => ({
  getOrCreateConversation: vi.fn(),
  appendMessage: vi.fn(async () => ({ id: "m-1" })),
  resolveAgent: vi.fn(),
  runAgentTurn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/modules/whatsapp/blocklist", () => blocked);
vi.mock("@/modules/whatsapp/meta-config", () => ({
  WHATSAPP_PROVIDER_SELECT: {},
  getWhatsAppProviderForInstance: () => provider,
}));
vi.mock("@/modules/agent-engine/conversation", () => ({
  getOrCreateConversation: engine.getOrCreateConversation,
  appendMessage: engine.appendMessage,
}));
vi.mock("@/modules/agent-engine/orchestrator", () => ({ resolveAgent: engine.resolveAgent, runAgentTurn: engine.runAgentTurn }));
vi.mock("@/modules/agent-engine/handoff", () => ({ notifyHandoffGroup: vi.fn(async () => {}) }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/ai/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/modules/voice/storage", () => ({ storeVoiceMessage: vi.fn(async () => null) }));
vi.mock("@/modules/voice/reply", () => ({ speakReply: vi.fn(async () => ({ spoken: false })) }));

import { isOptOutText, parseRating } from "@/modules/satisfaction/rating";
import {
  DEFAULT_SURVEY_SETTINGS,
  DEFAULT_SURVEY_TEXTS,
  describeSurveySettings,
  numberedPrompt,
  parseSurveySettings,
  RATING_ROWS,
  type SurveySettings,
} from "@/modules/satisfaction/settings";
import {
  evaluateSurvey,
  isWithinSurveyWindow,
  sendDeadline,
  type SurveyCandidate,
} from "@/modules/satisfaction/eligibility";
import { sendSurvey } from "@/modules/satisfaction/send";
import { handleSurveyReply } from "@/modules/satisfaction/capture";
import { isSurveyOutbound } from "@/modules/satisfaction/echo";
import { parseMetaMessages } from "@/modules/whatsapp/meta-events";
import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";
import { nextFollowUp, scanAndSendFollowUps } from "../workers/follow-up-worker/scan";
import { scanSatisfactionSurveys } from "../workers/follow-up-worker/satisfaction";
import { DEFAULT_FOLLOWUP_CONFIG } from "@/modules/follow-up/config";
import { parseTopics } from "@/modules/satisfaction/classify";
import { cleanTopics } from "@/modules/satisfaction/categories";
import { averageIsReliable, summarizeSurveys } from "@/modules/satisfaction/summary";
import { saveSurveySettings, surveySettingsFormSchema } from "@/modules/satisfaction/settings-store";
import { TEST_NEEDS_MESSAGE, normalizeTestPhone, sendSurveyTest } from "@/modules/satisfaction/test-send";
import { loadSatisfaction } from "@/modules/satisfaction/queries";

const TENANT = "tenant-1";
// 12:00 UTC = 09:00 em São Paulo: dentro da faixa 8h–20h.
const NOW = new Date("2026-10-20T12:00:00.000Z");
const minutes = (n: number) => n * 60_000;
const ago = (n: number, from = NOW) => new Date(from.getTime() - minutes(n));

const SETTINGS: SurveySettings = { ...DEFAULT_SURVEY_SETTINGS, enabled: true };

function candidate(over: Partial<SurveyCandidate> = {}): SurveyCandidate {
  return {
    isTest: false, leadIsTest: false, whatsappProvider: "meta", agentEnabled: true,
    needsHuman: false, agentPaused: false, handoffInEpisode: false, followUpReason: null,
    blocked: false,
    // O contato escreveu há 4h; o agente respondeu há 3h30: já passou da espera de 3h.
    lastInboundAt: ago(240),
    lastMessage: { role: "assistant", createdAt: ago(210) },
    lastMessageAutomated: false,
    contactMessages: 3, agentReplies: 3,
    followUpActive: false, inReactivation: false,
    hasOpenSurvey: false, surveyCreatedAfterLastInbound: false, lastReceivedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  blocked.isPhoneBlocked.mockResolvedValue(false);
  provider.isConfigured.mockReturnValue(true);
  provider.sendMessage.mockResolvedValue("wa-text");
  provider.sendRatingPrompt.mockResolvedValue("wa-list");
  db.satisfactionSurveySettings.findUnique.mockResolvedValue({ enabled: true });
  db.satisfactionSurvey.create.mockResolvedValue({ id: "survey-1" });
  db.satisfactionSurvey.update.mockResolvedValue({});
  db.satisfactionSurvey.updateMany.mockResolvedValue({ count: 1 });
  db.satisfactionSurvey.findMany.mockResolvedValue([]);
  db.satisfactionSurvey.findFirst.mockResolvedValue(null);
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
});

describe("parseRating", () => {
  it("lê o id da lista da Meta mesmo sem texto útil", () => {
    expect(parseRating("", "rating_4")).toBe(4);
    expect(parseRating("qualquer coisa", "rating_1")).toBe(1);
    expect(parseRating("3", "rating_9")).toBe(3);
  });

  it.each([
    ["4", 4], ["nota 4", 4], ["Nota: 5", 5], ["5 estrelas", 5], ["⭐⭐⭐⭐", 4],
    ["4 ⭐⭐⭐⭐", 4], ["⭐️⭐️⭐️⭐️⭐️", 5], ["5 ⭐️", 5], ["5/5", 5], ["4 / 5", 4], ["cinco", 5], ["três", 3], ["dou nota 2", 2], ["1 estrela", 1], ["5!", 5],
  ])("%s vira %i", (text, expected) => {
    expect(parseRating(text)).toBe(expected);
  });

  it.each([
    "0", "6", "10", "um", "preciso remarcar a consulta das 4", "5 pessoas vão comigo", "ok",
    "4 ⭐⭐", "3/4", "6/5", "5/5 ⭐⭐", "", "nota", "quero falar com a Maria sobre o orçamento de 3 consultas",
  ])("%j não é nota", (text) => {
    expect(parseRating(text)).toBeNull();
  });

  it("reconhece o pedido para parar", () => {
    expect(isOptOutText("Pare")).toBe(true);
    expect(isOptOutText("sair")).toBe(true);
    expect(isOptOutText("não quero mais receber")).toBe(true);
    expect(isOptOutText("quero sair mais cedo amanhã, dá?")).toBe(false);
    expect(isOptOutText("parar de receber mensagens")).toBe(true);
    expect(isOptOutText("sair da lista")).toBe(true);
    // Quem tem consulta marcada escreve "cancelar" para desmarcar: é assunto do agente.
    expect(isOptOutText("cancelar")).toBe(false);
    expect(isOptOutText("Cancelar")).toBe(false);
    expect(isOptOutText("quero cancelar minha consulta")).toBe(false);
  });
});

describe("configuração", () => {
  it("sem linha: desligada, com os textos padrão", () => {
    const s = parseSurveySettings(null);
    expect(s.enabled).toBe(false);
    expect(s.delayMinutes).toBe(180);
    expect(s.texts).toEqual(DEFAULT_SURVEY_TEXTS);
    expect(s.customized.rating).toBe(false);
  });

  it("valor estranho cai no padrão e a espera respeita 30 min a 20 h", () => {
    expect(parseSurveySettings({ delayMinutes: 5 }).delayMinutes).toBe(30);
    expect(parseSurveySettings({ delayMinutes: 99999 }).delayMinutes).toBe(1200);
    expect(parseSurveySettings({ delayMinutes: "x" }).delayMinutes).toBe(180);
    expect(parseSurveySettings({ timezone: "Marte/Olympus" }).timezone).toBe("America/Sao_Paulo");
    // janela invertida volta ao padrão em vez de calar a pesquisa.
    const w = parseSurveySettings({ windowStartHour: 20, windowEndHour: 8 });
    expect([w.windowStartHour, w.windowEndHour]).toEqual([8, 20]);
  });

  it("texto trocado é marcado como customizado", () => {
    const s = parseSurveySettings({ enabled: true, ratingText: "Como foi?" });
    expect(s.texts.rating).toBe("Como foi?");
    expect(s.customized.rating).toBe(true);
    expect(describeSurveySettings(s)).toContain("3h");
  });

  it("a pergunta por QR é numerada e a lista da Meta tem 5 linhas de até 24 caracteres", () => {
    expect(numberedPrompt("Como foi?")).toContain("Responda com um número de 1 a 5");
    expect(RATING_ROWS).toHaveLength(5);
    expect(RATING_ROWS.every((r) => r.title.length <= 24)).toBe(true);
    expect(RATING_ROWS[4].id).toBe("rating_5");
  });
});

describe("quem recebe a pesquisa", () => {
  it("recuperação de histórico não dispara pesquisa", () => {
    expect(evaluateSurvey(candidate({ lastMessage: { role: "assistant", createdAt: ago(300), sentBy: "history" } }), SETTINGS, NOW)).toEqual({ action: "skip", reason: "not_real_conversation" });
  });
  it("conversa real, terminada e dentro do prazo: envia", () => {
    expect(evaluateSurvey(candidate(), SETTINGS, NOW)).toEqual({ action: "send" });
  });

  it("desligada: nada sai", () => {
    expect(evaluateSurvey(candidate(), { ...SETTINGS, enabled: false }, NOW)).toEqual({ action: "skip", reason: "disabled" });
  });

  it.each([
    ["conversa de teste", { isTest: true }, "test"],
    ["lead de teste", { leadIsTest: true }, "test"],
    ["site/widget (sem canal de WhatsApp)", { whatsappProvider: null }, "no_channel"],
    ["agente desligado", { agentEnabled: false }, "agent_off"],
    ["transferido para humano / prioridade", { needsHuman: true }, "needs_human"],
    ["humano assumiu", { agentPaused: true }, "needs_human"],
    ["houve transbordo no episódio (mesmo devolvido)", { handoffInEpisode: true }, "handoff"],
    ["pediu para parar", { followUpReason: "stop" }, "opt_out"],
    ["número bloqueado", { blocked: true }, "blocked"],
    ["em reativação", { inReactivation: true }, "reactivation"],
    ["follow-up em andamento", { followUpActive: true }, "follow_up"],
    ["pesquisa já aberta", { hasOpenSurvey: true }, "open_survey"],
    ["pesquisa já criada neste episódio", { surveyCreatedAfterLastInbound: true }, "already_handled"],
    ["última fala foi um Disparo/lembrete", { lastMessageAutomated: true }, "automated_last"],
    ["o contato falou por último", { lastMessage: { role: "user", createdAt: ago(300) } }, "contact_last"],
  ] as const)("não envia: %s", (_name, over, reason) => {
    expect(evaluateSurvey(candidate(over), SETTINGS, NOW)).toEqual({ action: "skip", reason });
  });

  it("só uma mensagem do contato, ou nenhuma resposta do agente, não é conversa de verdade", () => {
    expect(evaluateSurvey(candidate({ contactMessages: 1 }), SETTINGS, NOW)).toEqual({ action: "skip", reason: "not_real_conversation" });
    expect(evaluateSurvey(candidate({ agentReplies: 0 }), SETTINGS, NOW)).toEqual({ action: "skip", reason: "not_real_conversation" });
  });

  it("quem recebeu há menos de 30 dias fica de fora; depois, volta", () => {
    expect(evaluateSurvey(candidate({ lastReceivedAt: ago(29 * 24 * 60) }), SETTINGS, NOW)).toEqual({ action: "skip", reason: "cooldown" });
    expect(evaluateSurvey(candidate({ lastReceivedAt: ago(31 * 24 * 60) }), SETTINGS, NOW)).toEqual({ action: "send" });
  });

  it("espera o silêncio configurado depois da última fala do agente", () => {
    const c = candidate({ lastMessage: { role: "assistant", createdAt: ago(60) } });
    expect(evaluateSurvey(c, SETTINGS, NOW)).toEqual({ action: "wait", reason: "silence" });
    expect(evaluateSurvey(c, { ...SETTINGS, delayMinutes: 30 }, NOW)).toEqual({ action: "send" });
  });

  it("depois do prazo de 24h (menos a margem) expira sem enviar", () => {
    const lastInboundAt = ago(24 * 60 - 30); // 23h30 atrás: sobra menos que a margem de 60 min
    expect(sendDeadline(lastInboundAt).getTime()).toBeLessThan(NOW.getTime());
    const c = candidate({ lastInboundAt, lastMessage: { role: "assistant", createdAt: ago(23 * 60) } });
    expect(evaluateSurvey(c, SETTINGS, NOW)).toEqual({ action: "expire" });
  });

  it("fora da faixa de horas espera abrir; se a faixa só abre depois do prazo, expira", () => {
    // 01:00 em São Paulo (04:00 UTC): fechado até as 8h.
    const night = new Date("2026-10-20T04:00:00.000Z");
    expect(isWithinSurveyWindow(night, SETTINGS)).toBe(false);
    const early = candidate({ lastInboundAt: ago(120, night), lastMessage: { role: "assistant", createdAt: ago(100, night) } });
    expect(evaluateSurvey(early, { ...SETTINGS, delayMinutes: 30 }, night)).toEqual({ action: "wait", reason: "window" });

    // Contato escreveu às 21h30 local; 8h é 10h30 depois: ainda cabe nas 23h.
    // Contato escreveu às 12h do dia anterior (20h antes): 8h abre em 4h, mas o prazo é em 3h.
    const late = candidate({ lastInboundAt: ago(20 * 60, night), lastMessage: { role: "assistant", createdAt: ago(19 * 60, night) } });
    expect(evaluateSurvey(late, { ...SETTINGS, delayMinutes: 30 }, night)).toEqual({ action: "expire" });
  });

  it("o envio de teste ignora espera e faixa de horas, mas não as demais regras", () => {
    const c = candidate({ lastMessage: { role: "assistant", createdAt: ago(1) } });
    expect(evaluateSurvey(c, SETTINGS, NOW, { ignoreTiming: true })).toEqual({ action: "send" });
    expect(evaluateSurvey(candidate({ blocked: true }), SETTINGS, NOW, { ignoreTiming: true })).toEqual({ action: "skip", reason: "blocked" });
  });
});

describe("envio da pergunta", () => {
  const CONV = {
    id: "conv-1", agentId: "agent-1", isTest: false, needsHuman: false, agentPaused: false,
    followUpReason: null as string | null, whatsappProvider: "meta" as string | null,
    lead: { phone: "5511999999999", isTest: false },
  };
  const CHANNEL = (p: string, status = "connected") => ({
    provider: p, status, externalId: `${p}-1`, agentReplies: true,
    metaPhoneNumberId: null, metaBusinessAccountId: null, metaAccessTokenEncrypted: null,
  });

  beforeEach(() => {
    db.conversation.findFirst.mockResolvedValue(CONV);
    db.whatsappInstance.findMany.mockResolvedValue([CHANNEL("meta"), CHANNEL("evolution")]);
  });

  it("pela Meta: reivindica a linha antes do POST e manda a lista interativa", async () => {
    const order: string[] = [];
    db.satisfactionSurvey.create.mockImplementation(async () => { order.push("claim"); return { id: "survey-1" }; });
    provider.sendRatingPrompt.mockImplementation(async () => { order.push("post"); return "wa-list"; });

    const res = await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS });

    expect(order).toEqual(["claim", "post"]);
    expect(res).toEqual({ status: "sent", surveyId: "survey-1" });
    expect(provider.sendRatingPrompt).toHaveBeenCalledWith("meta-1", "5511999999999", expect.objectContaining({ rows: RATING_ROWS }));
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.satisfactionSurvey.update).toHaveBeenCalledWith({
      where: { id: "survey-1" },
      data: { status: "awaiting_rating", ratingMsgId: "wa-list" },
    });
  });

  it("pelo QR: texto numerado, sem botões", async () => {
    db.conversation.findFirst.mockResolvedValue({ ...CONV, whatsappProvider: "evolution" });
    await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS });
    expect(provider.sendMessage).toHaveBeenCalledWith("evolution-1", "5511999999999", numberedPrompt(DEFAULT_SURVEY_TEXTS.rating));
    expect(provider.sendRatingPrompt).not.toHaveBeenCalled();
  });

  it("erro no envio vira `unknown` e não é repetido", async () => {
    provider.sendRatingPrompt.mockRejectedValue(new Error("timeout"));
    const res = await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS });
    expect(res).toEqual({ status: "unknown", surveyId: "survey-1" });
    expect(provider.sendRatingPrompt).toHaveBeenCalledTimes(1);
    expect(db.satisfactionSurvey.update).toHaveBeenCalledWith({ where: { id: "survey-1" }, data: { status: "unknown" } });
  });

  it("o número do contato fora do ar espera, nunca troca para o outro", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([CHANNEL("meta", "disconnected"), CHANNEL("evolution")]);
    const res = await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS });
    expect(res.status).toBe("waiting");
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(provider.sendRatingPrompt).not.toHaveBeenCalled();
  });

  it("número em que o agente não responde espera", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ ...CHANNEL("meta"), agentReplies: false }]);
    expect((await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS })).status).toBe("waiting");
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it("reconfere bloqueio, 'pare' e transbordo antes de enviar", async () => {
    blocked.isPhoneBlocked.mockResolvedValue(true);
    expect((await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS })).status).toBe("skipped");
    blocked.isPhoneBlocked.mockResolvedValue(false);
    db.conversation.findFirst.mockResolvedValue({ ...CONV, followUpReason: "stop" });
    expect((await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS })).status).toBe("skipped");
    db.conversation.findFirst.mockResolvedValue({ ...CONV, needsHuman: true });
    expect((await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS })).status).toBe("skipped");
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it("o envio de teste grava isTest", async () => {
    await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS, isTest: true });
    expect(db.satisfactionSurvey.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isTest: true }) }));
  });
});

describe("captura da resposta (fora do turno do agente)", () => {
  const base = {
    tenantId: TENANT, conversationId: "conv-1", phone: "5511999999999", externalId: "meta-1",
    provider: { sendMessage: provider.sendMessage }, now: NOW,
  };

  it("sem pesquisa aberta, nada é capturado", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([]);
    expect(await handleSurveyReply({ ...base, text: "5" })).toEqual({ handled: false });
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("nota 1 a 3 recebe o texto baixo; 4 e 5, o texto alto", async () => {
    const open = { id: "s1", status: "awaiting_rating", sentAt: ago(30), ratedAt: null, ratingInboundId: null, commentInboundId: null };
    db.satisfactionSurvey.findMany.mockResolvedValue([open]);
    expect(await handleSurveyReply({ ...base, text: "2", messageKeyId: "in-1" })).toEqual({ handled: true });
    expect(provider.sendMessage).toHaveBeenLastCalledWith("meta-1", "5511999999999", DEFAULT_SURVEY_TEXTS.low);
    expect(db.satisfactionSurvey.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "awaiting_comment", rating: 2, ratingInboundId: "in-1" }),
    }));

    await handleSurveyReply({ ...base, text: "", replyId: "rating_5" });
    expect(provider.sendMessage).toHaveBeenLastCalledWith("meta-1", "5511999999999", DEFAULT_SURVEY_TEXTS.high);
  });

  it("o comentário é a primeira mensagem depois da pergunta; agradece e encerra", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", status: "awaiting_comment", sentAt: ago(60), ratedAt: ago(5), ratingInboundId: "in-1", commentInboundId: null },
    ]);
    expect(await handleSurveyReply({ ...base, text: "Demorou para responder", messageKeyId: "in-2" })).toEqual({ handled: true });
    expect(db.satisfactionSurvey.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed", comment: "Demorou para responder", commentInboundId: "in-2" }),
    }));
    const thanks = provider.sendMessage.mock.calls.at(-1)?.[2] as string;
    expect(thanks).toBe(DEFAULT_SURVEY_TEXTS.thanks);
    expect(thanks).toContain("é só mandar mensagem");
  });

  it("escrever outra coisa no lugar da nota encerra a pesquisa e libera a mensagem para o agente", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", status: "awaiting_rating", sentAt: ago(30), ratedAt: null, ratingInboundId: null, commentInboundId: null },
    ]);
    expect(await handleSurveyReply({ ...base, text: "Quero remarcar minha consulta de sexta" })).toEqual({ handled: false });
    expect(db.satisfactionSurvey.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "no_reply" } }));
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("depois de 24h sem resposta a nota não é mais aceita", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", status: "awaiting_rating", sentAt: ago(25 * 60), ratedAt: null, ratingInboundId: null, commentInboundId: null },
    ]);
    expect(await handleSurveyReply({ ...base, text: "5" })).toEqual({ handled: false });
  });

  it("reentrega da mesma mensagem é idempotente: não responde de novo", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", status: "awaiting_comment", sentAt: ago(60), ratedAt: ago(5), ratingInboundId: "in-1", commentInboundId: null },
    ]);
    expect(await handleSurveyReply({ ...base, text: "4", messageKeyId: "in-1" })).toEqual({ handled: true });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.satisfactionSurvey.updateMany).not.toHaveBeenCalled();
  });

  it("'pare' durante a pesquisa grava a regra existente e manda só uma confirmação", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", status: "awaiting_rating", sentAt: ago(30), ratedAt: null, ratingInboundId: null, commentInboundId: null },
    ]);
    expect(await handleSurveyReply({ ...base, text: "Pare" })).toEqual({ handled: true });
    expect(db.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { followUpReason: "stop" } }));
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("nunca lança: falha de banco devolve não tratado", async () => {
    db.satisfactionSurvey.findMany.mockRejectedValue(new Error("db fora"));
    expect(await handleSurveyReply({ ...base, text: "5" })).toEqual({ handled: false });
  });
});

describe("webhook", () => {
  const sendMessage = provider.sendMessage;
  const fakeProvider = (name: string) =>
    ({ name, sendMessage, sendAudio: vi.fn(), getMediaAsBase64: vi.fn() }) as unknown as WhatsAppProvider;
  const BASE: IncomingMessage = {
    instanceExternalId: "numero-1", fromPhone: "5511999999999", text: "4", isGroup: false,
    hasAudio: false, messageKeyId: "in-1",
  };

  beforeEach(() => {
    db.whatsappInstance.findFirst.mockResolvedValue({ tenantId: TENANT, status: "connected", agentReplies: true, tenant: {} });
    db.message.findUnique.mockResolvedValue(null);
    db.message.findFirst.mockResolvedValue(null);
    db.conversation.update.mockResolvedValue({});
    engine.getOrCreateConversation.mockResolvedValue({
      lead: { id: "lead-1", isTest: false },
      conversation: { id: "conv-1", whatsappProvider: "evolution", agentId: "agent-1" },
    });
    engine.resolveAgent.mockResolvedValue({ id: "agent-1", stopOnEmoji: true, listenAudio: false });
    engine.runAgentTurn.mockResolvedValue({ reply: "ok", status: "ok", replyMessageId: "m-r" });
  });

  it("o eco do que a pesquisa enviou NÃO pausa o agente (id conhecido)", async () => {
    db.satisfactionSurvey.findFirst.mockResolvedValue({ id: "s1" });
    const res = await processIncomingWhatsapp({ ...BASE, isFromMe: true, messageKeyId: "wa-list", text: "pergunta" }, fakeProvider("evolution"));
    expect(res.body.silent).toBe("pesquisa de satisfação");
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(engine.appendMessage).not.toHaveBeenCalled();
  });

  it("o eco que chega antes do id, com o mesmo texto, também é da pesquisa", async () => {
    db.satisfactionSurvey.findFirst
      .mockResolvedValueOnce(null) // id ainda não gravado
      .mockResolvedValueOnce({ id: "s1" }); // pesquisa mexida há segundos
    const res = await processIncomingWhatsapp(
      { ...BASE, isFromMe: true, messageKeyId: "wa-novo", text: numberedPrompt(DEFAULT_SURVEY_TEXTS.rating) },
      fakeProvider("evolution"),
    );
    expect(res.body.silent).toBe("pesquisa de satisfação");
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("mensagem da equipe pelo celular continua pausando o agente", async () => {
    db.satisfactionSurvey.findFirst.mockResolvedValue(null);
    const res = await processIncomingWhatsapp({ ...BASE, isFromMe: true, messageKeyId: "wa-humano", text: "Oi, é a Ana da clínica" }, fakeProvider("evolution"));
    expect(res.body.silent).toBe("manual pelo whatsapp");
    expect(db.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { needsHuman: false, agentPaused: true } }));
  });

  it("a nota do contato não chama o agente, não cria Message e responde pelo próprio provedor", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", status: "awaiting_rating", sentAt: new Date(Date.now() - minutes(20)), ratedAt: null, ratingInboundId: null, commentInboundId: null },
    ]);
    const res = await processIncomingWhatsapp(BASE, fakeProvider("evolution"));
    expect(res.body.silent).toBe("pesquisa de satisfação");
    expect(engine.runAgentTurn).not.toHaveBeenCalled();
    expect(engine.appendMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("numero-1", "5511999999999", DEFAULT_SURVEY_TEXTS.high);
  });

  it("o que não é nota segue o turno normal do agente", async () => {
    db.satisfactionSurvey.findMany.mockResolvedValue([
      { id: "s1", status: "awaiting_rating", sentAt: new Date(Date.now() - minutes(20)), ratedAt: null, ratingInboundId: null, commentInboundId: null },
    ]);
    await processIncomingWhatsapp({ ...BASE, text: "Pode remarcar para sexta?" }, fakeProvider("evolution"));
    expect(engine.runAgentTurn).toHaveBeenCalledTimes(1);
  });
});

describe("eco (função)", () => {
  it("nunca lança", async () => {
    db.satisfactionSurvey.findFirst.mockRejectedValue(new Error("db"));
    expect(await isSurveyOutbound(TENANT, "conv-1", "x", "texto")).toBe(false);
  });
});

describe("lista interativa da Meta", () => {
  const payload = (message: Record<string, unknown>) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "pn-1" },
      contacts: [{ wa_id: "5511999999999", profile: { name: "Maria" } }],
      messages: [{ from: "5511999999999", id: "wamid.1", timestamp: "1760961600", ...message }],
    } }] }],
  });

  it("list_reply vira texto (título) + replyId", () => {
    const [m] = parseMetaMessages(payload({
      type: "interactive",
      interactive: { type: "list_reply", list_reply: { id: "rating_4", title: "4 ⭐⭐⭐⭐" } },
    }));
    expect(m).toMatchObject({ text: "4 ⭐⭐⭐⭐", replyId: "rating_4", isFromMe: false });
    expect(parseRating(m.text, m.replyId)).toBe(4);
  });

  it("button_reply também", () => {
    const [m] = parseMetaMessages(payload({
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "rating_2", title: "2" } },
    }));
    expect(m).toMatchObject({ text: "2", replyId: "rating_2" });
  });

  it("texto comum não ganha replyId", () => {
    const [m] = parseMetaMessages(payload({ type: "text", text: { body: "Oi" } }));
    expect(m.replyId).toBeUndefined();
  });

  it("interativo sem título/id é descartado como antes", () => {
    expect(parseMetaMessages(payload({ type: "interactive", interactive: { type: "nfm_reply" } }))).toEqual([]);
  });
});

describe("follow-up depois da pesquisa", () => {
  const conv = {
    needsHuman: false, agentPaused: false, followUpSentAt: null, followUpStep: 0, followUpReason: null,
    lastInboundAt: ago(120), lastMessage: { role: "assistant", createdAt: ago(100) },
  };
  it("sem pesquisa, a etapa vence normalmente", () => {
    expect(nextFollowUp(conv, DEFAULT_FOLLOWUP_CONFIG)).not.toBeNull();
  });
  it("pesquisa enviada depois da última fala do contato encerra a esteira", () => {
    expect(nextFollowUp({ ...conv, lastSurveySentAt: ago(90) }, DEFAULT_FOLLOWUP_CONFIG)).toBeNull();
  });
  it("pesquisa de um episódio anterior não bloqueia", () => {
    expect(nextFollowUp({ ...conv, lastSurveySentAt: ago(600) }, DEFAULT_FOLLOWUP_CONFIG)).not.toBeNull();
  });
});

describe("regras de quem recebe: declined e pesquisa de teste", () => {
  it("quem recusou agendar (declined) RECEBE a pesquisa mesmo com a esteira andando", () => {
    expect(evaluateSurvey(candidate({ followUpReason: "declined", followUpActive: true }), SETTINGS, NOW)).toEqual({ action: "send" });
  });
  it("quem só sumiu, com etapa de follow-up pendente, continua sem pesquisa", () => {
    expect(evaluateSurvey(candidate({ followUpReason: null, followUpActive: true }), SETTINGS, NOW)).toEqual({ action: "skip", reason: "follow_up" });
  });
  it("'pare' continua excluindo mesmo para declined", () => {
    expect(evaluateSurvey(candidate({ followUpReason: "stop", followUpActive: true }), SETTINGS, NOW)).toEqual({ action: "skip", reason: "opt_out" });
  });
  it("conversa sem canal gravado nunca recebe pelo envio (sem cair no QR)", async () => {
    db.conversation.findFirst.mockResolvedValue({
      id: "conv-1", agentId: "a", isTest: false, needsHuman: false, agentPaused: false, followUpReason: null,
      whatsappProvider: null, lead: { phone: "5511999999999", isTest: false },
    });
    const res = await sendSurvey({ tenantId: TENANT, conversationId: "conv-1", settings: SETTINGS });
    expect(res.status).toBe("skipped");
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
  });
});

describe("rating: seletor de emoji", () => {
  it("U+FE0F não atrapalha a leitura", () => {
    const star = "⭐️";
    expect(parseRating(star.repeat(5))).toBe(5);
    expect(parseRating(`5 ${star}`)).toBe(5);
    expect(parseRating(`4 ${star.repeat(4)}`)).toBe(4);
  });
});

describe("varreduras do worker", () => {
  it("a guarda do follow-up só considera pesquisa real (teste não encerra a esteira)", async () => {
    db.tenantAction.findMany.mockResolvedValueOnce([{ tenantId: TENANT, agentId: "agent-1", config: null }]).mockResolvedValueOnce([]);
    db.conversation.findMany.mockResolvedValue([]);
    await scanAndSendFollowUps(NOW);
    const arg = db.conversation.findMany.mock.calls[0][0] as { include: { satisfactionSurveys: { where: Record<string, unknown> } } };
    expect(arg.include.satisfactionSurveys.where).toMatchObject({ isTest: false });
  });

  it("só olha conversas que já completaram a espera, as mais antigas primeiro", async () => {
    db.satisfactionSurveySettings.findMany.mockResolvedValue([{ tenantId: TENANT, enabled: true, delayMinutes: 180 }]);
    db.tenantAction.findMany.mockResolvedValue([]);
    db.conversation.findMany.mockResolvedValue([]);
    db.satisfactionSurvey.findMany.mockResolvedValue([]);
    await scanSatisfactionSurveys(NOW);
    const arg = db.conversation.findMany.mock.calls[0][0] as { where: { lastInboundAt: { gte: Date; lte: Date } }; orderBy: unknown };
    expect(arg.where.lastInboundAt.lte).toEqual(new Date(NOW.getTime() - 180 * 60_000));
    expect(arg.where.lastInboundAt.gte).toEqual(new Date(NOW.getTime() - 24 * 3_600_000));
    expect(arg.orderBy).toEqual({ lastInboundAt: "asc" });
  });

  it("pesquisa de teste não segura a regra dos 30 dias nem o episódio", async () => {
    db.satisfactionSurveySettings.findMany.mockResolvedValue([{ tenantId: TENANT, enabled: true, delayMinutes: 180 }]);
    db.tenantAction.findMany.mockResolvedValue([]);
    db.conversation.findMany.mockResolvedValue([{
      id: "conv-1", agentId: "agent-1", isTest: false, needsHuman: false, agentPaused: false, whatsappProvider: "meta",
      followUpReason: null, followUpSentAt: null, followUpStep: 0, lastInboundAt: ago(240),
      agent: { enabled: true }, lead: { phone: "5511999999999", isTest: false, appointments: [] },
    }]);
    // Só uma pesquisa de teste recente; nenhuma real.
    db.satisfactionSurvey.findMany.mockImplementation(async (arg: { where?: { conversationId?: string } }) =>
      arg.where?.conversationId ? [{ status: "completed", sentAt: ago(10), createdAt: ago(10), isTest: true }] : []);
    db.message.findMany.mockResolvedValue([
      // Mais recente primeiro, como a consulta do worker.
      { role: "assistant", sentBy: "agent", createdAt: ago(240) }, { role: "user", sentBy: null, createdAt: ago(250) },
      { role: "assistant", sentBy: "agent", createdAt: ago(299) }, { role: "user", sentBy: null, createdAt: ago(300) },
    ]);
    db.reportEvent.count.mockResolvedValue(0);
    db.conversation.findFirst.mockResolvedValue({
      id: "conv-1", agentId: "agent-1", isTest: false, needsHuman: false, agentPaused: false, followUpReason: null,
      whatsappProvider: "meta", lead: { phone: "5511999999999", isTest: false },
    });
    db.whatsappInstance.findMany.mockResolvedValue([{
      provider: "meta", status: "connected", externalId: "meta-1", agentReplies: true,
      metaPhoneNumberId: null, metaBusinessAccountId: null, metaAccessTokenEncrypted: null,
    }]);
    const res = await scanSatisfactionSurveys(NOW);
    expect(res.sent).toBe(1);
    expect(provider.sendRatingPrompt).toHaveBeenCalledTimes(1);
  });
});

describe("classificação", () => {
  it("só aceita chaves do conjunto fechado", () => {
    expect(parseTopics('["demora","preco","xpto"]')).toEqual(["demora", "preco"]);
    expect(parseTopics("[]")).toEqual([]);
    expect(parseTopics("sem formato")).toBeNull();
    expect(parseTopics('Resposta: ["tom_robotico"]')).toEqual(["tom_robotico"]);
  });
  it("limita a 3 e remove repetidas", () => {
    expect(cleanTopics(["demora", "demora", "preco", "outro", "nao_entendeu"])).toEqual(["demora", "preco", "outro"]);
  });
});

describe("agregados do painel", () => {
  const rated = (rating: number, topics: string[] = [], hasComment = false, classified = true) => ({ rating, topics, hasComment, classified });

  it("média de uma casa, distribuição que soma as respostas e taxa limitada a 100%", () => {
    const s = summarizeSurveys(5, [rated(5), rated(4), rated(4), rated(1), rated(2)]);
    expect(s.answered).toBe(5);
    expect(s.distribution).toEqual([1, 1, 0, 2, 1]);
    expect(s.distribution.reduce((a, b) => a + b, 0)).toBe(s.answered);
    expect(s.average).toBe(3.2);
    expect(s.responseRatePercent).toBe(100);
    expect(summarizeSurveys(2, [rated(5), rated(5), rated(5)]).responseRatePercent).toBe(100);
    expect(summarizeSurveys(0, []).average).toBeNull();
    expect(summarizeSurveys(0, []).responseRatePercent).toBeNull();
  });

  it("top 3 só com chaves do conjunto fechado; comentário sem motivo é contado à parte", () => {
    const s = summarizeSurveys(9, [
      rated(1, ["demora"], true), rated(2, ["demora", "preco"], true), rated(2, ["preco"], true),
      rated(3, ["tom_robotico"], true), rated(3, ["nao_entendeu"], true), rated(4, ["chave_inventada"], true),
      rated(4, [], true, false), rated(5),
    ]);
    expect(s.topTopics.map((t) => t.key)).toEqual(["demora", "preco", "nao_entendeu"]);
    expect(s.topics.some((t) => t.key === "chave_inventada")).toBe(false);
    expect(s.unclassified).toBe(1);
    expect(s.withComment).toBe(7);
  });

  it("a média só é confiável com 5 respostas", () => {
    expect(averageIsReliable(4)).toBe(false);
    expect(averageIsReliable(5)).toBe(true);
  });
});

describe("configuração: validação e gravação", () => {
  const form = { enabled: "on", delayMinutes: "180", windowStartHour: "8", windowEndHour: "20", timezone: "America/Sao_Paulo", ratingText: "", lowText: "", highText: "", thanksText: "" };

  it("recusa espera fora de 30 min a 20 h e janela invertida", () => {
    expect(surveySettingsFormSchema.safeParse({ ...form, delayMinutes: "10" }).success).toBe(false);
    expect(surveySettingsFormSchema.safeParse({ ...form, delayMinutes: "1300" }).success).toBe(false);
    expect(surveySettingsFormSchema.safeParse({ ...form, windowStartHour: "20", windowEndHour: "8" }).success).toBe(false);
    expect(surveySettingsFormSchema.safeParse({ ...form, timezone: "Marte/Olympus" }).success).toBe(false);
    expect(surveySettingsFormSchema.safeParse(form).success).toBe(true);
  });

  it("texto vazio ou igual ao padrão não é gravado (volta ao padrão)", async () => {
    db.satisfactionSurveySettings.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => args.create);
    const parsed = surveySettingsFormSchema.parse({ ...form, ratingText: DEFAULT_SURVEY_TEXTS.rating, lowText: "Sentimos muito.", highText: "" });
    const saved = await saveSurveySettings(TENANT, parsed);
    const call = db.satisfactionSurveySettings.upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(call.create).toMatchObject({ ratingText: null, lowText: "Sentimos muito.", highText: null, thanksText: null, enabled: true });
    expect(saved.texts.low).toBe("Sentimos muito.");
    expect(saved.texts.rating).toBe(DEFAULT_SURVEY_TEXTS.rating);
  });
});

describe("envio de teste", () => {
  it("normaliza o número e recusa o que não parece telefone", () => {
    expect(normalizeTestPhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeTestPhone("+55 11 98765-4321")).toBe("5511987654321");
    expect(normalizeTestPhone("12345")).toBeNull();
  });

  const FULL = {
    id: "conv-1", agentId: "agent-1", isTest: false, needsHuman: false, agentPaused: false, followUpReason: null as string | null,
    whatsappProvider: "meta" as string | null, lead: { phone: "5511987654321", isTest: false },
  };
  const lookup = (over: Record<string, unknown> = {}) => ({
    id: "conv-1", isTest: false, whatsappProvider: "meta", lastInboundAt: new Date(Date.now() - 2 * 3_600_000), lead: { isTest: false }, ...over,
  });
  function setup(found: unknown, full: Record<string, unknown> = {}) {
    db.conversation.findFirst.mockReset();
    db.conversation.findFirst.mockResolvedValueOnce(found).mockResolvedValueOnce({ ...FULL, ...full });
    db.satisfactionSurvey.findFirst.mockResolvedValue(null);
    db.whatsappInstance.findMany.mockResolvedValue([{
      provider: "meta", status: "connected", externalId: "meta-1", agentReplies: true,
      metaPhoneNumberId: null, metaBusinessAccountId: null, metaAccessTokenEncrypted: null,
    }, {
      provider: "evolution", status: "connected", externalId: "evo-1", agentReplies: true,
      metaPhoneNumberId: null, metaBusinessAccountId: null, metaAccessTokenEncrypted: null,
    }]);
  }

  it("número que nunca escreveu: recusa com orientação e não cria lead, conversa nem pesquisa", async () => {
    setup(null);
    const res = await sendSurveyTest(TENANT, "(11) 98765-4321");
    expect(res).toEqual({ ok: false, error: TEST_NEEDS_MESSAGE });
    expect(TEST_NEEDS_MESSAGE).toContain("Mande uma mensagem para o número da clínica");
    expect(engine.getOrCreateConversation).not.toHaveBeenCalled();
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(provider.sendRatingPrompt).not.toHaveBeenCalled();
  });

  it("conversa sem canal gravado ou sem mensagem do contato nas últimas 24h é recusada (nunca cai no QR)", async () => {
    for (const found of [
      lookup({ whatsappProvider: null }),
      lookup({ lastInboundAt: null }),
      lookup({ lastInboundAt: new Date(Date.now() - 25 * 3_600_000) }),
    ]) {
      setup(found);
      expect(await sendSurveyTest(TENANT, "(11) 98765-4321")).toEqual({ ok: false, error: TEST_NEEDS_MESSAGE });
    }
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("não usa o número do chat de teste do painel", async () => {
    setup(lookup({ isTest: true }));
    const res = await sendSurveyTest(TENANT, "(11) 98765-4321");
    expect(res.ok).toBe(false);
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it("o teste também respeita 'pare' e número bloqueado", async () => {
    setup(lookup(), { followUpReason: "stop" });
    expect((await sendSurveyTest(TENANT, "(11) 98765-4321")).ok).toBe(false);
    setup(lookup());
    blocked.isPhoneBlocked.mockResolvedValue(true);
    expect((await sendSurveyTest(TENANT, "(11) 98765-4321")).ok).toBe(false);
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
    expect(provider.sendRatingPrompt).not.toHaveBeenCalled();
  });

  it("pesquisa já aberta no número: recusa", async () => {
    setup(lookup());
    db.satisfactionSurvey.findFirst.mockResolvedValue({ id: "open" });
    expect((await sendSurveyTest(TENANT, "(11) 98765-4321")).ok).toBe(false);
    expect(db.satisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it("com conversa real nas últimas 24h, envia pelo canal gravado e grava isTest", async () => {
    setup(lookup());
    const res = await sendSurveyTest(TENANT, "(11) 98765-4321");
    expect(res.ok).toBe(true);
    expect(db.satisfactionSurvey.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isTest: true, conversationId: "conv-1", provider: "meta" }) }));
    expect(provider.sendRatingPrompt).toHaveBeenCalledWith("meta-1", "5511987654321", expect.anything());
    expect(engine.getOrCreateConversation).not.toHaveBeenCalled();
  });
});

describe("painel: leitura", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "s1", conversationId: "conv-1", rating: 2, topics: ["demora"], comment: "Falei com Maria Souza no 11 98765-4321 e demorou",
    commentAudioUrl: null, classifiedAt: new Date(), classifiedBy: "ai", ratedAt: NOW, reviewedAt: null,
    agent: { name: "Ana" }, conversation: { lead: { name: "Maria Souza", phone: "5511987654321" } }, ...over,
  });

  beforeEach(() => {
    db.satisfactionSurvey.count.mockResolvedValue(3);
    db.satisfactionSurvey.findMany.mockResolvedValue([row()]);
    db.agent.findMany.mockResolvedValue([{ id: "agent-1", name: "Ana" }]);
  });

  it("para quem não é da clínica o comentário vem mascarado", async () => {
    const masked = await loadSatisfaction(TENANT, { from: ago(60 * 24 * 30), to: NOW }, { maskComments: true });
    expect(masked.rows[0].comment).not.toContain("Maria");
    expect(masked.rows[0].comment).not.toContain("98765");
    const clear = await loadSatisfaction(TENANT, { from: ago(60 * 24 * 30), to: NOW });
    expect(clear.rows[0].comment).toContain("Maria Souza");
  });

  it("a linha nunca leva nome ou telefone do contato", async () => {
    const res = await loadSatisfaction(TENANT, { from: null, to: NOW });
    expect(JSON.stringify(res.rows)).not.toContain("5511987654321");
    expect(Object.keys(res.rows[0])).not.toContain("phone");
    expect(res.summary.average).toBe(2);
  });

  it("consulta sempre pela conta e sem testes", async () => {
    await loadSatisfaction(TENANT, { from: ago(100), to: NOW });
    for (const [arg] of db.satisfactionSurvey.findMany.mock.calls as [{ where: Record<string, unknown> }][]) {
      expect(arg.where).toMatchObject({ tenantId: TENANT, isTest: false });
    }
  });
});
