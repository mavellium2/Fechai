import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Painel do admin com contas que têm até duas conexões de WhatsApp (QR e Meta).
 *
 * - O filtro "WhatsApp" fala do estado da conta em uma palavra: conectada se
 *   QUALQUER conexão atende. Sem isso, a conta com o QR de pé e a Meta parada
 *   apareceria em "desconectado" — e a conta sem nenhuma linha em "conectado".
 * - Excluir a conta tem que derrubar as DUAS conexões: deixar uma para trás é um
 *   número atendendo uma conta que não existe mais.
 */

const db = vi.hoisted(() => ({
  tenant: { findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
}));
const adapters = vi.hoisted(() => ({
  disconnect: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/bunny", () => ({ deleteFromBunny: vi.fn(async () => {}) }));
vi.mock("@/modules/voice/fish", () => ({ deleteVoice: vi.fn(async () => {}) }));
vi.mock("@/modules/tenants/provision", () => ({ createTenantWithOwner: vi.fn() }));
vi.mock("@/modules/whatsapp/meta-config", () => ({
  WHATSAPP_PROVIDER_SELECT: { provider: true, externalId: true },
  getWhatsAppProviderForInstance: (instance: { provider: string }) => ({
    disconnect: (externalId: string) => adapters.disconnect(instance.provider, externalId),
  }),
}));

import { deleteTenant, listTenants } from "@/modules/admin/service";

// Tira a cláusula padrão que esconde suspensas e testes encerrados: este arquivo
// testa só o filtro de WhatsApp (essa regra tem o seu próprio caso abaixo).
const whereDe = async (whatsapp: string[]) => {
  db.tenant.findMany.mockResolvedValue([]);
  await listTenants({ whatsapp });
  const where = { ...db.tenant.findMany.mock.calls.at(-1)![0].where };
  delete where.NOT;
  return where;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.tenant.delete.mockResolvedValue({});
});

describe("Filtro de WhatsApp na lista de contas", () => {
  it("conectada: qualquer conexão de pé", async () => {
    expect(await whereDe(["connected"])).toEqual({
      whatsappInstances: { some: { status: "connected" } },
    });
  });

  it("aguardando leitura: alguma espera o QR e nenhuma atende", async () => {
    expect(await whereDe(["pending_qr"])).toEqual({
      whatsappInstances: { some: { status: "pending_qr" }, none: { status: "connected" } },
    });
  });

  it("desconectada: tem linha, mas nenhuma atende nem espera leitura", async () => {
    expect(await whereDe(["disconnected"])).toEqual({
      whatsappInstances: { some: {}, none: { status: { in: ["connected", "pending_qr"] } } },
    });
  });

  it("nunca conectou: não tem linha nenhuma", async () => {
    expect(await whereDe(["none"])).toEqual({ whatsappInstances: { none: {} } });
  });

  it("várias escolhas viram OU, sem sobrescrever os outros filtros", async () => {
    const where = await whereDe(["connected", "none"]);

    expect(where.OR).toEqual([
      { whatsappInstances: { some: { status: "connected" } } },
      { whatsappInstances: { none: {} } },
    ]);
  });

  it("sem filtro de WhatsApp, a consulta não menciona conexões", async () => {
    db.tenant.findMany.mockResolvedValue([]);
    await listTenants({});
    expect(db.tenant.findMany.mock.calls[0][0].where).not.toHaveProperty("whatsappInstances");
  });

  it("por padrão esconde suspensas e testes encerrados; escolher um filtro de situação mostra", async () => {
    db.tenant.findMany.mockResolvedValue([]);
    await listTenants({});
    expect(db.tenant.findMany.mock.calls[0][0].where).toHaveProperty("NOT");

    db.tenant.findMany.mockClear();
    await listTenants({ status: ["suspended"] });
    expect(db.tenant.findMany.mock.calls[0][0].where).not.toHaveProperty("NOT");
  });

  it("a lista traz o estado de cada conexão para o painel resumir", async () => {
    db.tenant.findMany.mockResolvedValue([]);
    await listTenants({});
    expect(db.tenant.findMany.mock.calls[0][0].include.whatsappInstances).toEqual({ select: { status: true } });
  });
});

describe("Excluir a conta (deleteTenant)", () => {
  it("desconecta as duas conexões, cada uma pelo seu provedor", async () => {
    db.tenant.findUnique.mockResolvedValue({
      id: "tenant-1",
      whatsappInstances: [
        { provider: "evolution", externalId: "tenant_tenant-1" },
        { provider: "meta", externalId: "109876543210" },
      ],
      agents: [],
      knowledgeDocs: [],
    });

    await deleteTenant("tenant-1");

    expect(adapters.disconnect).toHaveBeenCalledTimes(2);
    expect(adapters.disconnect).toHaveBeenCalledWith("evolution", "tenant_tenant-1");
    expect(adapters.disconnect).toHaveBeenCalledWith("meta", "109876543210");
    expect(db.tenant.delete).toHaveBeenCalledWith({ where: { id: "tenant-1" } });
  });

  it("uma conexão que falha ao desligar não impede a outra nem a exclusão", async () => {
    db.tenant.findUnique.mockResolvedValue({
      id: "tenant-1",
      whatsappInstances: [
        { provider: "evolution", externalId: "tenant_tenant-1" },
        { provider: "meta", externalId: "109876543210" },
      ],
      agents: [],
      knowledgeDocs: [],
    });
    adapters.disconnect.mockRejectedValueOnce(new Error("Evolution fora do ar"));

    await expect(deleteTenant("tenant-1")).resolves.toBeUndefined();

    expect(adapters.disconnect).toHaveBeenCalledTimes(2);
    expect(db.tenant.delete).toHaveBeenCalled();
  });

  it("linha sem número (nunca conectou) não chama provedor nenhum", async () => {
    db.tenant.findUnique.mockResolvedValue({
      id: "tenant-1",
      whatsappInstances: [{ provider: "evolution", externalId: null }],
      agents: [],
      knowledgeDocs: [],
    });

    await deleteTenant("tenant-1");

    expect(adapters.disconnect).not.toHaveBeenCalled();
    expect(db.tenant.delete).toHaveBeenCalled();
  });
});
