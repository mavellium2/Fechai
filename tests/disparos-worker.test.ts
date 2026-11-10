import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  campaigns: vi.fn(),
  campaignUpdate: vi.fn(),
  campaignCount: vi.fn(),
  receiptFind: vi.fn(),
  recipients: vi.fn(),
  recipientUpdate: vi.fn(),
  recipientOne: vi.fn(),
  recipientCount: vi.fn(),
  block: vi.fn(),
  stop: vi.fn(),
  conversation: vi.fn(),
  conversationUpdate: vi.fn(),
  message: vi.fn(),
  connection: vi.fn(),
  templates: vi.fn(),
  send: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    broadcastCampaign: {
      findMany: mocks.campaigns,
      findFirst: mocks.campaignCount,
      updateMany: mocks.campaignUpdate,
      count: mocks.campaignCount,
    },
    broadcastRecipient: {
      findMany: mocks.recipients,
      updateMany: mocks.recipientUpdate,
      update: mocks.recipientOne,
      count: mocks.recipientCount,
    },
    whatsappBlockedNumber: { findUnique: mocks.block },
    conversation: { findFirst: mocks.stop, update: mocks.conversationUpdate },
    message: { create: mocks.message },
    $transaction: mocks.transaction,
    $queryRaw: mocks.campaigns,
    broadcastReceipt: { findMany: mocks.receiptFind },
  },
}));
vi.mock("@/modules/broadcasts/connection", () => ({
  getBroadcastConnection: mocks.connection,
}));
vi.mock("@/modules/agent-engine/conversation", () => ({
  getOrCreateConversation: mocks.conversation,
}));
import { prisma } from "@/lib/prisma";
import { scanBroadcasts } from "@/modules/broadcasts/worker";
import { MetaBroadcastRejected } from "@/modules/whatsapp/meta";

const template = {
  id: "t",
  name: "ola",
  language: "pt_BR",
  header: "",
  footer: "",
  body: "Olá {{1}}",
  parameterCount: 1,
};
const campaign = {
  id: "c",
  tenantId: "tenant-a",
  phoneNumberId: "p",
  scheduledAt: null,
  timezone: "America/Sao_Paulo",
  windowStart: 0,
  windowEnd: 1440,
  retryCount: 0,
  template,
};
const recipient = {
  id: "r",
  isTest: false,
  phone: "5511987654321",
  name: "Ana",
  parameters: ["Ana"],
  content: "Olá Ana",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.campaigns.mockResolvedValue([campaign]);
  mocks.campaignUpdate.mockResolvedValue({ count: 1 });
  mocks.campaignCount.mockResolvedValue({ status: "queued" });
  mocks.receiptFind.mockResolvedValue([]);
  mocks.recipients.mockResolvedValue([recipient]);
  mocks.recipientUpdate.mockResolvedValue({ count: 1 });
  mocks.recipientOne.mockResolvedValue({});
  mocks.recipientCount.mockResolvedValue(0);
  mocks.block.mockResolvedValue(null);
  mocks.stop.mockResolvedValue(null);
  mocks.conversationUpdate.mockResolvedValue({});
  mocks.conversation.mockResolvedValue({
    conversation: { id: "conv-a" },
    lead: { status: "new" },
  });
  mocks.connection.mockResolvedValue({
    phoneNumberId: "p",
    provider: {
      listBroadcastTemplates: mocks.templates,
      sendBroadcastTemplate: mocks.send,
    },
  });
  mocks.templates.mockResolvedValue([template]);
  mocks.send.mockResolvedValue("wamid.a");
  mocks.transaction.mockImplementation(async (argument) =>
    typeof argument === "function" ? argument(prisma) : Promise.all(argument),
  );
});

