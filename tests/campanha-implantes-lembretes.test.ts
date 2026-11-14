import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-03 — nenhum lembrete, confirmação ou aviso automático para leads da campanha
 * de implantes: consulta marcada pelo agente (ou pela equipe) nasce com
 * `reminderOverride = []`, o worker pula as do fechai e as marcadas direto no
 * Clinicorp, e quem não é da campanha segue recebendo. Prisma simulado, sem banco.
 */

const db = vi.hoisted(() => ({
  campaignLead: { findMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  leadAdOrigin: { findMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  tenantAction: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  agent: { findMany: vi.fn() },
  reminderReceipt: { deleteMany: vi.fn() },
  reminderDispatch: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  clinicorpReminder: { deleteMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  whatsappInstance: { findMany: vi.fn() },
  appointment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  message: { create: vi.fn() },
  conversation: { update: vi.fn(), updateMany: vi.fn() },
}));
const clinicorp = vi.hoisted(() => ({
  listClinicorpAgenda: vi.fn(),
  listClinicorpCategories: vi.fn(),
  pushAppointmentToClinicorp: vi.fn(),
  cancelAppointmentInClinicorp: vi.fn(async () => true),
  hasClinicorpConflict: vi.fn(async () => false),
  listClinicorpBusyBlocks: vi.fn(async () => []),
  clinicorpConfirmationPending: vi.fn(async () => false),
  syncAppointmentToClinicorp: vi.fn(async () => ({ status: "skipped" })),
}));
const meta = vi.hoisted(() => ({ getBroadcastConnection: vi.fn(), sendBroadcastTemplate: vi.fn() }));
const evolution = vi.hoisted(() => ({ isConfigured: vi.fn(() => true), sendMessage: vi.fn() }));
const dispatch = vi.hoisted(() => ({
  blockReminder: vi.fn(),
  claimReminder: vi.fn(async () => ({ id: "dispatch", token: "token", tenantId: "tenant-1" })),
  finishReminder: vi.fn(),
  markReminderManual: vi.fn(async () => true),
  reminderAlreadyHandled: vi.fn(async () => null),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/clinicorp", () => ({
  CLINICORP_UNNAMED_PATIENT: "Paciente sem nome",
  listClinicorpAgenda: clinicorp.listClinicorpAgenda,
  listClinicorpCategories: clinicorp.listClinicorpCategories,
  pushAppointmentToClinicorp: clinicorp.pushAppointmentToClinicorp,
  cancelAppointmentInClinicorp: clinicorp.cancelAppointmentInClinicorp,
  hasClinicorpConflict: clinicorp.hasClinicorpConflict,
  listClinicorpBusyBlocks: clinicorp.listClinicorpBusyBlocks,
  clinicorpConfirmationPending: clinicorp.clinicorpConfirmationPending,
}));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({ syncAppointmentToClinicorp: clinicorp.syncAppointmentToClinicorp }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: async () => ({ status: "skipped" }), updateIcloudEvent: async () => ({ status: "skipped" }),
  deleteIcloudEvent: async () => true, listIcloudBusyBlocks: async () => [], hasIcloudConflict: async () => false,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: vi.fn(async () => null), deleteEventFromGoogle: vi.fn(async () => true) }));
vi.mock("@/modules/broadcasts/connection", () => ({ getBroadcastConnection: meta.getBroadcastConnection }));
vi.mock("@/modules/whatsapp/meta-config", () => ({ WHATSAPP_PROVIDER_SELECT: {}, getWhatsAppProviderForInstance: () => evolution }));
vi.mock("@/modules/whatsapp/blocklist", () => ({ isPhoneBlocked: vi.fn(async () => false) }));
vi.mock("@/modules/agent-engine/conversation", () => ({ getOrCreateConversation: vi.fn(async () => ({ lead: {}, conversation: { id: "conversa-nova" } })) }));
vi.mock("@/modules/scheduling/reminder-dispatch", () => ({
  ...dispatch,
  reminderSource: (id: string, remote?: string) => (remote ? `clinicorp:${remote}` : `appointment:${id}`),
}));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: vi.fn(),
}));

import { runToolHandler, type ToolContext } from "@/modules/agent-engine/tools";
import { loadReminderOverrides } from "@/modules/campaigns/active";
import { overrideToCampaignRules } from "@/modules/campaign-override/agent";
import { parseOverrideRules } from "@/modules/campaign-override/config";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { createAppointment } from "@/modules/scheduling/repository";
import { scanAndSendClinicorpReminders, sendClinicorpConfirmation } from "../workers/follow-up-worker/clinicorp-reminders";
import { remindersFor, scanAndSendReminders } from "../workers/follow-up-worker/reminders";

