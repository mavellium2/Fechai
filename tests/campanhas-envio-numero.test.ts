import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Envio a um número interno: só pelo número conectado por QR code, nunca pela
 * Meta, e sem canal o envio espera em vez de trocar de número.
 */

const instances = vi.hoisted(() => ({ findWhatsappChannel: vi.fn() }));
const meta = vi.hoisted(() => ({ getWhatsAppProviderForInstance: vi.fn() }));
vi.mock("@/modules/whatsapp/instances", () => instances);
vi.mock("@/modules/whatsapp/meta-config", () => meta);

import { sendDocumentToInternalGroup, sendDocumentToInternalPhone, sendToInternalPhone } from "@/modules/knowledge-gaps/group";

const provider = { isConfigured: vi.fn(), sendMessage: vi.fn(), sendDocument: vi.fn() as ReturnType<typeof vi.fn> | undefined };

beforeEach(() => {
  vi.resetAllMocks();
  provider.isConfigured.mockReturnValue(true);
  provider.sendMessage.mockResolvedValue("key1");
  provider.sendDocument = vi.fn().mockResolvedValue("doc1");
  meta.getWhatsAppProviderForInstance.mockReturnValue(provider);
  instances.findWhatsappChannel.mockResolvedValue({ externalId: "inst-qr" });
});

describe("sendToInternalPhone", () => {
  it("envia pelo número conectado por QR code", async () => {
    await expect(sendToInternalPhone("t1", "5511987654321", "texto")).resolves.toBe(true);
    expect(instances.findWhatsappChannel).toHaveBeenCalledWith("t1", "evolution");
    expect(provider.sendMessage).toHaveBeenCalledWith("inst-qr", "5511987654321", "texto");
  });

  it("sem QR conectado espera: não envia nem troca de número", async () => {
    instances.findWhatsappChannel.mockResolvedValue(null);
    await expect(sendToInternalPhone("t1", "5511987654321", "texto")).resolves.toBe(false);
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("provedor sem configuração não envia", async () => {
    provider.isConfigured.mockReturnValue(false);
    await expect(sendToInternalPhone("t1", "5511987654321", "texto")).resolves.toBe(false);
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("falha de envio lança, para quem chama decidir", async () => {
    provider.sendMessage.mockRejectedValue(new Error("timeout"));
    await expect(sendToInternalPhone("t1", "5511987654321", "texto")).rejects.toThrow("timeout");
  });
});

describe("envio de documento (PDF)", () => {
  const doc = { base64: "JVBERi0=", mimetype: "application/pdf", fileName: "r.pdf", caption: "legenda" };

  it("ao grupo, pelo QR conectado", async () => {
    await expect(sendDocumentToInternalGroup("t1", "120363111111111111@g.us", doc)).resolves.toBe(true);
    expect(instances.findWhatsappChannel).toHaveBeenCalledWith("t1", "evolution");
    expect(provider.sendDocument).toHaveBeenCalledWith("inst-qr", "120363111111111111@g.us", doc);
  });

  it("recusa destino que não é grupo, sem enviar", async () => {
    await expect(sendDocumentToInternalGroup("t1", "5511987654321", doc)).rejects.toThrow("grupo");
    expect(provider.sendDocument).not.toHaveBeenCalled();
  });

  it("a um número, pelo QR conectado", async () => {
    await expect(sendDocumentToInternalPhone("t1", "5511987654321", doc)).resolves.toBe(true);
    expect(provider.sendDocument).toHaveBeenCalledWith("inst-qr", "5511987654321", doc);
  });

  it("sem QR conectado espera: não envia nem troca de número", async () => {
    instances.findWhatsappChannel.mockResolvedValue(null);
    await expect(sendDocumentToInternalGroup("t1", "120363111111111111@g.us", doc)).resolves.toBe(false);
    await expect(sendDocumentToInternalPhone("t1", "5511987654321", doc)).resolves.toBe(false);
    expect(provider.sendDocument).not.toHaveBeenCalled();
  });

  it("provedor sem envio de documento não envia", async () => {
    provider.sendDocument = undefined;
    await expect(sendDocumentToInternalPhone("t1", "5511987654321", doc)).resolves.toBe(false);
  });

  it("falha de envio lança, para quem chama decidir", async () => {
    provider.sendDocument = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(sendDocumentToInternalPhone("t1", "5511987654321", doc)).rejects.toThrow("timeout");
  });
});
