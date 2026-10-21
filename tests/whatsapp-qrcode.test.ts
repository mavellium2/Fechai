import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testes do fluxo de gerar o QR de conexão do WhatsApp.
 *
 * Vêm de um erro que só aparecia NO CELULAR — "não foi possível conectar o
 * dispositivo, tente novamente mais tarde" — enquanto a tela mostrava um
 * código aparentemente válido, com contador correndo. Duas causas somadas:
 *
 * - a tela exibia um QR já invalidado (o WhatsApp gira o código a cada ~20s e o
 *   poll descartava o código novo que vinha na resposta);
 * - a Evolution corta a sessão ao atingir `QRCODE_LIMIT` QRs gerados e passa a
 *   recusar TODA leitura. Esse contador só zera com um logout de verdade — e o
 *   nosso estava quebrado, então nunca zerava.
 *
 * Os dois modos de falha são silenciosos do lado do painel: nada na tela
 * denuncia um código morto. Por isso estão travados aqui.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
  getQrCode: vi.fn(),
  createInstance: vi.fn(),
  ensureWebhook: vi.fn(),
  isConfigured: vi.fn(() => true),
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
    // QR liberado pelo admin: é o estado de toda conta que não foi bloqueada.
    tenant: { findUnique: vi.fn(async () => ({ evolutionWhatsappEnabled: true })) },
    conversation: { updateMany: mocks.updateMany },
    agent: { findFirst: vi.fn(async () => null) },
    lead: { findFirst: vi.fn(async () => null) },
    clinicorpIntegration: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: () => ({
    isConfigured: mocks.isConfigured,
    disconnect: mocks.disconnect,
    getQrCode: mocks.getQrCode,
    createInstance: mocks.createInstance,
    ensureWebhook: mocks.ensureWebhook,
  }),
}));
vi.mock("@/lib/widget/deploy", () => ({}));
vi.mock("@/lib/bunny", () => ({}));
vi.mock("@/modules/audit/log", () => ({ recordAudit: vi.fn(), recordChange: vi.fn() }));
vi.mock("@/modules/scheduling/google", () => ({}));
vi.mock("@/modules/scheduling/features", () => ({}));
vi.mock("@/modules/scheduling/clinicorp", () => ({}));
vi.mock("@/lib/crypto", () => ({ isEncryptionConfigured: () => true }));

import { connectWhatsapp } from "@/app/(dashboard)/integracoes/actions";

/** Instância existente na conta, no estado indicado. */
function instancia(status: string) {
  mocks.findUnique.mockResolvedValue({
    id: "inst-1",
    externalId: "tenant_tenant-1",
    status,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isConfigured.mockReturnValue(true);
  mocks.getQrCode.mockResolvedValue({ status: "pending_qr", qrCode: "data:image/png;base64,AAA" });
  mocks.createInstance.mockResolvedValue({
    externalId: "tenant_tenant-1",
    status: "pending_qr",
    qrCode: "data:image/png;base64,AAA",
  });
  mocks.ensureWebhook.mockResolvedValue(true);
  mocks.upsert.mockResolvedValue({});
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 0 });
});

describe("Gerar o QR de conexão (connectWhatsapp)", () => {
  it("desloga a sessão velha antes de pedir o código", async () => {
    instancia("disconnected");

    const res = await connectWhatsapp();

    expect(mocks.disconnect).toHaveBeenCalledWith("tenant_tenant-1");
    expect(res).toMatchObject({ ok: true, qrCode: "data:image/png;base64,AAA" });
  });

  it("desloga também quando a instância ficou parada em pending_qr", async () => {
    // É o estado em que o contador de QRs da Evolution mais cresce: a pessoa
    // abre a tela, não escaneia, volta depois. Sem o logout, cada visita
    // empurra o contador para perto do limite que recusa a sessão.
    instancia("pending_qr");
    await connectWhatsapp();
    expect(mocks.disconnect).toHaveBeenCalledWith("tenant_tenant-1");
  });

  it("NÃO desloga um número que está atendendo", async () => {
    // "Conectar outro número" no meio do expediente não pode derrubar o
    // atendimento em curso para gerar um código que ninguém leu ainda.
    instancia("connected");
    mocks.getQrCode.mockResolvedValue({ status: "connected" });

    await connectWhatsapp();

    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("não desloga quando ainda não existe instância", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await connectWhatsapp();

    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.createInstance).toHaveBeenCalledWith("tenant-1");
  });

  it("entrega o código mesmo se o logout falhar", async () => {
    // Sessão já limpa devolve erro, e é justamente o estado desejado. Sem QR a
    // pessoa não tem o que fazer nesta tela.
    instancia("disconnected");
    mocks.disconnect.mockRejectedValue(new Error("Evolution logout falhou (404)"));

    const res = await connectWhatsapp();

    expect(res).toMatchObject({ ok: true, qrCode: "data:image/png;base64,AAA" });
  });
});

describe("QR com a API oficial da Meta também conectada", () => {
  it("olha só a linha da Evolution, e grava só nela", async () => {
    // A conta pode ter uma linha por provedor. Ler "a linha da conta" pegaria a
    // da Meta (ou o contrário) e o QR sairia sobre o número errado.
    instancia("disconnected");

    await connectWhatsapp();

    const key = { tenantId_provider: { tenantId: "tenant-1", provider: "evolution" } };
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: key });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: key,
        create: expect.objectContaining({ provider: "evolution" }),
      }),
    );
  });

  it("não recusa o QR só porque a Meta está conectada", async () => {
    // Antes: "Selecione Evolution antes de gerar o código QR."
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([{ provider: "meta" }]);

    const res = await connectWhatsapp();

    expect(res).toMatchObject({ ok: true, qrCode: "data:image/png;base64,AAA" });
  });

  it("conta que só tinha a Meta: as conversas antigas ficam com a Meta antes da segunda conexão nascer", async () => {
    // Sem isto, uma conversa anterior à coluna ficaria sem canal e, com as duas
    // conexões de pé, cairia no padrão (a Evolution) — o paciente que só
    // conhece o número oficial receberia o follow-up por outro número.
    mocks.findUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([{ provider: "meta" }]);

    await connectWhatsapp();

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { whatsappProvider: "meta" } }),
    );
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsert.mock.invocationCallOrder[0],
    );
  });

  it("religar a Evolution que já existe não mexe nas conversas", async () => {
    instancia("disconnected");

    await connectWhatsapp();

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
