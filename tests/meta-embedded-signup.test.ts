import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "@/lib/crypto";
import {
  hasPendingCoexistence,
  isRepeatedCoexistenceRemoval,
  markCoexistenceRemoved,
  syncForOnboarding,
} from "@/modules/whatsapp/coexistence-sync";

const mocks = vi.hoisted(() => ({
  cache: new Map<string, string>(),
  row: null as Record<string, unknown> | null,
  collision: false,
  enabled: true,
  revision: 0,
  exchange: vi.fn(),
  verifyAssets: vi.fn(),
  graph: vi.fn(),
  audit: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  conversation: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => mocks.cache.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...options: unknown[]) => {
      if (options.includes("NX") && mocks.cache.has(key)) return null;
      mocks.cache.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      mocks.cache.delete(key);
      return 1;
    }),
    eval: vi.fn(
      async (_: string, _count: number, key: string, owner: string) => {
        if (mocks.cache.get(key) === owner) mocks.cache.delete(key);
      },
    ),
  },
}));
vi.mock("@/lib/prisma", () => {
  const db = {
    tenant: {
      findUnique: vi.fn(async () => ({
        status: "active",
        metaWhatsappEnabled: mocks.enabled,
      })),
    },
    whatsappInstance: {
      findUnique: vi.fn(async () => mocks.row && structuredClone(mocks.row)),
      findFirst: vi.fn(async () =>
        mocks.collision ? { id: "other-tenant" } : null,
      ),
      findMany: vi.fn(async () => [{ provider: "evolution" }]),
      upsert: mocks.upsert,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
    conversation: { updateMany: mocks.conversation },
  };
  return {
    prisma: {
      ...db,
      $transaction: async (callback: (tx: typeof db) => unknown) =>
        callback(db),
    },
  };
});
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("@/modules/whatsapp/embedded-signup-graph", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/modules/whatsapp/embedded-signup-graph")
    >();
  return {
    ...original,
    exchangeSignupCode: mocks.exchange,
    verifySignupAssets: mocks.verifyAssets,
    signupGraph: mocks.graph,
  };
});
import {
  startEmbeddedSignup,
  authorizeEmbeddedSignup,
  finishEmbeddedSignup,
} from "@/modules/whatsapp/embedded-signup";

const actor = { tenantId: "clinic", userId: "owner" };
const assets = { wabaId: "913243131777343", phoneNumberId: "1165376309986446" };
const accessToken = "business-token-that-must-stay-server-side";
async function authorized() {
  const { attemptId } = await startEmbeddedSignup(actor);
  await authorizeEmbeddedSignup(actor, attemptId, "one-use-code");
  return attemptId;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
  mocks.row = null;
  mocks.collision = false;
  mocks.enabled = true;
  mocks.revision = 0;
  process.env.ENCRYPTION_KEY = "test-key-with-more-than-thirty-two-characters";
  process.env.META_APP_ID = "1630558868447132";
  process.env.META_APP_SECRET = "test-app-secret-with-32-characters";
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "123456789";
  process.env.META_WEBHOOK_VERIFY_TOKEN =
    "global-verify-token-never-shown-to-tenants";
  process.env.NEXTAUTH_URL = "https://fechai.test";
  mocks.exchange.mockResolvedValue(accessToken);
  mocks.verifyAssets.mockResolvedValue({
    id: assets.phoneNumberId,
    display_phone_number: "+55 14 99833-8500",
  });
  mocks.graph.mockImplementation(async (path: string) =>
    path.endsWith("smb_app_data")
      ? { request_id: "request-unique" }
      : { success: true },
  );
  mocks.upsert.mockImplementation(async ({ create, update }) => {
    mocks.row = mocks.row
      ? { ...mocks.row, ...update }
      : { id: "meta-row", ...create };
    mocks.row!.updatedAt = new Date(++mocks.revision);
    return structuredClone(mocks.row);
  });
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (
      where.updatedAt &&
      where.updatedAt.getTime() !== (mocks.row?.updatedAt as Date)?.getTime()
    )
      throw new Error("concurrent change");
    mocks.row = {
      ...mocks.row,
      ...structuredClone(data),
      updatedAt: new Date(++mocks.revision),
    };
    return structuredClone(mocks.row);
  });
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    if (
      where.updatedAt &&
      where.updatedAt.getTime() !== (mocks.row?.updatedAt as Date)?.getTime()
    )
      return { count: 0 };
    mocks.row = {
      ...mocks.row,
      ...structuredClone(data),
      updatedAt: new Date(++mocks.revision),
    };
    return { count: 1 };
  });
});

