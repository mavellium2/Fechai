import { beforeEach, describe, expect, it, vi } from "vitest";

/** Gravação da origem: o primeiro anúncio vence e registrar nunca lança. */

const db = vi.hoisted(() => ({ leadAdOrigin: { createMany: vi.fn(), updateMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { recordLeadAdOrigin } from "@/modules/campaign-reports/record";

const origin = { sourceId: "120251508234490338", code: "AD37", name: "Prótese Protocolo", sourceUrl: "https://fb.me/x", platform: "facebook" as const };
const input = { tenantId: "t1", leadId: "l1", origin, at: new Date("2026-10-29T15:44:00Z"), via: "webhook" as const };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordLeadAdOrigin", () => {
  it("grava a primeira origem do lead", async () => {
    db.leadAdOrigin.createMany.mockResolvedValue({ count: 1 });
    await expect(recordLeadAdOrigin(input)).resolves.toEqual({ status: "created" });
    expect(db.leadAdOrigin.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ tenantId: "t1", leadId: "l1", code: "AD37", capturedVia: "webhook", firstAdAt: input.at })],
      skipDuplicates: true,
    });
  });

  it("lead que já tinha origem não é sobrescrito", async () => {
    db.leadAdOrigin.createMany.mockResolvedValue({ count: 0 });
    db.leadAdOrigin.updateMany.mockResolvedValue({ count: 0 });
    await expect(recordLeadAdOrigin(input)).resolves.toEqual({ status: "exists" });
    // só completa código que faltava, do MESMO anúncio, nunca troca de anúncio
    expect(db.leadAdOrigin.updateMany).toHaveBeenCalledWith({
      where: { leadId: "l1", tenantId: "t1", code: null, sourceId: "120251508234490338" },
      data: { code: "AD37", name: "Prótese Protocolo" },
    });
  });

  it("sem código na nova mensagem não mexe no que existe", async () => {
    db.leadAdOrigin.createMany.mockResolvedValue({ count: 0 });
    await recordLeadAdOrigin({ ...input, origin: { ...origin, code: null, name: null } });
    expect(db.leadAdOrigin.updateMany).not.toHaveBeenCalled();
  });

  it("erro do banco nunca lança", async () => {
    db.leadAdOrigin.createMany.mockRejectedValue(new Error("db fora do ar"));
    await expect(recordLeadAdOrigin(input)).resolves.toEqual({ status: "failed" });
  });
});
