import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Para onde vai o relatório de campanhas (um grupo ou um número) e a importação
 * do histórico de anúncios pedida pela tela.
 * O que importa: os dois destinos ficam guardados; número só pelo QR e só para
 * quem a clínica pode procurar; a importação é pedida pela tela mas lida pelo
 * worker, uma por vez, e o resumo só tem contagens.
 */

const db = vi.hoisted(() => ({
  campaignReportSettings: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  knowledgeGapSettings: { findUnique: vi.fn() },
  conversation: { findMany: vi.fn() },
  tenant: { findUnique: vi.fn() },
}));
const group = vi.hoisted(() => ({ sendDocumentToInternalGroup: vi.fn(), sendDocumentToInternalPhone: vi.fn(), sendToInternalGroup: vi.fn(), sendToInternalPhone: vi.fn() }));
const queries = vi.hoisted(() => ({ loadCampaignReport: vi.fn() }));
const blocklist = vi.hoisted(() => ({ isPhoneBlocked: vi.fn() }));
const instances = vi.hoisted(() => ({ findWhatsappChannel: vi.fn() }));
const backfill = vi.hoisted(() => ({ backfillAdOrigins: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/knowledge-gaps/group", () => group);
vi.mock("@/modules/campaign-reports/queries", () => queries);
vi.mock("@/modules/whatsapp/blocklist", () => blocklist);
vi.mock("@/modules/whatsapp/instances", () => instances);
vi.mock("@/modules/campaign-reports/backfill", () => backfill);

import { isPhoneRefused } from "@/modules/campaign-reports/phone";
import { deliverCampaignReport, scanCampaignReports } from "@/modules/campaign-reports/send";
import { summarizeCampaigns } from "@/modules/campaign-reports/summary";
import {
  HISTORY_STALE_MS,
  canRequestHistoryImport,
  formatReportPhone,
  parseCampaignSettings,
  type CampaignSettings,
} from "@/modules/campaign-reports/settings";
import { campaignSettingsFormSchema, destinationProblem } from "@/modules/campaign-reports/settings-store";
import {
  requestHistoryImport,
  runPendingHistoryImports,
  summarizeHistoryImport,
} from "@/modules/campaign-reports/history-import";
import { normalizeBrazilianPhone } from "@/modules/whatsapp/contact-phone";

const FRIDAY_8H30 = new Date("2026-10-30T11:30:00Z");
const report = { current: summarizeCampaigns([], FRIDAY_8H30), previous: null, trackedSince: new Date("2026-09-01T12:00:00Z") };
const GROUP = "120363111111111111@g.us";
const OTHER_GROUP = "120363222222222222@g.us";

const row = (over: Record<string, unknown> = {}) => ({
  tenantId: "t1", enabled: true, weekday: 5, hour: 8, timezone: "America/Sao_Paulo", lastSentAt: null, lastStatus: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  db.campaignReportSettings.findMany.mockResolvedValue([row()]);
  db.campaignReportSettings.findUnique.mockResolvedValue(row());
  db.campaignReportSettings.updateMany.mockResolvedValue({ count: 1 });
  db.campaignReportSettings.upsert.mockResolvedValue(row());
  db.knowledgeGapSettings.findUnique.mockResolvedValue({ groupId: GROUP });
  db.conversation.findMany.mockResolvedValue([]);
  queries.loadCampaignReport.mockResolvedValue(report);
  db.tenant.findUnique.mockResolvedValue({ name: "Instituto Teste" });
  group.sendDocumentToInternalGroup.mockResolvedValue(true);
  group.sendDocumentToInternalPhone.mockResolvedValue(true);
  blocklist.isPhoneBlocked.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("normalizeBrazilianPhone", () => {
  it("aceita DDD, 55 e pontuação; recusa o que não parece número", () => {
    expect(normalizeBrazilianPhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeBrazilianPhone("+55 11 98765-4321")).toBe("5511987654321");
    expect(normalizeBrazilianPhone("11 3456-7890")).toBe("551134567890");
    expect(normalizeBrazilianPhone("12345")).toBeNull();
    expect(normalizeBrazilianPhone("")).toBeNull();
  });
});

describe("settings: destino", () => {
  it("o padrão é grupo, sem grupo próprio e sem número", () => {
    expect(parseCampaignSettings(null)).toMatchObject({ destination: "group", groupId: null, groupName: null, phone: null });
  });

  it("guarda número e grupo ao mesmo tempo", () => {
    expect(parseCampaignSettings({ destination: "phone", groupId: GROUP, groupName: "Equipe", phone: "5511987654321" }))
      .toMatchObject({ destination: "phone", groupId: GROUP, groupName: "Equipe", phone: "5511987654321" });
  });

  it("valor estranho vira vazio, nunca lança", () => {
    expect(parseCampaignSettings({ destination: "email", groupId: "abc", groupName: "Sem grupo válido", phone: "123" }))
      .toMatchObject({ destination: "group", groupId: null, groupName: null, phone: null });
  });

  it("mostra o número guardado com DDD", () => {
    expect(formatReportPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(formatReportPhone("551134567890")).toBe("(11) 3456-7890");
  });
});

describe("formulário do envio", () => {
  const base = { enabled: "on", weekday: "5", hour: "8", timezone: "America/Sao_Paulo", destination: "group", groupId: "", groupName: "", phone: "" };

  it("normaliza número e grupo, e guarda os dois", () => {
    const r = campaignSettingsFormSchema.safeParse({ ...base, destination: "phone", phone: "(11) 98765-4321", groupId: "120363111111111111", groupName: " Equipe " });
    expect(r.success && r.data).toMatchObject({ destination: "phone", phone: "5511987654321", groupId: GROUP, groupName: "Equipe" });
  });

  it("número inválido ou grupo inválido são recusados com mensagem", () => {
    const phone = campaignSettingsFormSchema.safeParse({ ...base, destination: "phone", phone: "12345" });
    expect(!phone.success && phone.error.issues[0].message).toMatch(/DDD/);
    const grupo = campaignSettingsFormSchema.safeParse({ ...base, groupId: "abc" });
    expect(!grupo.success && grupo.error.issues[0].message).toMatch(/grupo/i);
  });

  it("nome de grupo sem grupo é descartado", () => {
    const r = campaignSettingsFormSchema.safeParse({ ...base, groupName: "Fantasma" });
    expect(r.success && r.data.groupName).toBeNull();
  });

  it("ligar exige destino completo; desligado salva como rascunho", () => {
    const data = (over: Record<string, string>) => {
      const r = campaignSettingsFormSchema.safeParse({ ...base, ...over });
      if (!r.success) throw new Error("form inválido");
      return r.data;
    };
    expect(destinationProblem(data({ destination: "phone" }), GROUP)).toMatch(/número|DDD/i);
    expect(destinationProblem(data({ destination: "phone", phone: "11987654321" }), null)).toBeNull();
    expect(destinationProblem(data({}), null)).toMatch(/grupo/i);
    // Sem grupo próprio, o dos avisos de Perguntas vale.
    expect(destinationProblem(data({}), GROUP)).toBeNull();
    expect(destinationProblem(data({ enabled: "", destination: "phone" }), null)).toBeNull();
  });
});

describe("envio por destino", () => {
  it("grupo escolhido aqui vale mais que o das perguntas", async () => {
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ groupId: OTHER_GROUP }));
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("sent");
    expect(group.sendDocumentToInternalGroup).toHaveBeenCalledWith("t1", OTHER_GROUP, expect.objectContaining({ mimetype: "application/pdf" }));
  });

  it("sem grupo próprio usa o das perguntas (comportamento da primeira versão)", async () => {
    await deliverCampaignReport("t1", FRIDAY_8H30);
    expect(group.sendDocumentToInternalGroup).toHaveBeenCalledWith("t1", GROUP, expect.objectContaining({ mimetype: "application/pdf" }));
  });

  it("destino número envia ao número, nunca ao grupo", async () => {
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ destination: "phone", phone: "5511987654321", groupId: OTHER_GROUP }));
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("sent");
    expect(group.sendDocumentToInternalPhone).toHaveBeenCalledWith("t1", "5511987654321", expect.objectContaining({ caption: expect.stringContaining("Relatório semanal de campanhas") }));
    expect(group.sendDocumentToInternalGroup).not.toHaveBeenCalled();
  });

  it("destino número sem número: nada é tentado", async () => {
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ destination: "phone" }));
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("no_phone");
    expect(queries.loadCampaignReport).not.toHaveBeenCalled();
    expect(group.sendDocumentToInternalPhone).not.toHaveBeenCalled();
  });

  it("número recusado não monta nem envia", async () => {
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ destination: "phone", phone: "5511987654321" }));
    blocklist.isPhoneBlocked.mockResolvedValue(true);
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("refused");
    expect(queries.loadCampaignReport).not.toHaveBeenCalled();
    expect(group.sendDocumentToInternalPhone).not.toHaveBeenCalled();
  });

  it("QR desconectado vira no_channel; erro de envio vira failed", async () => {
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ destination: "phone", phone: "5511987654321" }));
    group.sendDocumentToInternalPhone.mockResolvedValue(false);
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("no_channel");
    group.sendDocumentToInternalPhone.mockRejectedValue(new Error("timeout"));
    await expect(deliverCampaignReport("t1", FRIDAY_8H30)).resolves.toBe("failed");
  });

  it("no worker, sem número devolve o horário", async () => {
    db.campaignReportSettings.findMany.mockResolvedValue([row({ destination: "phone" })]);
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ destination: "phone" }));
    await expect(scanCampaignReports(FRIDAY_8H30)).resolves.toEqual({ sent: 0, waiting: 1 });
    const restore = db.campaignReportSettings.updateMany.mock.calls.at(-1)![0];
    expect(restore.data).toEqual({ lastSentAt: null });
  });

  it("no worker, número recusado não devolve o horário: nunca insiste", async () => {
    db.campaignReportSettings.findMany.mockResolvedValue([row({ destination: "phone", phone: "5511987654321" })]);
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ destination: "phone", phone: "5511987654321" }));
    db.conversation.findMany.mockResolvedValue([{ whatsappProvider: "meta", followUpReason: null }]);
    await expect(scanCampaignReports(FRIDAY_8H30)).resolves.toEqual({ sent: 0, waiting: 0 });
    const restores = db.campaignReportSettings.updateMany.mock.calls.filter(([arg]) => arg.data.lastSentAt === null);
    expect(restores).toHaveLength(0);
  });
});

