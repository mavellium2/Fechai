import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { isStrongPassword } from "@/lib/password";

/**
 * O admin troca a senha de usuário comum — nunca de outra conta de admin — e a
 * senha provisória gerada já nasce dentro da política.
 */

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/bunny", () => ({ deleteFromBunny: vi.fn(async () => {}) }));
vi.mock("@/modules/voice/fish", () => ({ deleteVoice: vi.fn(async () => {}) }));
vi.mock("@/modules/tenants/provision", () => ({ createTenantWithOwner: vi.fn() }));
vi.mock("@/modules/whatsapp/meta-config", () => ({ WHATSAPP_PROVIDER_SELECT: {} }));

import { adminSetUserPassword } from "@/modules/admin/service";

const owner = { id: "u1", email: "dona@clinica.com", role: "OWNER", tenantId: "t1" };

beforeEach(() => {
  vi.clearAllMocks();
  db.user.update.mockResolvedValue({});
});

describe("admin troca senha de usuário", () => {
  it("grava o hash da senha digitada, nunca o texto", async () => {
    db.user.findUnique.mockResolvedValue(owner);
    const result = await adminSetUserPassword("u1", "Nova#Senha7x");
    expect(result).toEqual({ ok: true, email: owner.email, tenantId: "t1", tempPassword: undefined });
    const { data, where } = db.user.update.mock.calls[0][0];
    expect(where).toEqual({ id: "u1" });
    expect(data.passwordHash).not.toContain("Nova#Senha7x");
    expect(await bcrypt.compare("Nova#Senha7x", data.passwordHash)).toBe(true);
  });

  it("sem senha digitada, gera uma provisória forte e a devolve uma vez", async () => {
    db.user.findUnique.mockResolvedValue(owner);
    const result = await adminSetUserPassword("u1", "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tempPassword).toBeTruthy();
    expect(isStrongPassword(result.tempPassword!)).toBe(true);
    expect(await bcrypt.compare(result.tempPassword!, db.user.update.mock.calls[0][0].data.passwordHash)).toBe(true);
  });

  it("recusa conta de admin e usuário inexistente, sem gravar nada", async () => {
    db.user.findUnique.mockResolvedValueOnce({ ...owner, role: "SUPERADMIN" });
    expect(await adminSetUserPassword("u1", "Nova#Senha7x")).toMatchObject({ ok: false });
    db.user.findUnique.mockResolvedValueOnce(null);
    expect(await adminSetUserPassword("x", "Nova#Senha7x")).toEqual({
      ok: false,
      error: "Usuário não encontrado.",
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