const TENANT = "tenant-1";
const CAMPAIGN_LEAD = "lead-1";
const NORMAL_LEAD = "lead-9";
const TEMPLATE = {
  id: "tpl-1", name: "lembrete_consulta", language: "pt_BR", body: "Olá {{1}}, sua consulta é {{2}} às {{3}}.",
  header: "", footer: "", parameterCount: 3, variables: ["nome", "data", "hora"],
};
const ACCOUNT_REMINDERS = [{ minutesBefore: 1440, template: "Oi {{nome}}! Sua consulta é {{data}} às {{hora}}." }];

const overrideRow = () => ({
  id: "o1", key: "implantes-2026-11", adCodes: [], adSourceIds: [], broadcastCampaignIds: [], leadIds: [CAMPAIGN_LEAD],
  startsAt: new Date("2026-11-10T00:00:00Z"), endsAt: new Date("2026-11-20T02:59:59Z"),
  rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00", capacityPerDay: 5 },
});

let config: Record<string, unknown>;
const consulta = (startsAtIso: string, over: Record<string, unknown> = {}) => ({
  id: "4791226171916288", startsAt: new Date(startsAtIso), endsAt: null, patientName: "Maria Souza", phone: "14991406457",
  professional: null, notes: null, ...over,
});
const knownLead = (id: string) => ({
  id, phone: "5514991406457", isTest: false,
  conversation: { id: "conv", lastInboundAt: new Date("2026-11-12T12:00:00Z"), followUpReason: null, variables: null, whatsappProvider: "meta" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  config = {
    timezone: "America/Sao_Paulo", reminderEnabled: true, reminders: ACCOUNT_REMINDERS, metaReminderTemplate: TEMPLATE,
    allowRescheduling: true,
  };
  db.campaignOverride.findMany.mockImplementation(async ({ where }: { where: { startsAt: { lte: Date }; endsAt: { gte: Date } } }) => {
    const row = overrideRow();
    return row.startsAt <= where.startsAt.lte && row.endsAt >= where.endsAt.gte ? [row] : [];
  });
  db.campaignLead.findMany.mockResolvedValue([]);
  db.leadAdOrigin.findMany.mockResolvedValue([]);
  db.tenantAction.findMany.mockImplementation(async () => [{ tenantId: TENANT, agentId: "agente-1", config }]);
  db.tenantAction.findFirst.mockImplementation(async () => ({ config }));
  db.tenantAction.findUnique.mockImplementation(async () => ({ config }));
  db.agent.findMany.mockResolvedValue([{ id: "agente-1", tenantId: TENANT }]);
  db.reminderReceipt.deleteMany.mockResolvedValue({ count: 0 });
  db.clinicorpReminder.deleteMany.mockResolvedValue({ count: 0 });
  db.clinicorpReminder.findMany.mockResolvedValue([]);
  db.clinicorpReminder.findUnique.mockResolvedValue(null);
  db.clinicorpReminder.upsert.mockResolvedValue({});
  db.whatsappInstance.findMany.mockResolvedValue([{ status: "connected", provider: "meta", externalId: "inst-1" }]);
  db.appointment.findMany.mockResolvedValue([]);
  db.appointment.findFirst.mockResolvedValue(null);
  db.appointment.count.mockResolvedValue(0);
  db.appointment.create.mockResolvedValue({ id: "consulta-nova" });
  db.appointment.update.mockResolvedValue({});
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.$executeRaw.mockResolvedValue(1);
  db.lead.findFirst.mockResolvedValue(null);
  db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5514991406457", isTest: false });
  db.lead.update.mockResolvedValue({});
  db.message.create.mockResolvedValue({});
  db.conversation.update.mockResolvedValue({});
  clinicorp.listClinicorpCategories.mockResolvedValue({ ok: true, data: [] });
  meta.getBroadcastConnection.mockResolvedValue({ provider: { sendBroadcastTemplate: meta.sendBroadcastTemplate } });
  meta.sendBroadcastTemplate.mockResolvedValue("wamid-1");
  evolution.sendMessage.mockResolvedValue("key-1");
  dispatch.claimReminder.mockResolvedValue({ id: "dispatch", token: "token", tenantId: TENANT });
  dispatch.reminderAlreadyHandled.mockResolvedValue(null);
});

describe("lembrete da consulta do fechai", () => {
  it("remindersFor é [] para o lead da campanha (lembretes desligados) e normal para os outros", async () => {
    // Uma consulta futura do lead da campanha e outra de quem não é.
    db.appointment.findMany.mockResolvedValue([
      { tenantId: TENANT, leadId: CAMPAIGN_LEAD },
      { tenantId: TENANT, leadId: NORMAL_LEAD },
    ]);
    const rules = await loadReminderOverrides([TENANT], new Date("2026-11-13T12:00:00Z"));
    expect([...rules.keys()]).toEqual([CAMPAIGN_LEAD]);
    expect(rules.get(CAMPAIGN_LEAD)?.reminders).toBe("off");

    const account = { reminderEnabled: true, reminders: ACCOUNT_REMINDERS };
    expect(remindersFor({ reminderOverride: null }, account, rules.get(CAMPAIGN_LEAD))).toEqual([]);
    expect(remindersFor({ reminderOverride: null }, account, rules.get(NORMAL_LEAD))).toEqual(ACCOUNT_REMINDERS);
    expect(overrideToCampaignRules({ rules: parseOverrideRules({}) }).reminders).toBe("off");
  });

  it("depois do corte rígido (20/11 03:00Z) a regra some e o lead volta a receber lembrete", async () => {
    db.appointment.findMany.mockResolvedValue([{ tenantId: TENANT, leadId: CAMPAIGN_LEAD }]);
    expect((await loadReminderOverrides([TENANT], new Date("2026-11-20T02:59:59Z"))).size).toBe(1);
    expect((await loadReminderOverrides([TENANT], new Date("2026-11-20T03:00:00Z"))).size).toBe(0);
  });

  it("consulta marcada pelo agente nasce e fica com reminderOverride=[] e sem ReminderDispatch", async () => {
    const reply = await runToolHandler(
      "schedule_meeting",
      { tenantId: TENANT, leadId: CAMPAIGN_LEAD, agentId: "agente-1", conversationId: "conversa-1" } as ToolContext,
      { date: "2026-11-18", time: "09:00", patientName: "Paciente" },
      // (nenhum argumento extra)
    );
    expect(reply).toContain("Agendado para");
    const created = db.appointment.create.mock.calls[0][0] as { data: { reminderOverride: unknown } };
    expect(created.data.reminderOverride).toEqual([]);
    // O `[]` fica na gravação final (nada de voltar para "segue o agente").
    const final = db.appointment.update.mock.calls.at(-1)?.[0] as { data: { reminderOverride: unknown } };
    expect(final.data.reminderOverride).toEqual([]);
    for (const fn of Object.values(db.reminderDispatch)) expect(fn).not.toHaveBeenCalled();
    for (const fn of Object.values(dispatch)) expect(fn).not.toHaveBeenCalled();
  });

  it("consulta marcada pela equipe (manual) para lead da campanha também fica sem lembrete", async () => {
    await createAppointment({
      tenantId: TENANT, leadId: CAMPAIGN_LEAD, title: "Paciente", startsAt: new Date("2026-11-18T12:00:00Z"),
      durationMinutes: 30, source: "manual", timezone: "America/Sao_Paulo",
    });
    expect((db.appointment.update.mock.calls.at(-1)?.[0] as { data: { reminderOverride: unknown } }).data.reminderOverride).toEqual([]);
  });

  it("quem não é da campanha segue como antes: o `[]` provisório vira null (segue o agente)", async () => {
    await createAppointment({
      tenantId: TENANT, agentId: "agente-1", leadId: NORMAL_LEAD, title: "Paciente", startsAt: new Date("2026-11-24T12:00:00Z"),
      durationMinutes: 30, source: "agent", timezone: "America/Sao_Paulo",
    });
    const final = db.appointment.update.mock.calls.at(-1)?.[0] as { data: { reminderOverride: unknown } };
    expect(final.data.reminderOverride).not.toEqual([]);
  });

  const scanWith = async (leadId: string) => {
    const appt = {
      id: "a1", tenantId: TENANT, leadId, status: "scheduled", startsAt: new Date("2026-11-18T12:00:00Z"),
      remindersSent: [], reminderOverride: null, serviceType: null, clinicorpAppointmentId: null, reminderSentAt: null,
      lead: { phone: "5514991406457", name: "Maria", isTest: false, conversation: null }, conversation: null,
    };
    db.appointment.findMany.mockImplementation(async (args: { include?: unknown; select?: Record<string, boolean> }) => {
      if (args.include) return [appt];
      if (args.select?.remindersSent) return [];
      return [{ tenantId: TENANT, leadId: CAMPAIGN_LEAD }];
    });
    await scanAndSendReminders(new Date("2026-11-17T12:00:00Z")).catch(() => undefined);
  };

  it("a varredura do worker não envia nem reivindica nada para consulta (ainda sem override) de lead da campanha", async () => {
    await scanWith(CAMPAIGN_LEAD);
    expect(dispatch.claimReminder).not.toHaveBeenCalled();
    expect(dispatch.blockReminder).not.toHaveBeenCalled();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it("controle: a mesma varredura para quem não é da campanha chega a reivindicar o lembrete", async () => {
    await scanWith(NORMAL_LEAD);
    expect(dispatch.claimReminder).toHaveBeenCalled();
  });
});

describe("consulta marcada direto no Clinicorp", () => {
  const AGORA = new Date("2026-11-17T12:00:00Z");

  it("lead da campanha: o worker não envia, não reivindica e não cria controle (reason campaign)", async () => {
    db.lead.findFirst.mockResolvedValue(knownLead(CAMPAIGN_LEAD));
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta("2026-11-18T11:00:00Z")], skipped: 0 });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ scanned: 1, sent: 0 });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(dispatch.claimReminder).not.toHaveBeenCalled();
    expect(dispatch.blockReminder).not.toHaveBeenCalled();
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();

    const direct = await sendClinicorpConfirmation(TENANT, consulta("2026-11-18T11:00:00Z"), parseScheduleConfig(config), { now: AGORA });
    expect(direct).toEqual({ sent: false, reason: "campaign" });
  });

  it("o aviso do mesmo dia (2h antes) segue o mesmo caminho e também é pulado", async () => {
    config.reminders = [{ minutesBefore: 120, template: "Daqui a pouco, {{nome}}!" }];
    db.lead.findFirst.mockResolvedValue(knownLead(CAMPAIGN_LEAD));
    const now = new Date("2026-11-18T11:30:00Z");
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta("2026-11-18T13:00:00Z")], skipped: 0 });
    expect(await scanAndSendClinicorpReminders(now)).toMatchObject({ sent: 0 });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(dispatch.claimReminder).not.toHaveBeenCalled();
  });

  it("não consegue ler a regra: espera a próxima volta em vez de arriscar o lembrete", async () => {
    db.lead.findFirst.mockResolvedValue(knownLead(CAMPAIGN_LEAD));
    db.campaignOverride.findMany.mockRejectedValue(new Error("banco fora do ar"));
    const result = await sendClinicorpConfirmation(TENANT, consulta("2026-11-18T11:00:00Z"), parseScheduleConfig(config), { now: AGORA });
    expect(result).toEqual({ sent: false, reason: "campaign" });
    expect(dispatch.claimReminder).not.toHaveBeenCalled();
  });

  it("quem não é da campanha continua recebendo", async () => {
    db.lead.findFirst.mockResolvedValue(knownLead(NORMAL_LEAD));
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta("2026-11-18T11:00:00Z")], skipped: 0 });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ scanned: 1, sent: 1 });
    expect(meta.sendBroadcastTemplate).toHaveBeenCalledOnce();
  });

  it("paciente que ainda não é lead (telefone sem cadastro) continua como antes", async () => {
    db.lead.findFirst.mockResolvedValue(null);
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta("2026-11-18T11:00:00Z")], skipped: 0 });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 1 });
  });

  it("consulta depois do fim da regra (20/11 às 09:00) de lead da campanha ainda é lembrada", async () => {
    db.lead.findFirst.mockResolvedValue(knownLead(CAMPAIGN_LEAD));
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta("2026-11-20T12:00:00Z")], skipped: 0 });
    // 19/11 às 12:00 em Brasília: a regra ainda vale, mas a consulta é depois do corte.
    expect(await scanAndSendClinicorpReminders(new Date("2026-11-19T15:00:00Z"))).toMatchObject({ sent: 1 });
  });
});

describe("follow-up de quem não agendou", () => {
  it("não muda: o worker de follow-up não conhece a regra da campanha de implantes", () => {
    const source = readFileSync(new URL("../workers/follow-up-worker/scan.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/campaign-override|overrideSuppressesReminder|loadReminderOverrides/);
  });
});