describe("isPhoneRefused", () => {
  it("o próprio celular de quem nunca falou com a clínica passa", async () => {
    await expect(isPhoneRefused("t1", "5511987654321")).resolves.toBe(false);
  });

  it("recusa bloqueado, quem pediu para parar e contato que fala pela Meta", async () => {
    blocklist.isPhoneBlocked.mockResolvedValueOnce(true);
    await expect(isPhoneRefused("t1", "5511987654321")).resolves.toBe(true);
    db.conversation.findMany.mockResolvedValueOnce([{ whatsappProvider: "evolution", followUpReason: "stop" }]);
    await expect(isPhoneRefused("t1", "5511987654321")).resolves.toBe(true);
    db.conversation.findMany.mockResolvedValueOnce([{ whatsappProvider: "meta", followUpReason: null }]);
    await expect(isPhoneRefused("t1", "5511987654321")).resolves.toBe(true);
  });

  it("contato do QR que não pediu para parar pode receber", async () => {
    db.conversation.findMany.mockResolvedValueOnce([{ whatsappProvider: "evolution", followUpReason: null }]);
    await expect(isPhoneRefused("t1", "5511987654321")).resolves.toBe(false);
  });

  it("confere as duas grafias do celular e deixa o teste de fora", async () => {
    await isPhoneRefused("t1", "5511987654321");
    const where = db.conversation.findMany.mock.calls[0][0].where;
    expect(where.isTest).toBe(false);
    expect(where.lead.phone.in).toEqual(["5511987654321", "551187654321"]);
  });

  it("falha de leitura recusa em vez de arriscar mandar a quem não deve", async () => {
    db.conversation.findMany.mockRejectedValueOnce(new Error("db fora"));
    await expect(isPhoneRefused("t1", "5511987654321")).resolves.toBe(true);
  });
});

