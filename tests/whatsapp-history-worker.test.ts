import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), claim: vi.fn(), update: vi.fn(), register: vi.fn(), connection: vi.fn(), readPage: vi.fn(), import: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  whatsappHistoryRecovery: { findMany: mocks.findMany, updateMany: mocks.claim, update: mocks.update },
  whatsappHistoryRecoveryItem: { createMany: mocks.register }, whatsappInstance: { findFirst: vi.fn(async () => ({ id: "instance" })) },
  $transaction: mocks.transaction,
} }));
vi.mock("@/modules/whatsapp/history-recovery", () => ({ recoveryConnection: mocks.connection }));
vi.mock("@/modules/whatsapp/history-recovery-import", () => ({ importHistoryMessages: mocks.import }));
vi.mock("@/modules/whatsapp/evolution-history", () => ({
  readEvolutionHistoryPage: mocks.readPage,
  readHistoryMessage: (raw: { id: string }) => ({ message: { sourceId: raw.id, id: raw.id } }),
}));
import { prisma } from "@/lib/prisma";
import { scanWhatsappHistoryRecovery } from "@/modules/whatsapp/history-recovery-worker";
const now = new Date("2026-10-26T12:00:00Z");
const run = { id: "run-A", tenantId: "tenant-A", externalId: "clinic-A", status: "queued", page: 1,
  sourceTotal: null, stats: {}, since: new Date("2026-09-26T12:00:00Z"), until: now };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([run]); mocks.claim.mockResolvedValue({ count: 1 }); mocks.update.mockResolvedValue({});
  mocks.register.mockResolvedValue({ count: 1 }); mocks.connection.mockResolvedValue("clinic-A");
  mocks.readPage.mockResolvedValue({ total: 1, pages: 1, records: [{ id: "wa-1" }] });
  mocks.transaction.mockImplementation(async (fn) => fn(prisma));
  mocks.import.mockImplementation(async (_db, _tenant, messages, stats) => { stats.imported += messages.length; });
});
describe("Reconciliação durável de 30 dias", () => {
  it("não processa sem ganhar o claim, inclusive com vários workers", async () => {
    mocks.claim.mockResolvedValue({ count: 0 });
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.readPage).not.toHaveBeenCalled(); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("perder o lease durante a leitura impede gravar a página", async () => {
    mocks.claim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.import).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("grava mensagens, contagens e avanço da página juntos", async () => {
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.import).toHaveBeenCalledWith(prisma, "tenant-A", expect.any(Array), expect.any(Object), expect.any(Date));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-A", tenantId: "tenant-A" }, data: expect.objectContaining({ status: "completed", page: 2, stats: expect.objectContaining({ scanned: 1, imported: 1 }) }) }));
  });
  it("continua da página persistida depois de reinício", async () => {
    mocks.findMany.mockResolvedValue([{ ...run, page: 4, sourceTotal: 301, stats: { scanned: 300 } }]);
    mocks.readPage.mockResolvedValue({ total: 301, pages: 4, records: [{ id: "wa-301" }] });
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.readPage).toHaveBeenCalledWith("clinic-A", run.since, run.until, 4);
    expect(mocks.update.mock.calls[0][0].data.status).toBe("completed");
  });
  it("página repetida ou total alterado não vira recuperação completa", async () => {
    mocks.register.mockResolvedValue({ count: 0 });
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.update.mock.calls[0][0].data.status).toBe("failed");
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([{ ...run, sourceTotal: 2 }]);
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.import).not.toHaveBeenCalled();
    expect(mocks.claim.mock.calls.at(-1)?.[0].data.status).toBe("failed");
  });
  it("falha da origem não avança cursor e não vaza erro técnico", async () => {
    mocks.readPage.mockRejectedValue(new Error("secret SQL stack"));
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.update).not.toHaveBeenCalled();
    const data = mocks.claim.mock.calls.at(-1)?.[0].data;
    expect(data.status).toBe("failed"); expect(data.error).not.toContain("secret"); expect(data.page).toBeUndefined();
  });
  it("troca de instância interrompe sem ler outra conexão", async () => {
    mocks.connection.mockResolvedValue("clinic-other");
    await scanWhatsappHistoryRecovery(now);
    expect(mocks.readPage).not.toHaveBeenCalled();
  });
});
