import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversationFindFirst: vi.fn(),
  conversationUpdateMany: vi.fn(),
  messageFindFirst: vi.fn(),
  redisSet: vi.fn(),
  blocked: vi.fn(),
  channel: vi.fn(),
  send: vi.fn(),
  resolveAgent: vi.fn(),
  runAgentTurn: vi.fn(),
  provider: { isConfigured: vi.fn(() => true) },
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  conversation: { findFirst: mocks.conversationFindFirst, updateMany: mocks.conversationUpdateMany },
  message: { findFirst: mocks.messageFindFirst },
} }));
vi.mock("@/lib/redis", () => ({ redis: { set: mocks.redisSet } }));
vi.mock("@/modules/whatsapp/blocklist", () => ({ isPhoneBlocked: mocks.blocked }));
vi.mock("@/modules/whatsapp/instances", () => ({
  findWhatsappChannel: mocks.channel,
  channelProvider: (channel: { provider: string }) => channel.provider,
  agentRepliesOn: (channel: { agentReplies?: boolean }) => channel.agentReplies !== false,
  setConversationChannel: vi.fn(async () => {}),
}));
vi.mock("@/modules/whatsapp/meta-config", () => ({ getWhatsAppProviderForInstance: () => mocks.provider }));
vi.mock("@/modules/whatsapp/send-agent-reply", () => ({ sendAgentReply: mocks.send }));
vi.mock("@/modules/agent-engine/orchestrator", () => ({
  resolveAgent: mocks.resolveAgent,
  runAgentTurn: mocks.runAgentTurn,
}));

import { recoverPendingAgentReply } from "@/modules/agent-engine/recover-pending";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conversationFindFirst.mockResolvedValue({
    id: "conversa-1",
    leadId: "lead-1",
    isTest: false,
    lastInboundAt: new Date(),
    whatsappProvider: null,
    lead: { phone: "5514999999999", isTest: false },
    messages: [{ id: "entrada-1", role: "user", content: "Quero informações", audioUrl: null }],
  });
  mocks.messageFindFirst.mockResolvedValue({ id: "entrada-1" });
  mocks.redisSet.mockResolvedValue("OK");
  mocks.blocked.mockResolvedValue(false);
  mocks.channel.mockResolvedValue({ provider: "evolution", externalId: "instancia-1", status: "connected" });
  mocks.resolveAgent.mockResolvedValue({ id: "agente-1", enabled: true, speakReplies: false, voiceId: null });
  mocks.runAgentTurn.mockResolvedValue({ status: "ok", reply: "Olá! Qual procedimento?", replyMessageId: "saida-1" });
  mocks.send.mockResolvedValue(undefined);
});

it("faz o agente responder à última mensagem já registrada, sem criar outra entrada", async () => {
  const result = await recoverPendingAgentReply("tenant-1", "conversa-1", "agente-1");

  expect(result).toEqual({ status: "sent" });
  expect(mocks.runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: "conversa-1",
    agentId: "agente-1",
    userMessage: "Quero informações",
    existingUserMessageId: "entrada-1",
  }));
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
    phone: "5514999999999", reply: "Olá! Qual procedimento?", replyMessageId: "saida-1",
  }));
});

it("não responde de novo se já há uma resposta no histórico", async () => {
  mocks.conversationFindFirst.mockResolvedValueOnce({
    id: "conversa-1", leadId: "lead-1", isTest: false, lead: { phone: "5514999999999", isTest: false },
    messages: [{ id: "saida-1", role: "assistant", content: "Olá!", audioUrl: null }],
  });

  expect(await recoverPendingAgentReply("tenant-1", "conversa-1", "agente-1")).toEqual({ status: "none" });
  expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("trava cliques simultâneos antes de gerar ou enviar", async () => {
  mocks.redisSet.mockResolvedValue(null);

  expect(await recoverPendingAgentReply("tenant-1", "conversa-1", "agente-1")).toEqual({ status: "in_progress" });
  expect(mocks.runAgentTurn).not.toHaveBeenCalled();
});

it("respeita a janela de 24 horas da Meta", async () => {
  mocks.conversationFindFirst.mockResolvedValueOnce({
    id: "conversa-1", leadId: "lead-1", isTest: false,
    lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000), whatsappProvider: "meta",
    lead: { phone: "5514999999999", isTest: false },
    messages: [{ id: "entrada-1", role: "user", content: "Olá", audioUrl: null }],
  });
  mocks.channel.mockResolvedValue({ provider: "meta", externalId: "instancia-1", status: "connected" });

  const result = await recoverPendingAgentReply("tenant-1", "conversa-1", "agente-1");

  expect(result.status).toBe("failed");
  expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
