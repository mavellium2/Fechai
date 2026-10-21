import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const db = vi.hoisted(() => ({
  whatsappInstance: { findMany: vi.fn() },
  tenant: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  EVOLUTION_DISABLED_ROW,
  getWhatsappStatus,
  isEvolutionEnabled,
  listWhatsappChannels,
  pickWhatsappChannel,
} from "@/modules/whatsapp/instances";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

beforeEach(() => vi.clearAllMocks());

describe("Liberação administrativa do WhatsApp por QR (Evolution)", () => {
  it("nasce ligada para todo tenant, ao contrário da Meta", () => {
    expect(read("prisma/schema.prisma")).toMatch(/evolutionWhatsappEnabled\s+Boolean\s+@default\(true\)/);
  });

  it("a action do admin só muda a flag: sem logout, sem mexer nas linhas nem na Meta", () => {
    const actions = read("src/app/(admin)/actions.ts");
    const start = actions.indexOf("export async function setTenantEvolutionWhatsappEnabled");
    const end = actions.indexOf("export async function markFeedback", start);
    const body = actions.slice(start, end);

    expect(body).toContain("requireSuperadmin()");
    expect(body).toContain("evolutionWhatsappEnabled: enabled");
    expect(body).toContain("admin.evolution_whatsapp_access_changed");
    // Sessão mantida: reativar volta sem novo QR.
    expect(body).not.toContain("whatsappInstance");
    expect(body).not.toContain(".disconnect(");
    expect(body).not.toContain('provider: "meta"');
    expect(body).not.toContain("externalId: null");
  });

  it("protege conectar, atualizar o QR e o agente do QR no servidor", () => {
    const actions = read("src/app/(dashboard)/integracoes/actions.ts");
    expect(actions).toContain("EVOLUTION_WHATSAPP_NOT_ENABLED");
    const checks = actions.match(/isEvolutionEnabled\(tenantId\)/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(3);

    // Desconectar continua permitido: o cliente pode soltar o número.
    const start = actions.indexOf("export async function disconnectWhatsapp");
    const end = actions.indexOf("\nexport async function", start + 1);
    expect(actions.slice(start, end < 0 ? undefined : end)).not.toContain("isEvolutionEnabled");
  });

  it("o webhook da Evolution ignora a conta desligada com 200, sem processar", () => {
    const incoming = read("src/modules/whatsapp/process-incoming.ts");
    expect(incoming).toContain("evolutionWhatsappEnabled: true");
    expect(incoming).toMatch(/provider\.name === "evolution" && instance\.tenant\?\.evolutionWhatsappEnabled === false/);
  });

  it("o monitor de saúde pula o QR desligado", () => {
    const health = read("src/modules/whatsapp/health.ts");
    expect(health).toMatch(/channelProvider\(row\) === "evolution" && row\.tenant\.evolutionWhatsappEnabled === false/);
  });

  it("/integracoes não monta o QR nem o botão de conectar com o QR desligado", () => {
    const page = read("src/app/(dashboard)/integracoes/page.tsx");
    expect(page).toContain("evolutionWhatsappEnabled: true");
    // Aviso só para quem já conectou o QR; quem nunca conectou não vê nada.
    expect(page).toContain("const evolutionDisabledNotice = !evolutionEnabled && Boolean(evolutionRow?.externalId)");
    expect(page).toContain("const autoStartQr = evolutionEnabled &&");
  });
});

describe("Canais com o QR desligado", () => {
  it("listWhatsappChannels exclui só a linha Evolution da conta desligada", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([]);
    await listWhatsappChannels("tenant-1");

    expect(db.whatsappInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-1", NOT: EVOLUTION_DISABLED_ROW } }),
    );
    expect(EVOLUTION_DISABLED_ROW).toEqual({
      provider: { not: "meta" },
      tenant: { evolutionWhatsappEnabled: false },
    });
  });

  it("sem a linha do QR o contato do QR espera — nunca cai para a Meta", () => {
    const soMeta = [{ provider: "meta", status: "connected", externalId: "pn-1" }];

    expect(pickWhatsappChannel(soMeta, "evolution")).toBeNull();
    // Contato que escreveu pela Meta segue normal.
    expect(pickWhatsappChannel(soMeta, "meta")).toBe(soMeta[0]);
  });

  it("o estado da conta em uma palavra também ignora o QR desligado", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([]);
    await expect(getWhatsappStatus("tenant-1")).resolves.toBe("disconnected");
    expect(db.whatsappInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-1", NOT: EVOLUTION_DISABLED_ROW } }),
    );
  });

  it("isEvolutionEnabled: só false bloqueia; conta sem a flag ou inexistente vale como liberada", async () => {
    db.tenant.findUnique.mockResolvedValueOnce({ evolutionWhatsappEnabled: false });
    await expect(isEvolutionEnabled("t")).resolves.toBe(false);
    db.tenant.findUnique.mockResolvedValueOnce({ evolutionWhatsappEnabled: true });
    await expect(isEvolutionEnabled("t")).resolves.toBe(true);
    db.tenant.findUnique.mockResolvedValueOnce({});
    await expect(isEvolutionEnabled("t")).resolves.toBe(true);
    db.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(isEvolutionEnabled("t")).resolves.toBe(true);
  });
});
