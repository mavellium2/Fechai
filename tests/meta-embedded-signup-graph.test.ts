import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeSignupCode,
  verifySignupAssets,
} from "@/modules/whatsapp/embedded-signup-graph";
import { readEmbeddedSignupEvent } from "@/modules/whatsapp/embedded-signup-events";
import { embeddedSignupPublicConfig } from "@/modules/whatsapp/embedded-signup-config";
import { MetaCloudProvider } from "@/modules/whatsapp/meta";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => {
  process.env.ENCRYPTION_KEY = "test-key-with-more-than-thirty-two-characters";
  process.env.META_APP_ID = "1630558868447132";
  process.env.META_APP_SECRET = "app-secret-never-sent-to-the-browser";
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "123456789";
  process.env.META_WEBHOOK_VERIFY_TOKEN =
    "global-verify-secret-never-sent-to-browser";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  process.env.NEXTAUTH_URL = "https://fechai.test";
});
afterEach(() => vi.unstubAllGlobals());

describe("Cadastro incorporado: eventos e configuração pública", () => {
  const event = {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    data: { waba_id: "913243131777343" },
  };
  it("aceita evento de coexistência com WABA mesmo sem phone ID", () => {
    expect(
      readEmbeddedSignupEvent(
        "https://www.facebook.com",
        JSON.stringify(event),
      ),
    ).toEqual({
      kind: "finish",
      assets: { wabaId: "913243131777343", phoneNumberId: undefined },
    });
  });
  it.each([
    "https://evilfacebook.com",
    "https://facebook.com.evil.test",
    "http://www.facebook.com",
    "https://www.facebook.com:444",
  ])("recusa origem parecida: %s", (origin) => {
    expect(readEmbeddedSignupEvent(origin, event)).toBeNull();
  });
  it("recusa fluxo comum, IDs inválidos e mensagens que não são do cadastro", () => {
    expect(
      readEmbeddedSignupEvent("https://www.facebook.com", {
        ...event,
        event: "FINISH",
      }),
    ).toBeNull();
    expect(
      readEmbeddedSignupEvent("https://www.facebook.com", {
        ...event,
        data: { waba_id: "../me" },
      }),
    ).toBeNull();
    expect(
      readEmbeddedSignupEvent("https://www.facebook.com", "not JSON"),
    ).toBeNull();
  });
  it("não entrega nenhum segredo no objeto público e falha fechado sem configuração", () => {
    expect(embeddedSignupPublicConfig()).toEqual({
      appId: "1630558868447132",
      configId: "123456789",
      version: "v26.0",
    });
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    expect(embeddedSignupPublicConfig()).toBeNull();
  });
});

describe("Verificação com a Graph API", () => {
  it("troca código somente no servidor e exige app e permissões correspondentes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ access_token: "secret-business-token-long-enough" }),
      )
      .mockResolvedValueOnce(
        json({
          data: {
            is_valid: true,
            app_id: "different-app",
            scopes: [
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeSignupCode("one-use-code")).rejects.toThrow(
      "autorização",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
  it("não expõe resposta nem token da Graph em erros", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { message: "private-token-value" } }, 403),
      ),
    );
    await expect(exchangeSignupCode("one-use-code")).rejects.not.toThrow(
      "private-token-value",
    );
  });
  it("confere pertencimento à WABA antes de consultar o perfil", async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: "99999999" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      verifySignupAssets("token", {
        wabaId: "913243131777343",
        phoneNumberId: "1165376309986446",
      }),
    ).rejects.toThrow("não pertence");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("recusa escolha ambígua sem telefone e aceita uma única opção em coexistência ativa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ data: [{ id: "1165376309986446" }, { id: "99999999" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      verifySignupAssets("token", { wabaId: "913243131777343" }),
    ).rejects.toThrow("não pertence");
    fetchMock
      .mockResolvedValueOnce(json({ data: [{ id: "1165376309986446" }] }))
      .mockResolvedValueOnce(
        json({
          id: "1165376309986446",
          is_on_biz_app: true,
          platform_type: "CLOUD_API",
          status: "CONNECTED",
        }),
      );
    await expect(
      verifySignupAssets("token", { wabaId: "913243131777343" }),
    ).resolves.toMatchObject({ id: "1165376309986446" });
  });
  it.each([
    {
      platform_type: "ON_PREMISE",
      status: "DISCONNECTED",
      is_on_biz_app: true,
    },
    { platform_type: "CLOUD_API", status: "DISCONNECTED", is_on_biz_app: true },
    { platform_type: "CLOUD_API", status: "CONNECTED", is_on_biz_app: false },
  ])("não confunde HTTP 200 com coexistência pronta: %o", async (state) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ data: [{ id: "1165376309986446" }] }))
        .mockResolvedValueOnce(json({ id: "1165376309986446", ...state })),
    );
    await expect(
      verifySignupAssets("token", { wabaId: "913243131777343" }),
    ).rejects.toThrow("ainda não confirmou");
  });
  it("a saúde e a conexão manual também recusam perfil ON_PREMISE com HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          id: "1165376309986446",
          platform_type: "ON_PREMISE",
          status: "DISCONNECTED",
        }),
      ),
    );
    const provider = new MetaCloudProvider({
      phoneNumberId: "1165376309986446",
      accessToken: "token",
    });
    await expect(
      provider.getConnectionState("1165376309986446"),
    ).resolves.toMatchObject({ status: "disconnected", reachable: true });
    await expect(provider.getPhoneProfile()).rejects.toThrow(
      "ainda não está conectado",
    );
  });
});