describe("Tentativa de coexistência vinculada à sessão", () => {
  it("não deixa outra conta/usuário usar o nonce; não consome a autorização certa", async () => {
    const { attemptId } = await startEmbeddedSignup(actor);
    await expect(
      authorizeEmbeddedSignup(
        { ...actor, tenantId: "other" },
        attemptId,
        "code",
      ),
    ).rejects.toThrow("outra conta");
    await expect(
      authorizeEmbeddedSignup({ ...actor, userId: "other" }, attemptId, "code"),
    ).rejects.toThrow("outra conta");
    expect(mocks.exchange).not.toHaveBeenCalled();
    await authorizeEmbeddedSignup(actor, attemptId, "code");
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
  });
  it("troca imediatamente e uma única vez; token temporário fica cifrado no Redis", async () => {
    const id = await authorized();
    expect(JSON.stringify([...mocks.cache.values()])).not.toContain(
      accessToken,
    );
    const pending = JSON.parse([...mocks.cache.values()][0]);
    expect(decryptSecret(pending.token)).toBe(accessToken);
    await expect(
      authorizeEmbeddedSignup(actor, id, "code-again"),
    ).rejects.toThrow("já foi utilizada");
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
  });
  it("não repete troca que terminou com erro ou timeout", async () => {
    const { attemptId } = await startEmbeddedSignup(actor);
    mocks.exchange.mockRejectedValueOnce(new Error("timeout"));
    await expect(
      authorizeEmbeddedSignup(actor, attemptId, "code"),
    ).rejects.toThrow();
    await expect(
      authorizeEmbeddedSignup(actor, attemptId, "code"),
    ).rejects.toThrow("já foi utilizada");
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
  });
  it("recusa tentativa expirada e mudança da configuração do app", async () => {
    const { attemptId } = await startEmbeddedSignup(actor);
    const [key, raw] = [...mocks.cache.entries()][0];
    mocks.cache.set(
      key,
      JSON.stringify({ ...JSON.parse(raw), expires: Date.now() - 1 }),
    );
    await expect(
      authorizeEmbeddedSignup(actor, attemptId, "code"),
    ).rejects.toThrow("expirou");
    const another = await startEmbeddedSignup(actor);
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "987654321";
    await expect(
      authorizeEmbeddedSignup(actor, another.attemptId, "code"),
    ).rejects.toThrow("expirou");
  });
});

