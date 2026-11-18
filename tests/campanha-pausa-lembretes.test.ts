import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pausa dos lembretes da conta por campanha (`pauseAllReminders`).
 *
 * Pedido da clínica para o evento de 18 e 19/11: "nesses dias não manda
 * lembrete para ninguém, nem para quem eu remarcar; na sexta volta ao normal e
 * na segunda precisa estar funcionando". O estrago que cada regra evita:
 *
 * - paciente remarcado durante o evento recebendo "é amanhã" na hora (o
 *   horário do disparo já tinha passado, então ele sairia imediatamente);
 * - o "1 dia antes" da consulta de sexta, que vence na quinta, escapando no
 *   segundo seguinte ao fim da campanha;
 * - pausa sem fim calando os lembretes da clínica para sempre.
 */

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { campaign: { findMany: mocks.findMany, findFirst: mocks.findFirst, updateMany: mocks.updateMany } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit, recordChange: vi.fn() }));
vi.mock("@/modules/campaigns/access", () => ({
  requireCampaignActor: async () => ({ tenantId: "conta-1", userId: "user-1", canEdit: true }),
}));
// Dependências pesadas das outras actions do arquivo (não usadas aqui).
vi.mock("@/modules/campaigns/assets", () => ({
  assetFileProblem: vi.fn(), cleanAssetName: vi.fn(), removeCampaignAssetFile: vi.fn(), storeCampaignAsset: vi.fn(), ASSET_USAGES: [],
}));
vi.mock("@/modules/campaigns/attribution", () => ({ attributeLead: vi.fn() }));
vi.mock("@/modules/agent-engine/transfer", () => ({ buildAgentPackage: vi.fn(), createAgentFromPackage: vi.fn() }));
vi.mock("@/modules/knowledge-base/repository", () => ({ ingestDocument: vi.fn() }));

import { activePause, pausedDue, reminderPausedBy, type ReminderPause } from "@/modules/campaigns/reminder-pause";
import { loadReminderPauses } from "@/modules/campaigns/active";
import { parseCampaignRules, validateCampaignRules } from "@/modules/campaigns/rules";
import { saveCampaignRules } from "@/app/(dashboard)/campanhas/setup-actions";

// Evento: quarta 18/11 00:00 até quinta 19/11 23:59:59 (Brasília).
const EVENTO: ReminderPause = {
  campaignId: "evento",
  name: "Plantão de Implantes",
  startsAt: new Date("2026-11-18T03:00:00.000Z"),
  endsAt: new Date("2026-11-20T02:59:59.000Z"),
};
const at = (iso: string) => new Date(iso);

describe("regras da pausa (puras)", () => {
  it("durante o evento nada sai, nem o lembrete da consulta remarcada", () => {
    // Quarta às 18:44: a clínica remarcou alguém para quinta às 16:15. O
    // "1 dia antes às 08:30" venceu às 08:30 de quarta — sem a pausa, sairia na hora.
    expect(activePause([EVENTO], at("2026-11-18T21:44:00Z"))).toBe(EVENTO);
    expect(reminderPausedBy([EVENTO], at("2026-11-18T11:30:00Z"), at("2026-11-18T21:44:00Z"))).toBe(EVENTO);
  });

  it("vale do primeiro ao último instante do evento", () => {
    expect(activePause([EVENTO], EVENTO.startsAt)).toBe(EVENTO);
    expect(activePause([EVENTO], EVENTO.endsAt)).toBe(EVENTO);
    expect(activePause([EVENTO], at("2026-11-18T02:59:59Z"))).toBeNull();
    expect(activePause([EVENTO], at("2026-11-20T03:00:00Z"))).toBeNull();
  });

  it("o que venceu durante o evento não sai depois que ele acaba", () => {
    // Quinta às 08:30 venceu o lembrete de uma consulta de sexta. Às 23:59:30
    // a pausa já acabou (fim às 23:59:00 seria o caso real de risco).
    const dueThursday = at("2026-11-19T11:30:00Z");
    const afterEnd = at("2026-11-20T03:00:30Z");
    expect(activePause([EVENTO], afterEnd)).toBeNull();
    expect(pausedDue([EVENTO], dueThursday)).toBe(EVENTO);
    expect(reminderPausedBy([EVENTO], dueThursday, afterEnd)).toBe(EVENTO);
  });

  it("na sexta volta ao normal e a segunda funciona (lembrete de domingo)", () => {
    // Consulta de sábado: lembrete vence sexta 08:30. Consulta de segunda: domingo 08:30.
    expect(reminderPausedBy([EVENTO], at("2026-11-20T11:30:00Z"), at("2026-11-20T11:31:00Z"))).toBeNull();
    expect(reminderPausedBy([EVENTO], at("2026-11-22T11:30:00Z"), at("2026-11-22T11:31:00Z"))).toBeNull();
  });

  it("sem pausa nenhuma, nada muda", () => {
    expect(reminderPausedBy([], at("2026-11-18T11:30:00Z"), at("2026-11-18T12:00:00Z"))).toBeNull();
  });
});

