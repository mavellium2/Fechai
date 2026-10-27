import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), product: vi.fn(), tenant: vi.fn(), start: vi.fn(), read: vi.fn(), connection: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSuperadmin: mocks.admin, requireTenant: mocks.tenant }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: mocks.product }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("@/modules/whatsapp/history-recovery", () => ({ startHistoryRecovery: mocks.start, readHistoryRecovery: mocks.read, recoveryConnection: mocks.connection }));
import { recoverWhatsappHistory } from "@/app/(dashboard)/integracoes/history-recovery-actions";
import { GET } from "@/app/api/whatsapp/historico/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ user: { id: "real-admin" } });
  mocks.tenant.mockResolvedValue({ tenantId: "effective-tenant" }); mocks.product.mockResolvedValue({});
  mocks.start.mockResolvedValue("run-1"); mocks.read.mockResolvedValue(null); mocks.connection.mockResolvedValue("clinic");
});
describe("Autorização da recuperação em lote", () => {
  it("início e leitura exigem superadmin antes de qualquer dado", async () => {
    mocks.admin.mockRejectedValue(new Error("denied"));
    await expect(recoverWhatsappHistory()).rejects.toThrow("denied");
    await expect(GET()).rejects.toThrow("denied");
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("usa só conta da sessão e usuário real do admin", async () => {
    await Reflect.apply(recoverWhatsappHistory, null, [{ ok: true, run: { tenantId: "forged" } }]);
    expect(mocks.product).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith("effective-tenant", "real-admin");
    expect(mocks.read).toHaveBeenCalledWith("effective-tenant");
  });
  it("pulso exige liberação e não devolve conteúdo de conversa", async () => {
    const response = await GET();
    expect(mocks.connection).toHaveBeenCalledWith("effective-tenant");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ run: null });
  });
  it("falha de conexão não expõe credenciais nem erro técnico", async () => {
    mocks.connection.mockRejectedValue(new Error("apikey=secret"));
    const response = await GET(); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
