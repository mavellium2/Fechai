import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, WhatsAppProvider } from "@/modules/whatsapp/provider";

/**
 * Entrada de mensagens com as duas conexões: a conversa lembra por qual número
 * o contato fala, e a resposta sai pelo mesmo número em que ele escreveu.
 *
 * É esse registro (`Conversation.whatsappProvider`) que depois decide de qual
 * número saem a resposta manual, o follow-up e o lembrete. Errar aqui manda a
 * mensagem pelo número que o paciente nunca viu.
 */

const mocks = vi.hoisted(() => ({
  instanceFindFirst: vi.fn(),
  messageFindUnique: vi.fn(),
  messageFindFirst: vi.fn(),
  messageUpdate: vi.fn(),
  conversationUpdate: vi.fn(),
  getOrCreateConversation: vi.fn(),
  appendMessage: vi.fn(),
  resolveAgent: vi.fn(),
  runAgentTurn: vi.fn(),
  speakReply: vi.fn(),
  getMediaAsBase64: vi.fn(),
  transcribeAudio: vi.fn(),
  handleBlockButton: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappInstance: { findFirst: mocks.instanceFindFirst },
    message: {
      findUnique: mocks.messageFindUnique,
      findFirst: mocks.messageFindFirst,
      update: mocks.messageUpdate,
    },
    conversation: { update: mocks.conversationUpdate },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/whatsapp/blocklist", () => ({ isPhoneBlocked: vi.fn(async () => false) }));
vi.mock("@/modules/agent-engine/conversation", () => ({
  appendMessage: mocks.appendMessage,
  getOrCreateConversation: mocks.getOrCreateConversation,
}));
vi.mock("@/modules/agent-engine/orchestrator", () => ({
  resolveAgent: mocks.resolveAgent,
  runAgentTurn: mocks.runAgentTurn,
}));
vi.mock("@/modules/agent-engine/handoff", () => ({ notifyHandoffGroup: vi.fn(async () => {}) }));
vi.mock("@/modules/ai/transcribe", () => ({ transcribeAudio: mocks.transcribeAudio }));
vi.mock("@/modules/whatsapp/button-reply", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/whatsapp/button-reply")>(),
  handleBlockButton: mocks.handleBlockButton,
}));
vi.mock("@/modules/voice/reply", () => ({ speakReply: mocks.speakReply }));
vi.mock("@/modules/voice/storage", () => ({ storeVoiceMessage: vi.fn(async () => null) }));

import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";

const sendMessage = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "key-resposta");
const fakeProvider = (name: string) =>
  ({ name, sendMessage, sendAudio: vi.fn(), getMediaAsBase64: mocks.getMediaAsBase64 }) as unknown as WhatsAppProvider;

const BASE: IncomingMessage = {
  instanceExternalId: "numero-1",
  fromPhone: "5511999999999",
  fromName: "Maria",
  text: "Oi, queria marcar uma avaliação",
  isGroup: false,
  hasAudio: false,
  messageKeyId: "msg-1",
};

/** As atualizações de canal (e só elas) que a entrada gravou na conversa. */
const canaisGravados = () =>
  mocks.conversationUpdate.mock.calls
    .map(([arg]) => arg as { where: { id: string }; data: Record<string, unknown> })
    .filter((arg) => "whatsappProvider" in arg.data)
    .map((arg) => arg.data.whatsappProvider);

