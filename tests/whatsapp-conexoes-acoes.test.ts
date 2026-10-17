import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Conectar e desconectar cada conexão do WhatsApp (`/integracoes`).
 *
 * A regra nova: a Evolution (QR) e a API oficial da Meta são linhas separadas
 * (`@@unique([tenantId, provider])`) e ficam de pé ao mesmo tempo. O que estas
 * ações não podem fazer é mexer na linha da outra — derrubar o atendimento pelo
 * QR ao conectar a Meta, ou o contrário, foi exatamente o que impedia o uso.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  tenantFind: vi.fn(),
  audit: vi.fn(),
  qrDisconnect: vi.fn(),
  qrGetQr: vi.fn(),
  qrConfigured: vi.fn(() => true),
  metaDisconnect: vi.fn(),
  metaConfigured: vi.fn(() => true),
  getPhoneProfile: vi.fn(),
  ensureWebhook: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "tenant-1" })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappInstance: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      upsert: mocks.upsert,
      update: mocks.update,
    },
    conversation: { updateMany: mocks.updateMany },
    tenant: { findUnique: mocks.tenantFind },
    agent: { findFirst: vi.fn(async () => null) },
    lead: { findFirst: vi.fn(async () => null) },
    clinicorpIntegration: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: (name: string) =>
    name === "meta"
      ? { name: "meta", isConfigured: mocks.metaConfigured, disconnect: mocks.metaDisconnect }
      : {
          name: "evolution",
          isConfigured: mocks.qrConfigured,
          disconnect: mocks.qrDisconnect,
          getQrCode: mocks.qrGetQr,
        },
}));
// A classe só precisa existir para o `instanceof` da reconexão e para o cadastro.
vi.mock("@/modules/whatsapp/meta", () => {
  class MetaCloudProvider {
    name = "meta";
    isConfigured = mocks.metaConfigured;
    disconnect = mocks.metaDisconnect;
    getPhoneProfile = mocks.getPhoneProfile;
    ensureWebhook = mocks.ensureWebhook;
  }
  return { MetaCloudProvider };
});
vi.mock("@/modules/whatsapp/meta-config", async () => {
  // A instância da Meta tem que ser um `MetaCloudProvider`: a reconexão confere.
  const { MetaCloudProvider } = await import("@/modules/whatsapp/meta");
  return {
    WHATSAPP_PROVIDER_SELECT: {},
    metaWebhookUrl: (tenantId: string) => `https://fechai.test/api/webhooks/whatsapp/meta/${tenantId}`,
    getWhatsAppProviderForInstance: (instance: { provider?: string }) =>
      instance.provider === "meta"
        ? new MetaCloudProvider({ phoneNumberId: "", accessToken: "", businessAccountId: null })
        : { name: "evolution", isConfigured: mocks.qrConfigured, disconnect: mocks.qrDisconnect },
  };
});
vi.mock("@/lib/widget/deploy", () => ({}));
vi.mock("@/lib/bunny", () => ({}));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit, recordChange: vi.fn() }));
vi.mock("@/modules/scheduling/google", () => ({}));
vi.mock("@/modules/scheduling/features", () => ({}));
vi.mock("@/modules/scheduling/clinicorp", () => ({}));
vi.mock("@/lib/crypto", () => ({
  isEncryptionConfigured: () => true,
  encryptSecret: (value: string) => `cifrado(${value})`,
  decryptSecret: (value: string) => value,
}));

import {
  disconnectWhatsapp,
  reconnectMetaWhatsapp,
  saveMetaWhatsapp,
  refreshWhatsappStatus,
} from "@/app/(dashboard)/integracoes/actions";

const META_KEY = { tenantId_provider: { tenantId: "tenant-1", provider: "meta" } };
const QR_KEY = { tenantId_provider: { tenantId: "tenant-1", provider: "evolution" } };

