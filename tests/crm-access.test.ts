import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProductAccess: vi.fn(),
  tenant: vi.fn(),
  pipeline: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: mocks.requireProductAccess }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  tenant: { findUnique: mocks.tenant },
  pipeline: { findUnique: mocks.pipeline },
} }));

import { getCrmOverview, requireCrmAccess } from "@/modules/crm/access";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireProductAccess.mockResolvedValue({ session: { user: { tenantId: "tenant-a", role: "OWNER" } } });
  mocks.tenant.mockResolvedValue({ id: "tenant-a", status: "active", crmEnabled: true });
});

describe("acesso à página de CRM", () => {
  it.each([
    { crmEnabled: false, status: "active" },
    { crmEnabled: true, status: "suspended" },
    null,
  ])("protege a visão sem conta ativa e liberada (%j)", async (tenant) => {
    mocks.tenant.mockResolvedValue(tenant);

    await expect(getCrmOverview()).rejects.toThrow("NOT_FOUND");
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it("herda a autorização do produto antes de consultar a conta", async () => {
    mocks.requireProductAccess.mockRejectedValue(new Error("AFFILIATE_ONLY"));

    await expect(requireCrmAccess()).rejects.toThrow("AFFILIATE_ONLY");
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it("usa o tenant da sessão e conta apenas leads reais nas etapas ativas", async () => {
    const overview = { name: "Pipeline", stages: [{ id: "etapa-a", name: "Novo lead", _count: { leads: 8 } }] };
    mocks.pipeline.mockResolvedValue(overview);

    await expect(getCrmOverview()).resolves.toEqual(overview);
    expect(mocks.tenant).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tenant-a" } }));
    expect(mocks.pipeline).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "tenant-a", key: "default" }, tenant: { status: "active", crmEnabled: true } },
      select: {
        name: true,
        stages: expect.objectContaining({
          where: { tenantId: "tenant-a", archivedAt: null },
          select: {
            id: true,
            name: true,
            kind: true,
            _count: { select: { leads: { where: {
              tenantId: "tenant-a",
              isTest: false,
              OR: [
                { conversation: { is: null } },
                { conversation: { is: { tenantId: "tenant-a", isTest: false } } },
              ],
            } } } },
          },
        }),
      },
    });
  });
});