describe("importação do histórico", () => {
  const history = (status: CampaignSettings["history"]["status"], at: Date | null = null) => ({ status, at, summary: null });
  const stats = { externalId: "x", slices: 9, scanned: 1200, withAd: 40, unresolvedPhone: 1, contacts: 30, noLeadInFechai: 4, matched: 26, created: 25, alreadyHad: 1 };

  it("pode pedir de novo, menos com uma na fila ou rodando (e não travada)", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(canRequestHistoryImport(history(null), now)).toBe(true);
    expect(canRequestHistoryImport(history("done", now), now)).toBe(true);
    expect(canRequestHistoryImport(history("failed", now), now)).toBe(true);
    expect(canRequestHistoryImport(history("requested", now), now)).toBe(false);
    expect(canRequestHistoryImport(history("running", now), now)).toBe(false);
    expect(canRequestHistoryImport(history("running", new Date(now.getTime() - HISTORY_STALE_MS - 1)), now)).toBe(true);
  });

  it("pedir exige o WhatsApp por QR conectado", async () => {
    instances.findWhatsappChannel.mockResolvedValue(null);
    const r = await requestHistoryImport("t1");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("QR code") });
    expect(db.campaignReportSettings.upsert).not.toHaveBeenCalled();
  });

  it("pedir só marca na fila; quem lê é o worker", async () => {
    instances.findWhatsappChannel.mockResolvedValue({ externalId: "inst" });
    const now = new Date("2026-10-30T12:00:00Z");
    await expect(requestHistoryImport("t1", now)).resolves.toEqual({ ok: true });
    expect(instances.findWhatsappChannel).toHaveBeenCalledWith("t1", "evolution");
    expect(db.campaignReportSettings.upsert.mock.calls[0][0].update).toMatchObject({ historyImportStatus: "requested", historyImportAt: now });
    expect(backfill.backfillAdOrigins).not.toHaveBeenCalled();
  });

  it("não pede outra enquanto uma está em andamento", async () => {
    instances.findWhatsappChannel.mockResolvedValue({ externalId: "inst" });
    const now = new Date("2026-10-30T12:00:00Z");
    db.campaignReportSettings.findUnique.mockResolvedValue(row({ historyImportStatus: "running", historyImportAt: now }));
    await expect(requestHistoryImport("t1", now)).resolves.toMatchObject({ ok: false });
    expect(db.campaignReportSettings.upsert).not.toHaveBeenCalled();
  });

  it("o resumo só tem contagens e diz quando não achou nada", () => {
    const text = summarizeHistoryImport(stats);
    expect(text).toContain("25 leads ligados a um anúncio");
    expect(text).toContain("1 já tinham origem");
    expect(text).toContain("4 contatos de anúncio sem lead no Fechai");
    expect(summarizeHistoryImport({ ...stats, contacts: 0, created: 0 })).toContain("Nenhum anúncio encontrado");
  });

  it("o worker pega o pedido, lê com apply e grava o resultado", async () => {
    db.campaignReportSettings.findMany.mockResolvedValue([{ tenantId: "t1" }]);
    backfill.backfillAdOrigins.mockResolvedValue({ ...stats, created: 3 });
    const now = new Date("2026-10-30T12:00:00Z");
    await expect(runPendingHistoryImports(now)).resolves.toBe(1);
    expect(db.campaignReportSettings.updateMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t1", historyImportStatus: "requested" },
      data: { historyImportStatus: "running", historyImportAt: now },
    });
    await vi.waitFor(() => {
      expect(db.campaignReportSettings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ historyImportStatus: "done", historyImportSummary: expect.stringContaining("3 leads ligados") }) }),
      );
    });
    const input = backfill.backfillAdOrigins.mock.calls[0][0];
    expect(input).toMatchObject({ tenantId: "t1", apply: true });
    expect(now.getTime() - input.since.getTime()).toBe(60 * 86_400_000);
  });

  it("leitura que falha vira failed com mensagem sem detalhe técnico", async () => {
    db.campaignReportSettings.findMany.mockResolvedValue([{ tenantId: "t1" }]);
    backfill.backfillAdOrigins.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:8080"));
    await runPendingHistoryImports(new Date("2026-10-30T12:00:00Z"));
    await vi.waitFor(() => {
      expect(db.campaignReportSettings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ historyImportStatus: "failed" }) }),
      );
    });
    const failed = db.campaignReportSettings.updateMany.mock.calls.find(([a]) => a.data.historyImportStatus === "failed")![0];
    expect(failed.data.historyImportSummary).not.toContain("ECONNREFUSED");
  });

  it("outro worker já pegou o pedido: não roda", async () => {
    db.campaignReportSettings.findMany.mockResolvedValue([{ tenantId: "t1" }]);
    db.campaignReportSettings.updateMany.mockResolvedValue({ count: 0 });
    await expect(runPendingHistoryImports()).resolves.toBe(0);
    expect(backfill.backfillAdOrigins).not.toHaveBeenCalled();
  });

  it("uma importação por vez no worker", async () => {
    db.campaignReportSettings.findMany.mockResolvedValue([{ tenantId: "t1" }]);
    let finish: (v: unknown) => void = () => {};
    backfill.backfillAdOrigins.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await expect(runPendingHistoryImports()).resolves.toBe(1);
    await expect(runPendingHistoryImports()).resolves.toBe(0);
    finish({ ...stats, contacts: 0, created: 0 });
    await vi.waitFor(() => expect(db.campaignReportSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ historyImportStatus: "done" }) }),
    ));
  });
});
