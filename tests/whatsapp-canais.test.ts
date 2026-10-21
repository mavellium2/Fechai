import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Evolution (QR) e Meta conectadas ao mesmo tempo: por qual número se fala com
 * cada contato.
 *
 * O estrago que cada regra evita é concreto e silencioso — a mensagem sai, só
 * que pelo número errado:
 *
 * - QR: mensagem de um número que o paciente nunca viu é o que leva o WhatsApp a
 *   bloquear o número da clínica, e o bloqueio cala o atendimento de todos;
 * - Meta: texto livre fora da janela de 24h é recusado.
 *
 * Por isso a escolha é por contato (o número em que ele escreveu) e, com esse
 * número fora do ar, o envio espera em vez de trocar de canal.
 */

const db = vi.hoisted(() => ({
  whatsappInstance: { findMany: vi.fn() },
  conversation: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  message: { create: vi.fn() },
  // QR liberado pelo admin, o estado de toda conta que não foi bloqueada.
  tenant: { findUnique: vi.fn(async () => ({ evolutionWhatsappEnabled: true })) },
}));
const qr = vi.hoisted(() => ({
  name: "evolution",
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "key-qr"),
  sendAudio: vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "key-qr-audio"),
}));
const meta = vi.hoisted(() => ({
  name: "meta",
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "wamid.manual"),
  sendAudio: vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "wamid.audio"),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (value: string) => value }));
vi.mock("@/modules/voice/storage", () => ({ storeVoiceMessage: vi.fn(async () => null) }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: (name: string) => (name === "meta" ? meta : qr),
}));

import {
  channelProvider,
  getWhatsappStatus,
  isReadyChannel,
  pickWhatsappChannel,
  setConversationChannel,
  stampLegacyConversations,
  summarizeWhatsappStatus,
} from "@/modules/whatsapp/instances";
import { sendManualReply } from "@/modules/agent-engine/conversation";

const row = (provider: string, status = "connected", externalId: string | null = `${provider}-1`) => ({
  provider,
  status,
  externalId,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  qr.isConfigured.mockReturnValue(true);
  meta.isConfigured.mockReturnValue(true);
  db.conversation.update.mockResolvedValue({});
  db.conversation.updateMany.mockResolvedValue({ count: 0 });
  db.message.create.mockResolvedValue({ id: "m-1" });
  db.whatsappInstance.findMany.mockResolvedValue([]);
});

describe("Escolha da conexão (pickWhatsappChannel)", () => {
  it("só a Meta de pé: é ela, mesmo sem preferência", () => {
    expect(pickWhatsappChannel([row("evolution", "disconnected"), row("meta")])?.provider).toBe("meta");
  });

  it("as duas de pé e sem preferência: a Evolution, o padrão de antes da Meta existir", () => {
    expect(pickWhatsappChannel([row("meta"), row("evolution")])?.provider).toBe("evolution");
  });

  it("a preferência do contato manda quando as duas estão de pé", () => {
    const rows = [row("evolution"), row("meta")];
    expect(pickWhatsappChannel(rows, "meta")?.provider).toBe("meta");
    expect(pickWhatsappChannel(rows, "evolution")?.provider).toBe("evolution");
  });

  it("o número do contato fora do ar devolve null: nunca cai no outro", () => {
    expect(pickWhatsappChannel([row("evolution"), row("meta", "disconnected")], "meta")).toBeNull();
    expect(pickWhatsappChannel([row("evolution", "disconnected"), row("meta")], "evolution")).toBeNull();
    expect(pickWhatsappChannel([row("evolution", "pending_qr"), row("meta")], "evolution")).toBeNull();
  });

  it("linha conectada sem identificador não é uma conexão de pé", () => {
    expect(isReadyChannel(row("meta", "connected", null))).toBe(false);
    expect(pickWhatsappChannel([row("meta", "connected", null)])).toBeNull();
  });

  it("provedor ausente ou desconhecido conta como Evolution, o mesmo critério que escolhe o adapter", () => {
    expect(channelProvider({})).toBe("evolution");
    expect(channelProvider({ provider: null })).toBe("evolution");
    expect(channelProvider({ provider: "outro" })).toBe("evolution");
    expect(channelProvider({ provider: "meta" })).toBe("meta");
    const legacy = { status: "connected", externalId: "inst" };
    expect(pickWhatsappChannel([legacy], "evolution")).toBe(legacy);
    expect(pickWhatsappChannel([legacy], "meta")).toBeNull();
  });

  it.each([undefined, null, "", "whatsapp", "META"])("preferência inválida (%j) é tratada como sem preferência", (preferred) => {
    expect(pickWhatsappChannel([row("meta"), row("evolution")], preferred)?.provider).toBe("evolution");
  });

  it("sem nenhuma linha, não há por onde falar", () => {
    expect(pickWhatsappChannel([])).toBeNull();
    expect(pickWhatsappChannel([], "meta")).toBeNull();
  });
});

