import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, WhatsAppProvider } from "@/modules/whatsapp/provider";

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
  transcribeAudio: vi.fn(),
  storeVoiceMessage: vi.fn(),
  speakReply: vi.fn(),
  getMediaAsBase64: vi.fn(),
  sendAudio: vi.fn(),
  sendMessage: vi.fn(),
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
vi.mock("@/modules/whatsapp/blocklist", () => ({ isPhoneBlocked: vi.fn(async () => false) }));
vi.mock("@/modules/agent-engine/conversation", () => ({
  appendMessage: mocks.appendMessage,
  getOrCreateConversation: mocks.getOrCreateConversation,
}));
vi.mock("@/modules/agent-engine/orchestrator", () => ({
  resolveAgent: mocks.resolveAgent,
  runAgentTurn: mocks.runAgentTurn,
}));
vi.mock("@/modules/agent-engine/handoff", () => ({ notifyHandoffGroup: vi.fn() }));
vi.mock("@/modules/ai/transcribe", () => ({ transcribeAudio: mocks.transcribeAudio }));
vi.mock("@/modules/voice/storage", () => ({ storeVoiceMessage: mocks.storeVoiceMessage }));
vi.mock("@/modules/voice/reply", () => ({ speakReply: mocks.speakReply }));

import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";
import { opusAudio } from "./fixtures/ogg";

const incoming: IncomingMessage = {
  instanceExternalId: "inst-1",
  fromPhone: "5511999999999",
  text: "",
  isGroup: false,
  hasAudio: true,
  messageKeyId: "audio-in-1",
  isFromMe: false,
};

const contactEvidence = {
  tenantId: "tenant-1",
  at: expect.any(Date),
  proof: { provider: "evolution", externalId: "inst-1", sender: incoming.fromPhone, receiver: null },
};

const provider = {
  name: "evolution",
  getMediaAsBase64: mocks.getMediaAsBase64,
  sendAudio: mocks.sendAudio,
  sendMessage: mocks.sendMessage,
} as unknown as WhatsAppProvider;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messageFindUnique.mockResolvedValue(null);
  mocks.instanceFindFirst.mockResolvedValue({ tenantId: "tenant-1", status: "connected", tenant: {} });
  mocks.getOrCreateConversation.mockResolvedValue({
    lead: { id: "lead-1", isTest: false },
    conversation: { id: "conversa-1" },
  });
  mocks.resolveAgent.mockResolvedValue({ listenAudio: true, speakReplies: true, voiceId: "voz-1" });
  mocks.getMediaAsBase64.mockResolvedValue({ base64: Buffer.from("audio recebido").toString("base64"), mime: "audio/ogg" });
  mocks.transcribeAudio.mockResolvedValue("Quero agendar");
  mocks.storeVoiceMessage.mockResolvedValue("https://cdn.test/recebido.ogg");
  mocks.runAgentTurn.mockResolvedValue({ reply: "Claro", status: "ok", replyMessageId: "reply-1" });
  mocks.speakReply.mockResolvedValue({ spoken: false, reason: "off" });
  mocks.sendMessage.mockResolvedValue("wa-reply-1");
  mocks.messageUpdate.mockResolvedValue({});
  mocks.conversationUpdate.mockResolvedValue({});
});

describe("áudio no histórico do WhatsApp", () => {
  it("anexa o áudio recebido ao mesmo turno que guarda a transcrição", async () => {
    await processIncomingWhatsapp(incoming, provider);

    expect(mocks.runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: "Quero agendar",
      incomingAudioUrl: "https://cdn.test/recebido.ogg",
      incomingMessageKeyId: "audio-in-1",
    }));
    expect(mocks.storeVoiceMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", conversationId: "conversa-1", mime: "audio/ogg",
    }));
  });

  it("mostra o áudio recebido mesmo com a escuta da IA desligada", async () => {
    mocks.resolveAgent.mockResolvedValue({ listenAudio: false });

    await processIncomingWhatsapp(incoming, provider);

    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    // O arquivo do teste não é OGG e a Evolution não mandou duração: não medido.
    expect(mocks.appendMessage).toHaveBeenCalledWith(
      "conversa-1", "user", "[Áudio]", undefined, "audio-in-1", "https://cdn.test/recebido.ogg", null, contactEvidence,
    );
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("mantém o player quando não há transcrição e não aciona a IA", async () => {
    mocks.transcribeAudio.mockResolvedValue(null);

    await processIncomingWhatsapp(incoming, provider);

    expect(mocks.appendMessage).toHaveBeenCalledWith(
      "conversa-1", "user", "[Áudio]", undefined, "audio-in-1", "https://cdn.test/recebido.ogg", null, contactEvidence,
    );
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("mostra o áudio enviado no celular como resposta humana", async () => {
    mocks.messageFindUnique.mockResolvedValue(null);

    await processIncomingWhatsapp({ ...incoming, isFromMe: true, messageKeyId: "audio-out-1" }, provider);

    // CRM-09: resposta pelo celular da clínica, sem responsável = não identificada.
    expect(mocks.appendMessage).toHaveBeenCalledWith(
      "conversa-1", "assistant", "Quero agendar", "human", "audio-out-1", "https://cdn.test/recebido.ogg", null,
      undefined, { via: "phone", userId: null },
    );
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conversa-1" }, data: { needsHuman: false, agentPaused: true },
    });
  });

  it("não duplica o áudio que o próprio sistema enviou", async () => {
    mocks.messageFindUnique.mockResolvedValue({ id: "reply-1" });

    await processIncomingWhatsapp({ ...incoming, isFromMe: true, messageKeyId: "wa-reply-1" }, provider);

    expect(mocks.getMediaAsBase64).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("usa a duração informada pela Evolution sem precisar ler o arquivo", async () => {
    await processIncomingWhatsapp({ ...incoming, audioSeconds: 256 }, provider);

    expect(mocks.runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ incomingAudioSeconds: 256 }));
  });

  it("mede o arquivo quando o provedor não informa a duração (Meta)", async () => {
    mocks.getMediaAsBase64.mockResolvedValue({ base64: opusAudio(288).toString("base64"), mime: "audio/ogg" });

    await processIncomingWhatsapp({ ...incoming, mediaId: "media-1" }, { ...provider, name: "meta" } as WhatsAppProvider);

    expect(mocks.runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ incomingAudioSeconds: 288 }));
  });

  it("guarda a duração informada mesmo quando o download da mídia falha", async () => {
    mocks.getMediaAsBase64.mockRejectedValue(new Error("mídia expirada"));

    await processIncomingWhatsapp({ ...incoming, audioSeconds: 90 }, provider);

    expect(mocks.appendMessage).toHaveBeenCalledWith("conversa-1", "user", "[Áudio]", undefined, "audio-in-1", null, 90, contactEvidence);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("guarda a resposta falada pela IA para reprodução", async () => {
    mocks.speakReply.mockResolvedValue({ spoken: true, audio: Buffer.from("resposta"), mime: "audio/ogg" });
    mocks.sendAudio.mockResolvedValue("wa-audio-out-1");
    mocks.storeVoiceMessage.mockResolvedValueOnce("https://cdn.test/resposta.ogg");

    await processIncomingWhatsapp({ ...incoming, hasAudio: false, text: "Oi" }, provider);

    expect(mocks.messageUpdate).toHaveBeenCalledWith({
      where: { id: "reply-1" },
      data: { whatsappMessageId: "wa-audio-out-1", audioUrl: "https://cdn.test/resposta.ogg" },
    });
  });
});