describe("fila de disparos", () => {
  it("não chama a Meta antes do horário agendado", async () => {
    mocks.campaigns.mockResolvedValue([
      { ...campaign, scheduledAt: new Date(Date.now() + 3600000) },
    ]);
    await scanBroadcasts();
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("pausar depois do claim devolve o contato para pendente", async () => {
    mocks.campaignCount.mockResolvedValue({ status: "paused" });
    await scanBroadcasts();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.recipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r", status: "sending" },
        data: { status: "pending", attemptedAt: null },
      }),
    );
  });
  it("falha em uma conta não impede a seguinte e agenda recuo", async () => {
    mocks.campaigns.mockResolvedValue([
      { ...campaign, retryCount: 5 },
      { ...campaign, id: "c2", tenantId: "tenant-b" },
    ]);
    mocks.templates.mockRejectedValueOnce(new Error("temporário"));
    await scanBroadcasts();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c", tenantId: "tenant-a", status: "queued" },
        data: expect.objectContaining({
          retryCount: { increment: 1 },
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });
  it("grava mensagem manual no histórico e encerra campanha", async () => {
    expect(await scanBroadcasts()).toEqual({ scanned: 1, sent: 1 });
    expect(mocks.send).toHaveBeenCalledWith(recipient.phone, template, ["Ana"], null);
    expect(mocks.message).toHaveBeenCalledWith({
      data: {
        conversationId: "conv-a",
        role: "assistant",
        sentBy: "human",
        content: "Olá Ana",
        whatsappMessageId: "wamid.a",
      },
    });
    expect(mocks.campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
  });
  it("contato novo do Disparo nasce como conversa da Meta: a resposta manual não sai pelo QR", async () => {
    await scanBroadcasts();
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv-a" },
      data: { whatsappProvider: "meta" },
    });
  });
  it("quem já fala pelo QR continua nele: o template não abre a janela da Meta", async () => {
    mocks.conversation.mockResolvedValue({
      conversation: { id: "conv-a", whatsappProvider: "evolution" },
      lead: { status: "new" },
    });
    await scanBroadcasts();
    expect(mocks.send).toHaveBeenCalled();
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
  });
  it("não envia se outro worker já reservou o destinatário", async () => {
    mocks.recipientUpdate.mockResolvedValue({ count: 0 });
    await scanBroadcasts();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["blocked", "stop"])("não envia para contato %s", async (reason) => {
    (reason === "blocked" ? mocks.block : mocks.stop).mockResolvedValue({
      id: "blocked",
    });
    await scanBroadcasts();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.recipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "skipped" }),
      }),
    );
  });
  it("pausa e preserva pendentes se a Meta foi desligada", async () => {
    mocks.connection
      .mockResolvedValueOnce({
        phoneNumberId: "p",
        provider: { listBroadcastTemplates: mocks.templates },
      })
      .mockResolvedValueOnce(null);
    await scanBroadcasts();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "paused" }),
      }),
    );
  });
  it("não envia se a campanha foi cancelada depois da reserva", async () => {
    mocks.campaignCount.mockResolvedValue({ status: "cancelled" });
    await scanBroadcasts();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("timeout fica incerto e nunca volta a pendente", async () => {
    mocks.send.mockRejectedValue(new Error("timeout"));
    await scanBroadcasts();
    expect(mocks.recipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r", status: "sending" },
        data: expect.objectContaining({ status: "unknown" }),
      }),
    );
    expect(mocks.message).not.toHaveBeenCalled();
  });
  it("recusa explícita fica como falha, sem interromper a campanha", async () => {
    mocks.send.mockRejectedValue(new MetaBroadcastRejected("Meta recusou"));
    await scanBroadcasts();
    expect(mocks.recipientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r", status: "sending" },
        data: { status: "failed", error: "Meta recusou" },
      }),
    );
  });
  it("envios interrompidos não são reenviados após reiniciar o worker", async () => {
    mocks.campaigns.mockResolvedValue([]);
    await scanBroadcasts();
    expect(mocks.recipientUpdate).toHaveBeenCalledWith({
      where: { status: "sending", attemptedAt: { lt: expect.any(Date) } },
      data: expect.objectContaining({ status: "unknown" }),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