describe("Estado da conta em uma palavra (summarizeWhatsappStatus)", () => {
  it("conectada se QUALQUER conexão atende: a outra parada não derruba a conta", () => {
    expect(summarizeWhatsappStatus([{ status: "disconnected" }, { status: "connected" }])).toBe("connected");
    expect(summarizeWhatsappStatus([{ status: "pending_qr" }, { status: "connected" }])).toBe("connected");
  });

  it("aguardando leitura só quando nenhuma atende", () => {
    expect(summarizeWhatsappStatus([{ status: "disconnected" }, { status: "pending_qr" }])).toBe("pending_qr");
  });

  it("desconectada quando nenhuma linha atende — ou não há linha", () => {
    expect(summarizeWhatsappStatus([{ status: "disconnected" }])).toBe("disconnected");
    expect(summarizeWhatsappStatus([{ status: "qualquer coisa" }])).toBe("disconnected");
    expect(summarizeWhatsappStatus([])).toBe("disconnected");
  });

  it("lê do banco pela conta", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ status: "disconnected" }, { status: "connected" }]);
    await expect(getWhatsappStatus("tenant-1")).resolves.toBe("connected");
    // A linha Evolution de conta desligada pelo admin não conta como conectada.
    expect(db.whatsappInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          NOT: { provider: { not: "meta" }, tenant: { evolutionWhatsappEnabled: false } },
        },
      }),
    );
  });
});

describe("Canal da conversa (setConversationChannel)", () => {
  it("grava quando muda: o contato passou a falar por outro número", async () => {
    await setConversationChannel({ id: "c-1", whatsappProvider: "evolution" }, "meta");
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { whatsappProvider: "meta" },
    });
  });

  it("não escreve no banco quando já é esse — o webhook chama a cada mensagem", async () => {
    await setConversationChannel({ id: "c-1", whatsappProvider: "meta" }, "meta");
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("`onlyIfUnset` preenche o vazio, mas não toma a conversa de quem já fala por outro número", async () => {
    await setConversationChannel({ id: "c-1", whatsappProvider: "evolution" }, "meta", { onlyIfUnset: true });
    expect(db.conversation.update).not.toHaveBeenCalled();

    await setConversationChannel({ id: "c-2", whatsappProvider: null }, "meta", { onlyIfUnset: true });
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: "c-2" },
      data: { whatsappProvider: "meta" },
    });
  });

  it("nunca lança: anotar o canal não pode derrubar o atendimento", async () => {
    db.conversation.update.mockRejectedValue(new Error("banco fora do ar"));
    await expect(setConversationChannel({ id: "c-1" }, "meta")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("Conversas de antes da segunda conexão (stampLegacyConversations)", () => {
  it("com UMA linha, ela é a resposta certa para as conversas sem canal", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ provider: "meta" }]);

    await stampLegacyConversations("tenant-1");

    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        isTest: false,
        whatsappProvider: null,
        // Chat do site não é WhatsApp.
        lead: { phone: { not: { startsWith: "web:" } } },
      },
      data: { whatsappProvider: "meta" },
    });
  });

  it.each([[[]], [[{ provider: "evolution" }, { provider: "meta" }]]])(
    "sem linha, ou já com as duas, não mexe em nada: %j",
    async (rows) => {
      db.whatsappInstance.findMany.mockResolvedValue(rows);
      await stampLegacyConversations("tenant-1");
      expect(db.conversation.updateMany).not.toHaveBeenCalled();
    },
  );

  it("nunca lança", async () => {
    db.whatsappInstance.findMany.mockRejectedValue(new Error("banco fora do ar"));
    await expect(stampLegacyConversations("tenant-1")).resolves.toBeUndefined();
  });
});