function credenciais() {
  const form = new FormData();
  form.set("phoneNumberId", "109876543210");
  form.set("businessAccountId", "209876543210");
  form.set("accessToken", "EAAG-token-permanente-de-teste");
  form.set("appSecret", "segredo-do-app-com-16-ou-mais");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.tenantFind.mockResolvedValue({ metaWhatsappEnabled: true });
  mocks.findUnique.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue({ id: "row-1" });
  mocks.update.mockResolvedValue({});
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.getPhoneProfile.mockResolvedValue({ displayPhone: "+55 14 99999-0000", verifiedName: "Clínica" });
  mocks.ensureWebhook.mockResolvedValue(true);
  mocks.qrConfigured.mockReturnValue(true);
  mocks.metaConfigured.mockReturnValue(true);
  mocks.qrDisconnect.mockResolvedValue(undefined);
  mocks.metaDisconnect.mockResolvedValue(undefined);
});

describe("Conectar a Meta com a Evolution de pé (saveMetaWhatsapp)", () => {
  it("conecta sem exigir que o QR seja desconectado, gravando só a linha da Meta", async () => {
    // Antes: "Desconecte o número da Evolution antes de ativar a Meta."
    mocks.findMany.mockResolvedValue([{ provider: "evolution" }]);

    const res = await saveMetaWhatsapp(credenciais());

    expect(res).toMatchObject({ ok: true, status: "connected", displayPhone: "+55 14 99999-0000" });
    expect(mocks.upsert).toHaveBeenCalledOnce();
    const call = mocks.upsert.mock.calls[0][0];
    expect(call.where).toEqual(META_KEY);
    expect(call.create).toMatchObject({
      tenantId: "tenant-1",
      provider: "meta",
      status: "connected",
      externalId: "109876543210",
      metaAccessTokenEncrypted: "cifrado(EAAG-token-permanente-de-teste)",
    });
    // Nada na linha da Evolution: nem update, nem provider trocado.
    expect(mocks.update).not.toHaveBeenCalled();
    expect(call.update).not.toHaveProperty("provider");
  });

  it("a primeira conexão da Meta marca as conversas antigas como do QR — antes de a linha nascer", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([{ provider: "evolution" }]);

    await saveMetaWhatsapp(credenciais());

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { whatsappProvider: "evolution" } }),
    );
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
  });

  it("trocar as credenciais de uma Meta que já existe não remarca conversa nenhuma", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-meta", status: "connected", provider: "meta" });

    await saveMetaWhatsapp(credenciais());

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: META_KEY });
  });

  it("registra a conexão na auditoria, dizendo que é a Meta", async () => {
    await saveMetaWhatsapp(credenciais());

    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "whatsapp.connected",
        after: { status: "connected", provider: "meta" },
      }),
    );
  });

  it("sem a liberação do admin, recusa no servidor — esconder o cartão não autoriza nada", async () => {
    mocks.tenantFind.mockResolvedValue({ metaWhatsappEnabled: false });

    const res = await saveMetaWhatsapp(credenciais());

    expect(res).toMatchObject({ ok: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.getPhoneProfile).not.toHaveBeenCalled();
  });

  it("token que a Meta não aceita não grava nada", async () => {
    mocks.getPhoneProfile.mockRejectedValue(new Error("Token inválido"));

    const res = await saveMetaWhatsapp(credenciais());

    expect(res).toEqual({ ok: false, error: "Token inválido" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("Reconectar a Meta com credenciais guardadas (reconnectMetaWhatsapp)", () => {
  const guardada = (over: Record<string, unknown> = {}) => ({
    id: "row-meta", provider: "meta", status: "disconnected", externalId: "109876543210",
    metaPhoneNumberId: "109876543210", metaDisplayPhone: "+55 14 99999-0000", ...over,
  });

  it("a reconexão manual não pula a conclusão da coexistência", async () => {
    mocks.findUnique.mockResolvedValue(guardada({ metaCoexistenceSync: { phoneNumberId: "109876543210", contacts: { status: "unknown" } } }));
    expect((await reconnectMetaWhatsapp()).ok).toBe(false);
    expect((await saveMetaWhatsapp(credenciais())).ok).toBe(false);
    expect(mocks.getPhoneProfile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("religa só a linha da Meta, com a Evolution intocada", async () => {
    mocks.findUnique.mockResolvedValue(guardada());

    const res = await reconnectMetaWhatsapp();

    expect(res).toMatchObject({ ok: true, status: "connected" });
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: META_KEY }));
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      where: META_KEY,
      data: { status: "connected", externalId: "109876543210" },
    });
  });

  it("sem credenciais da Meta guardadas, manda configurar primeiro", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(reconnectMetaWhatsapp()).resolves.toEqual({
      ok: false,
      error: "Configure primeiro a API oficial da Meta.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("sem a liberação do admin, recusa no servidor", async () => {
    mocks.tenantFind.mockResolvedValue({ metaWhatsappEnabled: false });
    mocks.findUnique.mockResolvedValue(guardada());

    const res = await reconnectMetaWhatsapp();

    expect(res.ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("Desconectar uma conexão (disconnectWhatsapp)", () => {
  it("desconectar a Meta não derruba o QR: só a linha da Meta é atualizada", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-meta", provider: "meta", status: "connected", externalId: "109876543210" });

    const res = await disconnectWhatsapp("meta");

    expect(res.ok).toBe(true);
    expect(res.info).toMatch(/oficial/i);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: META_KEY });
    expect(mocks.metaDisconnect).toHaveBeenCalledWith("109876543210");
    expect(mocks.qrDisconnect).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({ where: META_KEY, data: { status: "disconnected" } });
  });

  it("desconectar o QR não derruba a Meta", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-qr", provider: "evolution", status: "connected", externalId: "tenant_tenant-1" });

    const res = await disconnectWhatsapp("evolution");

    expect(res.ok).toBe(true);
    expect(mocks.qrDisconnect).toHaveBeenCalledWith("tenant_tenant-1");
    expect(mocks.metaDisconnect).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: QR_KEY, data: { status: "disconnected" } });
  });

  it("a auditoria diz qual conexão saiu", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-meta", provider: "meta", status: "connected", externalId: "109876543210" });

    await disconnectWhatsapp("meta");

    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "whatsapp.disconnected",
        target: expect.objectContaining({ label: "WhatsApp oficial" }),
        before: { status: "connected", provider: "meta" },
        after: { status: "disconnected", provider: "meta" },
      }),
    );
  });

  it.each(["", "whatsapp", "META", "evolution; DROP", undefined])(
    "provedor inválido (%j) é recusado sem tocar no banco — Server Action é endpoint público",
    async (requested) => {
      const res = await disconnectWhatsapp(requested as unknown as string);

      expect(res).toEqual({ ok: false, error: "Conexão de WhatsApp inválida." });
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("sem número conectado nessa conexão, avisa e não faz nada", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-meta", provider: "meta", status: "disconnected", externalId: null });

    const res = await disconnectWhatsapp("meta");

    expect(res).toEqual({ ok: false, error: "Nenhum número conectado." });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("falha do provedor não marca como desconectado (a tela não pode mentir)", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-meta", provider: "meta", status: "connected", externalId: "109876543210" });
    mocks.metaDisconnect.mockRejectedValue(new Error("Graph API fora do ar"));

    const res = await disconnectWhatsapp("meta");

    expect(res.ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("Atualizar o QR (refreshWhatsappStatus)", () => {
  it("consulta e grava só a linha da Evolution", async () => {
    mocks.findUnique.mockResolvedValue({ id: "row-qr", provider: "evolution", status: "pending_qr", externalId: "tenant_tenant-1" });
    mocks.qrGetQr.mockResolvedValue({ status: "connected" });

    const res = await refreshWhatsappStatus();

    expect(res).toMatchObject({ ok: true, status: "connected" });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: QR_KEY });
    expect(mocks.update).toHaveBeenCalledWith({ where: QR_KEY, data: { status: "connected" } });
  });

  it("conta sem instância do QR (só a Meta): diz que não há nada a atualizar", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const res = await refreshWhatsappStatus();

    expect(res).toEqual({ ok: false, error: "Nenhuma instância criada ainda." });
    expect(mocks.qrGetQr).not.toHaveBeenCalled();
  });
});
