import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Envio semanal do relatório de campanhas ao grupo das perguntas.
 * O que importa: sai uma vez por semana, falha de rede nunca repete sozinha, e
 * o que não foi tentado (sem grupo, sem conexão, sem anúncio) devolve o horário.
 */

const db = vi.hoisted(() => ({
  campaignReportSettings: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  knowledgeGapSettings: { findUnique: vi.fn() },
  tenant: { findUnique: vi.fn() },
}));
const group = vi.hoisted(() => ({
  sendToInternalGroup: vi.fn(),
  sendDocumentToInternalGroup: vi.fn(),
  sendToInternalPhone: vi.fn(),
  sendDocumentToInternalPhone: vi.fn(),
}));
const pdf = vi.hoisted(() => ({ fail: false }));
const queries = vi.hoisted(() => ({ loadCampaignReport: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/knowledge-gaps/group", () => group);
vi.mock("@/modules/campaign-reports/queries", () => queries);
// O PDF é de verdade; só dá para forçar a falha da geração (o texto de reserva).
vi.mock("@/modules/campaign-reports/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/campaign-reports/pdf")>();
  return { ...actual, generateCampaignPdf: (input: Parameters<typeof actual.generateCampaignPdf>[0]) => pdf.fail ? Promise.reject(new Error("pdf quebrou")) : actual.generateCampaignPdf(input) };
});

import { deliverCampaignReport, scanCampaignReports } from "@/modules/campaign-reports/send";
import { summarizeCampaigns } from "@/modules/campaign-reports/summary";

const FRIDAY_8H30 = new Date("2026-10-30T11:30:00Z");
const SLOT = new Date("2026-10-30T11:00:00Z");
const report = { current: summarizeCampaigns([], FRIDAY_8H30), previous: null, trackedSince: new Date("2026-09-01T12:00:00Z") };

const settingsRow = (over: Record<string, unknown> = {}) => ({
  tenantId: "t1", enabled: true, weekday: 5, hour: 8, timezone: "America/Sao_Paulo", lastSentAt: null, lastStatus: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  db.campaignReportSettings.findMany.mockResolvedValue([settingsRow()]);
  db.campaignReportSettings.findUnique.mockResolvedValue(settingsRow());
  db.campaignReportSettings.updateMany.mockResolvedValue({ count: 1 });
  db.knowledgeGapSettings.findUnique.mockResolvedValue({ groupId: "120363@g.us" });
  queries.loadCampaignReport.mockResolvedValue(report);
  db.tenant.findUnique.mockResolvedValue({ name: "Instituto Teste" });
  group.sendToInternalGroup.mockResolvedValue(true);
  group.sendDocumentToInternalGroup.mockResolvedValue(true);
  pdf.fail = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deliverCampaignReport", () => {
  it("envia ao grupo das perguntas e grava o estado", async () => {
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("sent");
    expect(group.sendDocumentToInternalGroup).toHaveBeenCalledWith("t1", "120363@g.us", expect.objectContaining({
      mimetype: "application/pdf",
      fileName: expect.stringMatching(/^relatorio-campanhas-2026-10-23-a-2026-10-29\.pdf$/),
      caption: expect.stringContaining("Relatório semanal de campanhas"),
      base64: expect.stringMatching(/^JVBERi0/), // "%PDF-" em base64
    }));
    expect(group.sendToInternalGroup).not.toHaveBeenCalled();
    expect(db.campaignReportSettings.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "t1" }, data: { lastStatus: "sent", lastSentAt: FRIDAY_8H30 },
    });
  });

  it("sem grupo escolhido não monta nem envia nada", async () => {
    db.knowledgeGapSettings.findUnique.mockResolvedValue(null);
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("no_group");
    expect(queries.loadCampaignReport).not.toHaveBeenCalled();
    expect(group.sendDocumentToInternalGroup).not.toHaveBeenCalled();
  });

  it("conta que nunca registrou anúncio não recebe relatório vazio", async () => {
    queries.loadCampaignReport.mockResolvedValue({ ...report, trackedSince: null });
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("no_data");
    expect(group.sendDocumentToInternalGroup).not.toHaveBeenCalled();
  });

  it("WhatsApp por QR fora do ar vira no_channel (nada foi tentado)", async () => {
    group.sendDocumentToInternalGroup.mockResolvedValue(false);
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("no_channel");
  });

  it("erro no envio vira failed e não derruba", async () => {
    group.sendDocumentToInternalGroup.mockRejectedValue(new Error("timeout"));
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("failed");
    expect(db.campaignReportSettings.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1" }, data: { lastStatus: "failed" } });
  });
});

