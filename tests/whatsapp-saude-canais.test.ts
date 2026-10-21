import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saúde do WhatsApp com as duas conexões (QR e Meta) na mesma conta.
 *
 * Cada conexão é uma linha e é checada com o próprio provedor. O que o monitor
 * não pode fazer:
 *
 * - religar uma Meta que alguém desconectou de propósito (a credencial segue
 *   válida, e "perguntar à Meta e sincronizar" a colocaria de volta no ar);
 * - tratar o silêncio da Meta como quebra — ela costuma servir aos Disparos e
 *   passar dias sem receber, e a sessão dela não morre em silêncio;
 * - deixar o silêncio da Meta esconder o silêncio do QR (e vice-versa).
 */

const db = vi.hoisted(() => ({
  whatsappInstance: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  conversation: { findFirst: vi.fn() },
  tenant: { update: vi.fn() },
}));
const mail = vi.hoisted(() => ({
  sendMail: vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true as const })),
}));
const qr = vi.hoisted(() => ({
  name: "evolution",
  isConfigured: vi.fn(() => true),
  getConnectionState: vi.fn(),
  ensureWebhook: vi.fn(async () => true),
}));
const meta = vi.hoisted(() => ({
  name: "meta",
  isConfigured: vi.fn(() => true),
  getConnectionState: vi.fn(),
  ensureWebhook: vi.fn(async () => true),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/mail", () => mail);
vi.mock("@/modules/whatsapp/meta-config", () => ({
  WHATSAPP_PROVIDER_SELECT: {},
  getWhatsAppProviderForInstance: (instance: { provider?: string }) => (instance.provider === "meta" ? meta : qr),
}));

import { checkTenantWhatsapp, scanWhatsappHealth } from "@/modules/whatsapp/health";

const NOW = new Date("2026-09-28T15:00:00.000Z"); // 12:00 em Brasília, dia útil
const key = (provider: string) => ({ tenantId_provider: { tenantId: "tenant-1", provider } });

/** Linhas da conta, entregues pela chave composta que o monitor usa. */
function linhas(rows: Record<string, { status: string; externalId?: string | null }>) {
  db.whatsappInstance.findUnique.mockImplementation(
    async ({ where }: { where: { tenantId_provider: { provider: string } } }) => {
      const provider = where.tenantId_provider.provider;
      const r = rows[provider];
      return r ? { provider, externalId: `${provider}-id`, ...r } : null;
    },
  );
}

const vivo = (status: "connected" | "disconnected") => ({ status, exists: true, reachable: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  qr.isConfigured.mockReturnValue(true);
  meta.isConfigured.mockReturnValue(true);
  qr.getConnectionState.mockResolvedValue(vivo("connected"));
  meta.getConnectionState.mockResolvedValue(vivo("connected"));
  db.whatsappInstance.update.mockResolvedValue({});
  db.conversation.findFirst.mockResolvedValue({ lastInboundAt: new Date("2026-09-28T14:00:00.000Z") });
  db.tenant.update.mockResolvedValue({});
});

describe("Checagem de uma conexão (checkTenantWhatsapp)", () => {
  it("sem provedor informado continua sendo a Evolution", async () => {
    linhas({ evolution: { status: "connected" } });

    const health = await checkTenantWhatsapp("tenant-1", NOW);

    expect(db.whatsappInstance.findUnique).toHaveBeenCalledWith({ where: key("evolution") });
    expect(health).toMatchObject({ provider: "evolution", verdict: "ok" });
  });

  it("mede o silêncio do QR só entre as conversas que não falam pela Meta", async () => {
    linhas({ evolution: { status: "connected" }, meta: { status: "connected" } });

    await checkTenantWhatsapp("tenant-1", NOW, "evolution");

    const where = db.conversation.findFirst.mock.calls[0][0].where;
    // `not: "meta"` sozinho excluiria as conversas sem canal (NULL no SQL).
    expect(where.OR).toEqual([{ whatsappProvider: null }, { whatsappProvider: { not: "meta" } }]);
    expect(where).toMatchObject({ tenantId: "tenant-1", isTest: false });
  });

  it("QR conectado que não recebe nada há horas continua sendo suspeito", async () => {
    linhas({ evolution: { status: "connected" } });
    db.conversation.findFirst.mockResolvedValue({ lastInboundAt: new Date("2026-09-28T03:00:00.000Z") });

    const health = await checkTenantWhatsapp("tenant-1", NOW, "evolution");

    expect(health.verdict).toBe("silencioso");
  });

  it("a Meta não tem o sinal do silêncio: nem consulta as conversas", async () => {
    linhas({ meta: { status: "connected" } });

    const health = await checkTenantWhatsapp("tenant-1", NOW, "meta");

    expect(db.conversation.findFirst).not.toHaveBeenCalled();
    expect(health).toMatchObject({ provider: "meta", silentHours: null, verdict: "ok" });
  });

  it("Meta desconectada de propósito NÃO é religada pelo monitor", async () => {
    // O token continua válido, então a Meta responderia "conectada" e o
    // sincronismo desfaria a decisão de quem clicou em Desconectar.
    linhas({ meta: { status: "disconnected" } });

    const health = await checkTenantWhatsapp("tenant-1", NOW, "meta");

    expect(health.verdict).toBe("ok");
    expect(meta.getConnectionState).not.toHaveBeenCalled();
    expect(db.whatsappInstance.update).not.toHaveBeenCalled();
  });

  it("Meta conectada que a Graph API não reconhece mais é marcada desconectada — só a linha dela", async () => {
    linhas({ evolution: { status: "connected" }, meta: { status: "connected" } });
    meta.getConnectionState.mockResolvedValue(vivo("disconnected"));

    const health = await checkTenantWhatsapp("tenant-1", NOW, "meta");

    expect(health.verdict).toBe("desconectado");
    expect(db.whatsappInstance.update).toHaveBeenCalledOnce();
    expect(db.whatsappInstance.update).toHaveBeenCalledWith({ where: key("meta"), data: { status: "disconnected" } });
  });

  it("Meta conectada e saudável não gera escrita", async () => {
    linhas({ meta: { status: "connected" } });

    await checkTenantWhatsapp("tenant-1", NOW, "meta");

    expect(db.whatsappInstance.update).not.toHaveBeenCalled();
  });

  it("QR derrubado: sincroniza a linha do QR e não a da Meta", async () => {
    linhas({ evolution: { status: "connected" }, meta: { status: "connected" } });
    qr.getConnectionState.mockResolvedValue(vivo("disconnected"));

    const health = await checkTenantWhatsapp("tenant-1", NOW, "evolution");

    expect(health.verdict).toBe("desconectado");
    expect(db.whatsappInstance.update).toHaveBeenCalledWith({ where: key("evolution"), data: { status: "disconnected" } });
    expect(meta.getConnectionState).not.toHaveBeenCalled();
  });

  it("a conexão que nunca foi criada não é 'quebrada'", async () => {
    linhas({ evolution: { status: "connected" } });

    const health = await checkTenantWhatsapp("tenant-1", NOW, "meta");

    expect(health).toMatchObject({ provider: "meta", verdict: "ok", exists: false });
    expect(meta.getConnectionState).not.toHaveBeenCalled();
  });
});

describe("Varredura (scanWhatsappHealth)", () => {
  const tenant = (over: Record<string, unknown> = {}) => ({
    name: "Instituto do Sorriso",
    status: "active",
    metaWhatsappEnabled: true,
    whatsappHealthAlertAt: null,
    users: [{ email: "dona@clinica.com" }],
    ...over,
  });

  it("uma conta com as duas conexões é checada duas vezes, cada uma com o seu provedor", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { tenantId: "tenant-1", provider: "evolution", tenant: tenant() },
      { tenantId: "tenant-1", provider: "meta", tenant: tenant() },
    ]);
    linhas({ evolution: { status: "connected" }, meta: { status: "connected" } });

    const result = await scanWhatsappHealth(NOW);

    expect(result).toMatchObject({ scanned: 2, broken: 0 });
    expect(db.whatsappInstance.findUnique).toHaveBeenCalledWith({ where: key("evolution") });
    expect(db.whatsappInstance.findUnique).toHaveBeenCalledWith({ where: key("meta") });
    expect(qr.getConnectionState).toHaveBeenCalledOnce();
    expect(meta.getConnectionState).toHaveBeenCalledOnce();
  });

  it("Meta de conta sem a liberação do admin não é consultada", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { tenantId: "tenant-1", provider: "meta", tenant: tenant({ metaWhatsappEnabled: false }) },
    ]);
    linhas({ meta: { status: "connected" } });

    await scanWhatsappHealth(NOW);

    expect(meta.getConnectionState).not.toHaveBeenCalled();
    expect(db.whatsappInstance.update).not.toHaveBeenCalled();
  });

  it("QR desligado pelo admin não é consultado, religado nem avisado — a Meta da mesma conta segue", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { tenantId: "tenant-1", provider: "evolution", tenant: tenant({ evolutionWhatsappEnabled: false }) },
      { tenantId: "tenant-1", provider: "meta", tenant: tenant({ evolutionWhatsappEnabled: false }) },
    ]);
    linhas({ evolution: { status: "connected" }, meta: { status: "connected" } });

    await scanWhatsappHealth(NOW);

    expect(qr.getConnectionState).not.toHaveBeenCalled();
    expect(qr.ensureWebhook).not.toHaveBeenCalled();
    expect(db.whatsappInstance.update).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(meta.getConnectionState).toHaveBeenCalledOnce();
  });

  it("o aviso de quebra diz qual conexão caiu", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { tenantId: "tenant-1", provider: "meta", tenant: tenant() },
    ]);
    linhas({ meta: { status: "connected" } });
    meta.getConnectionState.mockResolvedValue(vivo("disconnected"));

    const result = await scanWhatsappHealth(NOW);

    expect(result).toMatchObject({ broken: 1, alerted: 1 });
    const message = mail.sendMail.mock.calls[0][0] as { subject: string; text: string };
    expect(message.subject).toContain("API oficial da Meta");
    expect(message.text).toContain("API oficial da Meta");
  });

  it("o aviso do QR continua como sempre foi, sem citar a Meta", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { tenantId: "tenant-1", provider: "evolution", tenant: tenant() },
    ]);
    linhas({ evolution: { status: "connected" } });
    qr.getConnectionState.mockResolvedValue(vivo("disconnected"));

    await scanWhatsappHealth(NOW);

    const message = mail.sendMail.mock.calls[0][0] as { subject: string };
    expect(message.subject).not.toContain("Meta");
  });

  it("conta suspensa não recebe alerta", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { tenantId: "tenant-1", provider: "evolution", tenant: tenant({ status: "suspended" }) },
    ]);

    const result = await scanWhatsappHealth(NOW);

    expect(result).toMatchObject({ broken: 0, alerted: 0 });
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});