describe("regra salva na campanha", () => {
  it("nasce desligada, inclusive em linha antiga sem o campo", () => {
    expect(parseCampaignRules(null).pauseAllReminders).toBe(false);
    expect(parseCampaignRules({ reminders: "off" }).pauseAllReminders).toBe(false);
  });

  it("só existe com os lembretes da campanha desligados", () => {
    expect(parseCampaignRules({ reminders: "off", pauseAllReminders: true }).pauseAllReminders).toBe(true);
    expect(parseCampaignRules({ reminders: "default", pauseAllReminders: true }).pauseAllReminders).toBe(false);
    expect(
      parseCampaignRules({ reminders: "custom", customReminders: [{ minutesBefore: 60, template: "Oi" }], pauseAllReminders: true })
        .pauseAllReminders,
    ).toBe(false);
  });

  it("valor que não é ligado/desligado é recusado na tela", () => {
    const rules = parseCampaignRules({ reminders: "off" });
    expect(validateCampaignRules(rules, { pauseAllReminders: "sim" })).toMatch(/Pausa dos lembretes/);
    expect(validateCampaignRules(rules, { pauseAllReminders: true })).toBeNull();
  });
});

describe("leitura das pausas (loadReminderPauses)", () => {
  beforeEach(() => vi.clearAllMocks());
  const row = (over: Record<string, unknown> = {}) => ({
    id: "evento", tenantId: "conta-1", name: "Plantão de Implantes",
    startsAt: EVENTO.startsAt, endsAt: EVENTO.endsAt, rules: { reminders: "off", pauseAllReminders: true }, ...over,
  });

  it("só campanha ativada, não pausada nem arquivada, que já começou", async () => {
    mocks.findMany.mockResolvedValue([row()]);
    const now = at("2026-11-18T12:00:00Z");
    const result = await loadReminderPauses(["conta-1"], now);
    expect(result.get("conta-1")).toEqual([EVENTO]);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: { in: ["conta-1"] }, archivedAt: null, activatedAt: { not: null }, pausedAt: null, startsAt: { lte: now } });
    // Uma pausa que acabou há pouco ainda importa (o que venceu nela não sai depois).
    expect(where.endsAt.gte.getTime()).toBeLessThan(now.getTime());
  });

  it("ignora campanha sem a opção e campanha sem data de fim", async () => {
    mocks.findMany.mockResolvedValue([
      row({ id: "sem-opcao", rules: { reminders: "off" } }),
      row({ id: "sem-fim", endsAt: null }),
    ]);
    expect((await loadReminderPauses(["conta-1"], at("2026-11-18T12:00:00Z"))).size).toBe(0);
  });

  it("falha do banco sobe: o worker decide não enviar", async () => {
    mocks.findMany.mockRejectedValue(new Error("db fora"));
    await expect(loadReminderPauses(["conta-1"], at("2026-11-18T12:00:00Z"))).rejects.toThrow("db fora");
  });

  it("sem conta, nem consulta o banco", async () => {
    expect((await loadReminderPauses([], new Date())).size).toBe(0);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe("salvar a pausa (saveCampaignRules)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });
  const campaign = (endsAt: Date | null) => ({
    id: "evento", tenantId: "conta-1", name: "Plantão de Implantes", rules: { reminders: "off" },
    activatedAt: new Date("2026-11-16T17:27:00Z"), archivedAt: null, pausedAt: null,
    startsAt: EVENTO.startsAt, endsAt,
  });

  it("recusa ligar a pausa em campanha sem data de fim (nunca voltaria sozinha)", async () => {
    mocks.findFirst.mockResolvedValue(campaign(null));
    const result = await saveCampaignRules("cmwf9w8tt00knnv0ktxp55d3k", { reminders: "off", pauseAllReminders: true });
    expect(result).toMatchObject({ ok: false, code: "validation" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("salva com data de fim e registra na auditoria", async () => {
    mocks.findFirst.mockResolvedValue(campaign(EVENTO.endsAt));
    const result = await saveCampaignRules("cmwf9w8tt00knnv0ktxp55d3k", { reminders: "off", pauseAllReminders: true });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.updateMany.mock.calls[0][0].data.rules.pauseAllReminders).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ event: "campaign.rules_updated" }));
  });
});
