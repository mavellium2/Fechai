import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  changeAccess: vi.fn(),
  recordChange: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/redis", () => ({ redis: {} }));
vi.mock("@/modules/crm/activation", () => ({ setCrmEnabled: mocks.changeAccess }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: vi.fn(), recordChange: mocks.recordChange }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setTenantCrmEnabled } from "@/app/(admin)/actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { role: "SUPERADMIN" } });
});

describe("liberação do CRM pelo admin", () => {
  it("verifica sessão e papel antes de qualquer mudança", async () => {
    mocks.auth.mockResolvedValueOnce(null).mockResolvedValueOnce({ user: { role: "OWNER" } });

    await expect(setTenantCrmEnabled("conta-1", true)).resolves.toMatchObject({ ok: false, code: "auth" });
    await expect(setTenantCrmEnabled("conta-1", true)).resolves.toMatchObject({ ok: false, code: "forbidden" });
    await expect(setTenantCrmEnabled("", true)).resolves.toMatchObject({ ok: false, code: "validation" });
    expect(mocks.changeAccess).not.toHaveBeenCalled();
  });

  it.each([true, false])("audita a mudança efetiva de acesso para %s", async (enabled) => {
    mocks.changeAccess.mockResolvedValue("changed");

    await expect(setTenantCrmEnabled("conta-1", enabled)).resolves.toMatchObject({ ok: true });
    expect(mocks.changeAccess).toHaveBeenCalledWith("conta-1", enabled);
    expect(mocks.recordChange).toHaveBeenCalledWith({
      tenantId: "conta-1",
      event: "admin.crm_access_changed",
      target: { type: "Tenant", id: "conta-1" },
      before: { crmEnabled: !enabled },
      after: { crmEnabled: enabled },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/crm");
  });

  it("revalida a conta quando outra solicitação prevalece e não cria log de mudança", async () => {
    mocks.changeAccess.mockResolvedValueOnce("superseded").mockResolvedValueOnce("unchanged");

    await expect(setTenantCrmEnabled("conta-1", true)).resolves.toMatchObject({ ok: false });
    await expect(setTenantCrmEnabled("conta-1", true)).resolves.toMatchObject({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/contas");
    expect(mocks.recordChange).not.toHaveBeenCalled();
  });
});