describe("Conclusão segura e sincronizações únicas", () => {
  it("remoção confirmada permite nova sincronização ao reonboardar, preservando os IDs antigos", () => {
    const existing = {
      phoneNumberId: assets.phoneNumberId,
      contacts: { status: "requested", requestId: "contacts-old" },
      history: { status: "requested", requestId: "history-old" },
    };
    expect(
      syncForOnboarding(existing, assets.phoneNumberId).contacts?.requestId,
    ).toBe("contacts-old");
    const removed = markCoexistenceRemoved(existing, 1792000000);
    const next = syncForOnboarding(removed, assets.phoneNumberId);
    expect(next.contacts).toBeUndefined();
    expect(next.history).toBeUndefined();
    expect(next.previousRequests).toMatchObject({
      contacts: "contacts-old",
      history: "history-old",
    });
    expect(isRepeatedCoexistenceRemoval(next, 1792000000)).toBe(true);
    expect(isRepeatedCoexistenceRemoval(next, 1792000001)).toBe(false);
    expect(hasPendingCoexistence(existing, assets.phoneNumberId)).toBe(false);
    expect(hasPendingCoexistence(removed, assets.phoneNumberId)).toBe(true);
    expect(
      hasPendingCoexistence(
        { ...existing, contacts: { status: "unknown" } },
        assets.phoneNumberId,
      ),
    ).toBe(true);
    expect(
      syncForOnboarding(
        { ...existing, contacts: { status: "requested" } },
        assets.phoneNumberId,
      ).contacts?.status,
    ).toBe("unknown");
  });
  it("confere ativos, configura callbacks, cifra credenciais e mantém a Evolution e a opção de agente", async () => {
    const id = await authorized();
    await finishEmbeddedSignup(actor, id, assets);
    expect(mocks.verifyAssets).toHaveBeenCalledWith(accessToken, assets, null);
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({
      where: { tenantId_provider: { tenantId: "clinic", provider: "meta" } },
      create: { provider: "meta", status: "disconnected" },
    });
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty(
      "agentReplies",
    );
    expect(decryptSecret(String(mocks.row?.metaAccessTokenEncrypted))).toBe(
      accessToken,
    );
    expect(decryptSecret(String(mocks.row?.metaVerifyTokenEncrypted))).not.toBe(
      process.env.META_WEBHOOK_VERIFY_TOKEN,
    );
    expect(mocks.conversation).toHaveBeenCalledWith(
      expect.objectContaining({ data: { whatsappProvider: "evolution" } }),
    );
    expect(mocks.graph.mock.calls.map((c) => c[0])).toEqual([
      `${assets.wabaId}/subscribed_apps`,
      assets.phoneNumberId,
      `${assets.phoneNumberId}/smb_app_data`,
      `${assets.phoneNumberId}/smb_app_data`,
    ]);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant: { status: "active", metaWhatsappEnabled: true },
        }),
        data: { status: "connected" },
      }),
    );
    const graphCalls = mocks.graph.mock.calls.length;
    expect(JSON.parse([...mocks.cache.values()][0])).not.toHaveProperty(
      "token",
    );
    await finishEmbeddedSignup(actor, id, assets);
    expect(mocks.graph).toHaveBeenCalledTimes(graphCalls);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    mocks.row!.status = "disconnected";
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow(
      "depois alterada",
    );
  });
  it("não altera nem inscreve WABA usada por outro tenant", async () => {
    const id = await authorized();
    mocks.collision = true;
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow(
      "outra conta",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.graph).not.toHaveBeenCalled();
  });
  it("reautorizar conexão existente exige os mesmos ativos e não sobrescreve mudança concorrente", async () => {
    mocks.row = {
      id: "meta-row",
      metaPhoneNumberId: assets.phoneNumberId,
      metaBusinessAccountId: assets.wabaId,
      metaAccessTokenEncrypted: "old",
    };
    const id = await authorized();
    await expect(
      finishEmbeddedSignup(actor, id, { ...assets, wabaId: "99999999" }),
    ).rejects.toThrow("outra conta");
    mocks.row.metaAccessTokenEncrypted = "newer-in-another-screen";
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow(
      "outra tela",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.graph).not.toHaveBeenCalled();
  });
  it("não declara conectado quando a verificação da Cloud API falha", async () => {
    const id = await authorized();
    mocks.verifyAssets.mockRejectedValueOnce(new Error("ainda desconectado"));
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("liberação retirada durante o fluxo impede persistir e ativar", async () => {
    const id = await authorized();
    mocks.enabled = false;
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow(
      "não está liberada",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("resultado incerto fica no banco e não é reenviado ao tentar concluir de novo", async () => {
    const id = await authorized();
    mocks.graph.mockImplementation(async (path: string) => {
      if (path.endsWith("smb_app_data"))
        throw new Error("timeout-after-accept");
      return { success: true };
    });
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow();
    expect(mocks.row?.metaCoexistenceSync).toMatchObject({
      contacts: { status: "unknown" },
    });
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow(
      "antes de repetir",
    );
    expect(
      mocks.graph.mock.calls.filter((c) => c[0].endsWith("smb_app_data")),
    ).toHaveLength(1);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("desconexão durante a chamada da Meta vence a ativação e preserva o checkpoint incerto", async () => {
    const id = await authorized();
    mocks.graph.mockImplementation(async (path: string) => {
      if (path.endsWith("smb_app_data")) {
        mocks.row!.updatedAt = new Date(++mocks.revision); // Outra tela clicou em desconectar.
        return { request_id: "meta-already-accepted" };
      }
      return { success: true };
    });
    await expect(finishEmbeddedSignup(actor, id, assets)).rejects.toThrow(
      "concurrent change",
    );
    expect(mocks.row?.status).toBe("disconnected");
    expect(mocks.row?.metaCoexistenceSync).toMatchObject({
      contacts: { status: "unknown" },
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
