import { beforeEach, describe, expect, it, vi } from "vitest";

/** `--actor` dos scripts da campanha: superadmin ou usuário da própria conta. */

const users = vi.hoisted(() => ({
  rows: [] as { id: string; email: string; role: string; tenantId: string }[],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.rows.find((u) => u.id === where.id) ?? null) } },
}));

import { resolveScriptActor } from "@/modules/campaign-override/actor";

beforeEach(() => {
  users.rows = [
    { id: "dono", email: "dono@clinica.test", role: "OWNER", tenantId: "t1" },
    { id: "outro", email: "outro@outra.test", role: "OWNER", tenantId: "t2" },
    { id: "admin", email: "admin@fechai.test", role: "SUPERADMIN", tenantId: "t9" },
  ];
});

describe("resolveScriptActor", () => {
  it("aceita usuário da própria conta e o superadmin", async () => {
    expect(await resolveScriptActor("dono", "t1")).toMatchObject({ ok: true, actor: { id: "dono", role: "OWNER" } });
    expect(await resolveScriptActor("admin", "t1")).toMatchObject({ ok: true, actor: { id: "admin", role: "SUPERADMIN" } });
  });

  it("recusa usuário de outra conta e usuário inexistente, sem dado pessoal na mensagem", async () => {
    const other = await resolveScriptActor("outro", "t1");
    expect(other.ok).toBe(false);
    const missing = await resolveScriptActor("fantasma", "t1");
    expect(missing.ok).toBe(false);
    for (const result of [other, missing]) {
      if (!result.ok) expect(result.message).not.toMatch(/@|outra\.test/);
    }
  });
});