describe("Resposta manual com as duas conexões (sendManualReply)", () => {
  const QR = { provider: "evolution", status: "connected", externalId: "inst-qr" };
  const META = {
    provider: "meta", status: "connected", externalId: "phone-meta",
    metaPhoneNumberId: "phone-meta", metaBusinessAccountId: "waba-1", metaAccessTokenEncrypted: null,
  };
  const conversa = (whatsappProvider: string | null, over: Record<string, unknown> = {}) =>
    db.conversation.findFirst.mockResolvedValue({
      id: "conv-1", isTest: false, whatsappProvider, lead: { phone: "5514991406457" }, ...over,
    });

  it("responde pela Meta quando o contato escreveu pela Meta, com o QR também de pé", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);
    conversa("meta");

    await expect(sendManualReply("tenant-1", "conv-1", "Olá!")).resolves.toEqual({ ok: true });

    expect(meta.sendMessage).toHaveBeenCalledWith("phone-meta", "5514991406457", "Olá!");
    expect(qr.sendMessage).not.toHaveBeenCalled();
    // O id da mensagem entra no histórico: o webhook não a duplica.
    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: "assistant", sentBy: "human", whatsappMessageId: "wamid.manual" }),
    });
  });

  it("responde pelo QR quando o contato escreveu pelo QR", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([META, QR]);
    conversa("evolution");

    await sendManualReply("tenant-1", "conv-1", "Olá!");

    expect(qr.sendMessage).toHaveBeenCalledWith("inst-qr", "5514991406457", "Olá!");
    expect(meta.sendMessage).not.toHaveBeenCalled();
  });

  it("áudio sai pela conexão do contato", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);
    conversa("meta");

    await sendManualReply("tenant-1", "conv-1", "Olá!", { buffer: Buffer.from("ogg"), mime: "audio/ogg" });

    expect(meta.sendAudio).toHaveBeenCalledWith("phone-meta", "5514991406457", expect.objectContaining({ mime: "audio/ogg" }));
    expect(qr.sendAudio).not.toHaveBeenCalled();
  });

  it("contato cadastrado à mão (sem canal): sai pelo QR e a conversa passa a ser do QR", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);
    conversa(null);

    await sendManualReply("tenant-1", "conv-1", "Olá!");

    expect(qr.sendMessage).toHaveBeenCalledOnce();
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { whatsappProvider: "evolution" },
    });
  });

  it("conversa que já tem canal não é reclassificada por uma resposta manual", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);
    conversa("meta");

    await sendManualReply("tenant-1", "conv-1", "Olá!");

    expect(db.conversation.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ whatsappProvider: expect.anything() }) }),
    );
  });

  it("o número do contato fora do ar: diz qual reconectar, não envia e não grava", async () => {
    // Responder pelo QR a quem só conhece o número oficial seria primeiro contato.
    db.whatsappInstance.findMany.mockResolvedValue([QR, { ...META, status: "disconnected" }]);
    conversa("meta");

    const res = await sendManualReply("tenant-1", "conv-1", "Olá!");

    expect(res).toMatchObject({ ok: false });
    expect(res.ok ? "" : res.error).toMatch(/API oficial da Meta/);
    expect(qr.sendMessage).not.toHaveBeenCalled();
    expect(meta.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("e o contrário: contato do QR com o QR fora do ar", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ ...QR, status: "disconnected" }, META]);
    conversa("evolution");

    const res = await sendManualReply("tenant-1", "conv-1", "Olá!");

    expect(res.ok ? "" : res.error).toMatch(/QR code/);
    expect(meta.sendMessage).not.toHaveBeenCalled();
  });

  it("nenhuma conexão de pé: a mensagem de sempre", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { ...QR, status: "disconnected" },
      { ...META, status: "disconnected" },
    ]);
    conversa("meta");

    const res = await sendManualReply("tenant-1", "conv-1", "Olá!");

    expect(res.ok ? "" : res.error).toMatch(/O WhatsApp não está conectado/);
  });

  it("conversa de teste não consulta conexão nenhuma: só grava", async () => {
    conversa(null, { isTest: true });

    await expect(sendManualReply("tenant-1", "conv-1", "Olá!")).resolves.toEqual({ ok: true });

    expect(db.whatsappInstance.findMany).not.toHaveBeenCalled();
    expect(qr.sendMessage).not.toHaveBeenCalled();
    expect(meta.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).toHaveBeenCalled();
  });

  it("falha do envio vira erro na tela e não deixa mensagem fantasma no histórico", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);
    conversa("meta");
    meta.sendMessage.mockRejectedValueOnce(new Error("fora da janela de 24h"));

    const res = await sendManualReply("tenant-1", "conv-1", "Olá!");

    expect(res).toEqual({ ok: false, error: "Não foi possível enviar pelo WhatsApp. Tente de novo." });
    expect(db.message.create).not.toHaveBeenCalled();
  });
});