function conversa(whatsappProvider: string | null, agentId: string | null = null) {
  mocks.getOrCreateConversation.mockResolvedValue({
    lead: { id: "lead-1", isTest: false },
    conversation: { id: "conv-1", whatsappProvider, agentId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.instanceFindFirst.mockResolvedValue({
    tenantId: "tenant-1",
    status: "connected",
    tenant: { whatsappIgnoreGroups: false },
  });
  mocks.messageFindUnique.mockResolvedValue(null);
  mocks.messageFindFirst.mockResolvedValue(null);
  mocks.messageUpdate.mockResolvedValue({});
  mocks.conversationUpdate.mockResolvedValue({});
  mocks.appendMessage.mockResolvedValue({ id: "m-1" });
  mocks.resolveAgent.mockResolvedValue({ id: "agente-1", stopOnEmoji: true, listenAudio: false, speakReplies: false });
  mocks.runAgentTurn.mockResolvedValue({ reply: "Claro! Qual dia fica bom?", status: "ok", replyMessageId: "m-resp" });
  mocks.speakReply.mockResolvedValue({ spoken: false });
  mocks.handleBlockButton.mockResolvedValue({ handled: true });
  conversa(null);
});

describe("Meta somente para Disparos", () => {
  beforeEach(() => {
    mocks.instanceFindFirst.mockResolvedValue({
      tenantId: "tenant-1", status: "connected", agentReplies: false, tenant: {},
    });
  });

  it.each([
    { text: "Quero agendar" },
    { text: "", hasAudio: true },
    { text: "Resposta da equipe", isFromMe: true },
    { text: "", hasAudio: true, isFromMe: true },
    { text: "👍", isReaction: true, isFromMe: true },
    { text: "Eu quero", viaButton: true },
  ])("ignora a cópia da Meta sem histórico, mídia, pausa ou troca de canal: %j", async (message) => {
    const result = await processIncomingWhatsapp({ ...BASE, ...message }, fakeProvider("meta"));

    expect(result.body).toMatchObject({ ignored: "Meta somente para disparos" });
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.getMediaAsBase64).not.toHaveBeenCalled();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
    expect(mocks.resolveAgent).not.toHaveBeenCalled();
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mocks.handleBlockButton).not.toHaveBeenCalled();
  });

  it("o QR continua recebendo a mensagem para a equipe quando sua IA está desligada", async () => {
    await processIncomingWhatsapp(BASE, fakeProvider("evolution"));

    expect(mocks.appendMessage).toHaveBeenCalledWith(
      "conv-1", "user", BASE.text, undefined, "msg-1", undefined, undefined,
    );
    expect(canaisGravados()).toEqual(["evolution"]);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it.each([true, false])("registra um único turno pelo QR com ids diferentes e Meta chegando primeiro: %s", async (metaFirst) => {
    mocks.instanceFindFirst.mockImplementation(async ({ where }) => ({
      tenantId: "tenant-1", status: "connected", agentReplies: where.provider !== "meta", tenant: {},
    }));
    const meta = () => processIncomingWhatsapp({ ...BASE, messageKeyId: "wamid.copia" }, fakeProvider("meta"));
    const qr = () => processIncomingWhatsapp({ ...BASE, messageKeyId: "qr-original" }, fakeProvider("evolution"));
    if (metaFirst) { await meta(); await qr(); }
    else { await qr(); await meta(); }

    expect(mocks.getOrCreateConversation).toHaveBeenCalledOnce();
    expect(mocks.runAgentTurn).toHaveBeenCalledOnce();
    expect(mocks.runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ incomingMessageKeyId: "qr-original" }));
    expect(canaisGravados()).toEqual(["evolution"]);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("preserva o pedido para parar por botão sem tomar o canal do QR", async () => {
    conversa("evolution");
    const provider = fakeProvider("meta");
    const result = await processIncomingWhatsapp({ ...BASE, text: "Parar mensagens", viaButton: true }, provider);

    expect(result.body).toMatchObject({ silent: "pediu para parar (botão)" });
    expect(mocks.handleBlockButton).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", conversationId: "conv-1", text: "Parar mensagens", provider,
    }));
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("pede reentrega se não conseguiu registrar o pedido para parar", async () => {
    mocks.handleBlockButton.mockResolvedValue({ handled: false });
    const result = await processIncomingWhatsapp({ ...BASE, text: "Bloquear", viaButton: true }, fakeProvider("meta"));

    expect(result.status).toBe(500);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });
});

describe("Canal da conversa na entrada", () => {
  it("entrega a próxima mensagem ao agente atribuído à conversa", async () => {
    conversa("evolution", "agente-reativado");
    mocks.resolveAgent.mockImplementation(async (_tenantId: string, agentId?: string) => ({
      id: agentId ?? "agente-1", stopOnEmoji: true, listenAudio: false, speakReplies: false,
    }));

    await processIncomingWhatsapp(BASE, fakeProvider("evolution"));

    expect(mocks.resolveAgent).toHaveBeenCalledWith("tenant-1", "agente-reativado");
    expect(mocks.runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agente-reativado", conversationId: "conv-1" }),
    );
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("mensagem pela Meta: a conversa passa a ser da Meta e a resposta sai pelo mesmo número", async () => {
    conversa("evolution");

    const result = await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(result.body).toEqual({ ok: true });
    expect(canaisGravados()).toEqual(["meta"]);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { whatsappProvider: "meta" },
    });
    // Sai pelo número em que a mensagem chegou, não por "o da conta".
    expect(sendMessage).toHaveBeenCalledWith("numero-1", "5511999999999", "Claro! Qual dia fica bom?");
  });

  it("mensagem pelo QR de uma conversa sem canal: fica registrada como do QR", async () => {
    conversa(null);

    await processIncomingWhatsapp(BASE, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual(["evolution"]);
  });

  it("já era desse número: não escreve no banco a cada mensagem", async () => {
    conversa("meta");

    await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(canaisGravados()).toEqual([]);
  });

  it("o contato passou a escrever pelo outro número: o canal acompanha a última mensagem", async () => {
    conversa("meta");

    await processIncomingWhatsapp(BASE, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual(["evolution"]);
  });

  it("a instância é procurada pelo provedor que recebeu — o mesmo id em provedores diferentes não se confunde", async () => {
    await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(mocks.instanceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: "numero-1", provider: "meta" } }),
    );
  });

  it("eco da própria resposta (mesmo id) não mexe no canal", async () => {
    conversa("meta");
    mocks.messageFindUnique.mockResolvedValue({ id: "ja-gravada" });

    await processIncomingWhatsapp({ ...BASE, isFromMe: true }, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual([]);
  });

  it("eco por texto recente (sem id conhecido) também não mexe no canal", async () => {
    conversa("meta");
    mocks.messageFindFirst.mockResolvedValue({ id: "resposta-do-agente" });

    await processIncomingWhatsapp({ ...BASE, isFromMe: true, messageKeyId: undefined }, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual([]);
  });

  it("atendente escrevendo pelo próprio celular assume a conversa nesse número", async () => {
    conversa(null);

    const result = await processIncomingWhatsapp({ ...BASE, isFromMe: true }, fakeProvider("evolution"));

    expect(result.body).toMatchObject({ silent: "manual pelo whatsapp" });
    expect(canaisGravados()).toEqual(["evolution"]);
  });

  it("falha ao anotar o canal não derruba a resposta ao cliente", async () => {
    conversa("evolution");
    mocks.conversationUpdate.mockRejectedValue(new Error("banco fora do ar"));

    const result = await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(result.body).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("provedor desconhecido não grava canal nenhum", async () => {
    conversa(null);

    await processIncomingWhatsapp(BASE, fakeProvider("widget"));

    expect(canaisGravados()).toEqual([]);
  });
});
