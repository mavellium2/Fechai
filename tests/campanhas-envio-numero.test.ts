import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Envio a um número interno: só pelo número conectado por QR code, nunca pela
 * Meta, e sem canal o envio espera em vez de trocar de número.
 */

const instances = vi.hoisted(() => ({ findWhatsappChannel: vi.fn() }));
const meta = vi.hoisted(() => ({ getWhatsAppProviderForInstance: vi.fn() }));
vi.mock("@/modules/whatsapp/instances", () => instances);
vi.mock("@/modules/whatsapp/meta-config", () => meta);

import { sendToInternalPhone } from "@/modules/knowledge-gaps/group";

const provider = { isConfigured: vi.fn(), sendMessage: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  provider.isConfigured.mockReturnValue(true);
  provider.sendMessage.mockResolvedValue("key1");
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
