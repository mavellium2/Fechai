import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  user: vi.fn(),
  rate: vi.fn(),
  start: vi.fn(),
  authorize: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireTenant: mocks.session }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenant },
    user: { findUnique: mocks.user },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/whatsapp/embedded-signup", () => ({
  startEmbeddedSignup: mocks.start,
  authorizeEmbeddedSignup: mocks.authorize,
  finishEmbeddedSignup: mocks.finish,
}));
import { POST } from "@/app/api/integrations/meta/signup/route";

const input = {
  step: "authorize",
  attemptId: "a".repeat(43),
  code: "code-only-from-sdk",
};
const request = (body: unknown = input, origin = "https://fechai.test") =>
  new Request("https://fechai.test/api/integrations/meta/signup", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    ENCRYPTION_KEY: "test-encryption-key-with-thirty-two-chars",
    META_APP_ID: "1630558868447132",
    META_APP_SECRET: "test-app-secret-long-enough",
    META_EMBEDDED_SIGNUP_CONFIG_ID: "123456789",
    META_WEBHOOK_VERIFY_TOKEN: "global-verify-token-with-more-than-32-chars",
    NEXTAUTH_URL: "https://fechai.test",
  });
  mocks.session.mockResolvedValue({
    tenantId: "clinic",
    session: { user: { id: "owner" } },
  });
  mocks.tenant.mockResolvedValue({
    status: "active",
    metaWhatsappEnabled: true,
  });
  mocks.user.mockResolvedValue({ usesProduct: true, tenantId: "clinic" });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.start.mockResolvedValue({ attemptId: "a".repeat(43) });
});
describe("Acesso às três etapas do cadastro da Meta", () => {
  it.each(["start", "authorize", "finish"])(
    "recusa Meta recolhida na etapa %s",
    async (step) => {
      mocks.tenant.mockResolvedValue({
        status: "active",
        metaWhatsappEnabled: false,
      });
      expect(
        (await POST(request({ ...input, step, wabaId: "913243131777343" })))
          .status,
      ).toBe(403);
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.authorize).not.toHaveBeenCalled();
      expect(mocks.finish).not.toHaveBeenCalled();
    },
  );
  it("recusa conta suspensa, sem produto e usuário de outro tenant", async () => {
    mocks.tenant.mockResolvedValueOnce({
      status: "suspended",
      metaWhatsappEnabled: true,
    });
    expect((await POST(request())).status).toBe(403);
    mocks.user.mockResolvedValueOnce({
      usesProduct: false,
      tenantId: "clinic",
    });
    expect((await POST(request())).status).toBe(403);
    mocks.user.mockResolvedValueOnce({ usesProduct: true, tenantId: "other" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("recusa origem externa mesmo com cookies e não aceita tenant enviado pelo browser", async () => {
    expect((await POST(request(input, "https://evil.test"))).status).toBe(403);
    await POST(request({ ...input, tenantId: "other" }));
    expect(mocks.authorize).toHaveBeenCalledWith(
      { tenantId: "clinic", userId: "owner" },
      input.attemptId,
      input.code,
    );
  });
  it("sessão expirada retorna 401 JSON, sem redirecionar a chamada para HTML", async () => {
    mocks.session.mockRejectedValueOnce({
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("não expõe exceção interna nem credenciais e não devolve o token autorizado", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("secret-business-token"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await POST(request());
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("secret-business-token");
    mocks.authorize.mockResolvedValueOnce("secret-business-token");
    expect(await (await POST(request())).json()).toEqual({ ok: true });
  });
  it("recusa corpo excessivo, IDs malformados e frequência excessiva", async () => {
    expect(
      (await POST(request({ ...input, code: "a".repeat(17000) }))).status,
    ).toBe(413);
    expect(
      (await POST(request({ ...input, attemptId: "../other" }))).status,
    ).toBe(422);
    mocks.rate.mockResolvedValueOnce({ allowed: false });
    expect((await POST(request())).status).toBe(429);
  });
});
