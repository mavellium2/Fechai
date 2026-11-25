import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireProductAccess: vi.fn(), tenant: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: mocks.requireProductAccess }));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: mocks.tenant } } }));

import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { requireCrmSession } from "@/modules/crm/access";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("matriz de permissões", () => {
  it("o login da conta (OWNER) tem todas as permissões do catálogo", () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(hasPermission("OWNER", permission)).toBe(true);
    }
  });

  it.each([undefined, null, "", "SUPERADMIN", "ATENDENTE", "constructor", "__proto__"])(
    "nega por padrão papel desconhecido ou sem permissão (%j)",
    (role) => expect(hasPermission(role, "crm:ver")).toBe(false),
  );
});

describe("guarda crm:ver", () => {
  it("libera a sessão de quem tem a permissão", async () => {
    const session = { user: { id: "u1", tenantId: "t1", role: "OWNER" } };
    mocks.requireProductAccess.mockResolvedValue({ session });
    await expect(requireCrmSession()).resolves.toBe(session);
  });

  it("recusa no servidor quem não tem a permissão, antes de ler a conta", async () => {
    mocks.requireProductAccess.mockResolvedValue({ session: { user: { id: "u1", tenantId: "t1", role: "SUPERADMIN" } } });
    await expect(requireCrmSession()).rejects.toThrow("NOT_FOUND");
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
});

describe("toda action e rota do CRM passa pelo guarda", () => {
  const root = join(__dirname, "..");
  const files = [
    "src/app/(dashboard)/crm/actions.ts",
    "src/app/(dashboard)/crm/reply-actions.ts",
    "src/app/(dashboard)/crm/etapas/actions.ts",
    "src/app/api/crm/pulso/route.ts",
  ];

  it.each(files)("%s", (file) => {
    const source = readFileSync(join(root, file), "utf8");
    expect(source).not.toContain("requireProductAccess");
    const exported = source.split(/^export async function /m).slice(1);
    expect(exported.length).toBeGreaterThan(0);
    for (const body of exported) {
      const name = body.slice(0, body.indexOf("("));
      expect(body.includes("requireCrmSession()"), `${file}: ${name} sem requireCrmSession`).toBe(true);
    }
  });
});