describe("texto de reserva", () => {
  it("se o PDF não puder ser gerado, o relatório sai em texto (não deixa de chegar)", async () => {
    pdf.fail = true;
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("sent");
    expect(group.sendDocumentToInternalGroup).not.toHaveBeenCalled();
    expect(group.sendToInternalGroup).toHaveBeenCalledWith("t1", "120363@g.us", expect.stringContaining("Relatório semanal de campanhas"));
  });
});

describe("scanCampaignReports", () => {
  it("envia na hora marcada, reivindicando o horário antes", async () => {
    await expect(scanCampaignReports(FRIDAY_8H30)).resolves.toEqual({ sent: 1, waiting: 0 });
    const claim = db.campaignReportSettings.updateMany.mock.calls[0][0];
    expect(claim.where.OR).toEqual([{ lastSentAt: null }, { lastSentAt: { lt: SLOT } }]);
    expect(claim.data).toEqual({ lastSentAt: FRIDAY_8H30 });
    expect(group.sendDocumentToInternalGroup).toHaveBeenCalledTimes(1);
  });

  it("fora do dia ou da hora não faz nada", async () => {
    await expect(scanCampaignReports(new Date("2026-10-29T11:30:00Z"))).resolves.toEqual({ sent: 0, waiting: 0 });
    await expect(scanCampaignReports(new Date("2026-10-30T10:30:00Z"))).resolves.toEqual({ sent: 0, waiting: 0 });
    expect(db.campaignReportSettings.updateMany).not.toHaveBeenCalled();
  });

  it("não envia duas vezes: outro worker já reivindicou", async () => {
    db.campaignReportSettings.updateMany.mockResolvedValue({ count: 0 });
    await expect(scanCampaignReports(FRIDAY_8H30)).resolves.toEqual({ sent: 0, waiting: 0 });
    expect(group.sendDocumentToInternalGroup).not.toHaveBeenCalled();
  });

  it("sem grupo devolve o horário para a próxima volta tentar", async () => {
    db.knowledgeGapSettings.findUnique.mockResolvedValue(null);
    await expect(scanCampaignReports(FRIDAY_8H30)).resolves.toEqual({ sent: 0, waiting: 1 });
    const restore = db.campaignReportSettings.updateMany.mock.calls.at(-1)![0];
    expect(restore).toEqual({ where: { tenantId: "t1", lastSentAt: FRIDAY_8H30 }, data: { lastSentAt: null } });
  });

  it("falha de envio NÃO devolve o horário: nunca repete sozinha", async () => {
    group.sendDocumentToInternalGroup.mockRejectedValue(new Error("timeout"));
    await expect(scanCampaignReports(FRIDAY_8H30)).resolves.toEqual({ sent: 0, waiting: 0 });
    const restores = db.campaignReportSettings.updateMany.mock.calls.filter(([arg]) => arg.data.lastSentAt === null);
    expect(restores).toHaveLength(0);
  });

  it("conta desligada nem é lida", async () => {
    db.campaignReportSettings.findMany.mockResolvedValue([]);
    await expect(scanCampaignReports(FRIDAY_8H30)).resolves.toEqual({ sent: 0, waiting: 0 });
    expect(db.campaignReportSettings.findMany).toHaveBeenCalledWith({ where: { enabled: true, tenant: { status: "active" } } });
  });
});
