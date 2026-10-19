import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lembretes das consultas marcadas direto no Clinicorp.
 *
 * Pedido da clínica: essas pessoas também precisam ser lembradas — mas o
 * primeiro contato só pela API oficial da Meta, nunca pelo Evolution, por causa
 * do risco de bloqueio do número.
 */

const db = vi.hoisted(() => ({
  tenantAction: { findMany: vi.fn() },
  reminderReceipt: { deleteMany: vi.fn() },
  agent: { findMany: vi.fn() },
  whatsappInstance: { findMany: vi.fn() },
  clinicorpReminder: { deleteMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  appointment: { findMany: vi.fn() },
  lead: { findFirst: vi.fn() },
  message: { create: vi.fn() },
  conversation: { update: vi.fn() },
}));
const clinicorp = vi.hoisted(() => ({ listClinicorpAgenda: vi.fn(), listClinicorpCategories: vi.fn() }));
const meta = vi.hoisted(() => ({ getBroadcastConnection: vi.fn(), sendBroadcastTemplate: vi.fn() }));
const evolution = vi.hoisted(() => ({ isConfigured: vi.fn(() => true), sendMessage: vi.fn() }));
const blocklist = vi.hoisted(() => ({ isPhoneBlocked: vi.fn() }));
const conversations = vi.hoisted(() => ({ getOrCreateConversation: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ ...clinicorp, CLINICORP_UNNAMED_PATIENT: "Paciente sem nome" }));
vi.mock("@/modules/broadcasts/connection", () => ({ getBroadcastConnection: meta.getBroadcastConnection }));
vi.mock("@/modules/whatsapp/meta-config", () => ({
  WHATSAPP_PROVIDER_SELECT: {},
  getWhatsAppProviderForInstance: () => evolution,
}));
vi.mock("@/modules/whatsapp/blocklist", () => blocklist);
vi.mock("@/modules/agent-engine/conversation", () => conversations);

vi.mock("@/modules/scheduling/reminder-dispatch", () => ({
  blockReminder: vi.fn(), claimReminder: vi.fn(async () => ({ id: "dispatch", token: "token", tenantId: "tenant-1" })),
  finishReminder: vi.fn(), markReminderManual: vi.fn(async () => true), reminderAlreadyHandled: vi.fn(async () => null),
  reminderSource: (id: string, remote?: string) => remote ? `clinicorp:${remote}` : `appointment:${id}`,
}));

import { clinicorpWhatsappPhone, scanAndSendClinicorpReminders, sendClinicorpConfirmation } from "../workers/follow-up-worker/clinicorp-reminders";
import { blockReminder, finishReminder } from "@/modules/scheduling/reminder-dispatch";
import { createQrRiskAcceptance } from "@/modules/scheduling/qr-risk-terms";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { validateMetaReminderTemplate, type MetaReminderTemplate } from "@/modules/scheduling/meta-reminder";

const CONTA = "tenant-1";
const AGORA = new Date("2026-09-28T12:00:00.000Z"); // 09:00 em Brasília
const UM_DIA = 24 * 60;
const TEMPLATE = {
  id: "tpl-1", name: "lembrete_consulta", language: "pt_BR",
  body: "Olá {{1}}, sua consulta é {{2}} às {{3}}.", header: "", footer: "",
  parameterCount: 3, variables: ["nome", "data", "hora"],
};
// Amanhã às 08:00 de Brasília: o "1 dia antes" venceu às 08:00 de hoje.
const consulta = (over: Record<string, unknown> = {}) => ({
  id: "4791226171916288", startsAt: new Date("2026-09-29T11:00:00.000Z"), endsAt: null,
  patientName: "Maria Souza", phone: "14991406457", professional: null, notes: null, ...over,
});

let config: Record<string, unknown>;
const provider = (kind: "meta" | "evolution") =>
  db.whatsappInstance.findMany.mockResolvedValue([{ status: "connected", provider: kind, externalId: "inst-1" }]);
const upserts = () => db.clinicorpReminder.upsert.mock.calls.map(([arg]) => arg);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  config = {
    timezone: "America/Sao_Paulo",
    reminderEnabled: true,
    reminders: [{ minutesBefore: UM_DIA, template: "Oi {{nome}}! Sua consulta é {{data}} às {{hora}}." }],
    metaReminderTemplate: TEMPLATE,
  };
  db.tenantAction.findMany.mockImplementation(async () => [{ tenantId: CONTA, agentId: "agente-1", config }]);
  db.agent.findMany.mockResolvedValue([{ id: "agente-1", tenantId: CONTA }]);
  db.clinicorpReminder.deleteMany.mockResolvedValue({ count: 0 });
  db.clinicorpReminder.findMany.mockResolvedValue([]);
  db.clinicorpReminder.findUnique.mockImplementation(async () => (await db.clinicorpReminder.findMany()).find((r: { clinicorpAppointmentId: string }) => r.clinicorpAppointmentId === consulta().id) ?? null);
  db.clinicorpReminder.upsert.mockResolvedValue({});
  db.appointment.findMany.mockResolvedValue([]);
  db.lead.findFirst.mockResolvedValue(null);
  db.message.create.mockResolvedValue({});
  db.conversation.update.mockResolvedValue({});
  clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta()], skipped: 0 });
  clinicorp.listClinicorpCategories.mockResolvedValue({ ok: true, data: [{ id: "1", name: "Avaliação" }, { id: "2", name: "Ortodontia" }] });
  meta.getBroadcastConnection.mockResolvedValue({ provider: { sendBroadcastTemplate: meta.sendBroadcastTemplate } });
  meta.sendBroadcastTemplate.mockResolvedValue("wamid-1");
  evolution.sendMessage.mockResolvedValue("key-1");
  blocklist.isPhoneBlocked.mockResolvedValue(false);
  conversations.getOrCreateConversation.mockResolvedValue({ lead: {}, conversation: { id: "conversa-nova" } });
  provider("meta");
});

describe("cancelados preservados na agenda", () => {
  it("não envia lembrete nem cria controle de envio para consulta cancelada", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ canceled: true })] });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0, scanned: 0 });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();
  });
});

describe("somente avaliações do Clinicorp", () => {
  beforeEach(() => {
    config.reminderAudience = "selected_types";
    config.reminderTypes = ["Avaliação"];
  });
  it("envia só à avaliação identificada por id, sem usar notas ou o nome do paciente", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [
      consulta({ id: "10", categoryId: "1" }),
      consulta({ id: "11", categoryId: "2", notes: "Avaliação" }),
      consulta({ id: "12", category: "Reavaliação" }),
      consulta({ id: "13", notes: "Avaliação" }),
      consulta({ id: "14", category: "Cirurgia" }),
    ] });
    const result = await scanAndSendClinicorpReminders(AGORA);
    expect(result).toMatchObject({ sent: 1, typeSkipped: 4, unknownTypeSkipped: 1 });
    expect(meta.sendBroadcastTemplate).toHaveBeenCalledTimes(1);
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].create.clinicorpAppointmentId).toBe("10");
  });
  it("aceita descrição explícita normalizada, sem consultar categorias à toa", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ category: " AVALIACAO " })] });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 1 });
    expect(clinicorp.listClinicorpCategories).not.toHaveBeenCalled();
  });
  it.each([{ ok: false, error: "Indisponível" }, { ok: true, data: [] }])("sem resolver o id não usa descrição como fallback: %j", async (categories) => {
    clinicorp.listClinicorpCategories.mockResolvedValue(categories);
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ categoryId: "1", category: "Avaliação" })] });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0, unknownTypeSkipped: 1 });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();
  });
  it("também filtra no Evolution mesmo para quem já conversou", async () => {
    provider("evolution");
    db.lead.findFirst.mockResolvedValue({ conversation: { id: "conv", lastInboundAt: AGORA, followUpReason: null } });
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ category: "Ortodontia" })] });
    await scanAndSendClinicorpReminders(AGORA);
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(db.lead.findFirst).not.toHaveBeenCalled();
  });
  it("não reenvia avaliação já lembrada", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ categoryId: "1" })] });
    db.clinicorpReminder.findMany.mockResolvedValue([{ clinicorpAppointmentId: consulta().id, startsAt: consulta().startsAt, remindersSent: [UM_DIA] }]);
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });
});

describe("template da Meta na config", () => {
  it("guarda o template válido e descarta o incompleto, sem quebrar a config antiga", () => {
    expect(parseScheduleConfig({ metaReminderTemplate: TEMPLATE }).metaReminderTemplate).toMatchObject({ name: "lembrete_consulta" });
    // Uma variável para dois `{{n}}`: a Meta recusaria cada envio.
    expect(parseScheduleConfig({ metaReminderTemplate: { ...TEMPLATE, variables: ["nome"] } })).not.toHaveProperty("metaReminderTemplate");
    expect(parseScheduleConfig({ metaReminderTemplate: { ...TEMPLATE, variables: ["nome", "data", "medico"] } })).not.toHaveProperty("metaReminderTemplate");
    expect(parseScheduleConfig({})).not.toHaveProperty("metaReminderTemplate");
  });

  it("recusa {{local}} com o local da consulta em branco", () => {
    const template = { ...TEMPLATE, variables: ["nome", "data", "local"] } as MetaReminderTemplate;
    expect(validateMetaReminderTemplate(template, { location: "" })).toMatch(/Local ou formato/);
    expect(validateMetaReminderTemplate(template, { location: "no consultório" })).toBeNull();
  });
});

describe("telefone do Clinicorp", () => {
  it.each([
    ["14991406457", "5514991406457"],
    ["+55 (14) 98187-2315", "5514981872315"],
    ["5514981792434", "5514981792434"],
    ["014 99140-6457", "5514991406457"],
    ["1433221100", "551433221100"],
  ])("%s vira %s", (raw, phone) => expect(clinicorpWhatsappPhone(raw)).toBe(phone));

  it.each([null, "", "123", "abc"])("recusa %j", (raw) => expect(clinicorpWhatsappPhone(raw)).toBeNull());
});

describe("pela Meta", () => {
  it("manda o template a quem nunca conversou e grava na conversa", async () => {
    const result = await scanAndSendClinicorpReminders(AGORA);

    expect(result).toMatchObject({ sent: 1 });
    const [phone, template, params] = meta.sendBroadcastTemplate.mock.calls[0];
    expect(phone).toBe("5514991406457");
    expect(template).toMatchObject({ name: "lembrete_consulta" });
    expect(params[0]).toBe("Maria Souza");
    expect(params[2]).toBe("08:00");
    expect(conversations.getOrCreateConversation).toHaveBeenCalledWith(CONTA, "5514991406457", "Maria Souza");
    expect(db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      conversationId: "conversa-nova", role: "assistant", whatsappMessageId: "wamid-1",
      content: expect.stringContaining("Olá Maria Souza"),
    }) });
    expect(upserts()[0]).toMatchObject({ create: { remindersSent: [UM_DIA], reminderSentAt: AGORA } });
    // Relê o Clinicorp de verdade, do dia de hoje em diante.
    expect(clinicorp.listClinicorpAgenda).toHaveBeenCalledWith(CONTA, "2026-09-28", expect.any(String), "America/Sao_Paulo", { fresh: true });
  });

  it("sem template escolhido, lê a agenda para mostrar o impedimento e não envia", async () => {
    delete config.metaReminderTemplate;
    await scanAndSendClinicorpReminders(AGORA);
    expect(clinicorp.listClinicorpAgenda).toHaveBeenCalled();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it("não reenvia quando a Meta não confirma: pode ter aceitado", async () => {
    meta.sendBroadcastTemplate.mockRejectedValue(new Error("A Meta não confirmou o resultado do envio."));
    await scanAndSendClinicorpReminders(AGORA);
    expect(finishReminder).toHaveBeenCalledWith(expect.anything(), "unknown", expect.anything());
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("paciente sem nome no Clinicorp não recebe template com o nome em branco", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ patientName: "Paciente sem nome" })], skipped: 0 });
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(blockReminder).toHaveBeenCalled();
  });
});

describe("pelo Evolution", () => {
  beforeEach(() => provider("evolution"));

  it("primeiro contato nunca sai, e o disparo fica pendente", async () => {
    const result = await scanAndSendClinicorpReminders(AGORA);
    expect(result).toMatchObject({ sent: 0, firstContactSkipped: 1 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    // Não fecha: se a pessoa escrever antes da consulta, o lembrete ainda sai.
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();
  });

  it("quem já conversou recebe o texto do lembrete, na conversa que já existe", async () => {
    db.lead.findFirst.mockResolvedValue({
      phone: "5514991406457",
      conversation: { id: "conversa-1", lastInboundAt: new Date("2026-09-01T12:00:00Z"), followUpReason: null, variables: null },
    });
    await scanAndSendClinicorpReminders(AGORA);
    const [instance, phone, text] = evolution.sendMessage.mock.calls[0];
    expect([instance, phone]).toEqual(["inst-1", "5514991406457"]);
    expect(text).toMatch(/^Oi Maria Souza! Sua consulta é .* às 08:00\.$/);
    expect(db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversa-1", role: "assistant" }) });
    expect(upserts()[0]).toMatchObject({ create: { reminderSentAt: AGORA } });
  });
});

describe("regras de envio", () => {
  it.each(["meta", "evolution"] as const)("consulta para hoje não recebe confirmação da véspera por %s", async (kind) => {
    provider(kind);
    db.lead.findFirst.mockResolvedValue({ phone: "5514991406457", conversation: { id: "c", lastInboundAt: AGORA, whatsappProvider: kind } });
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ startsAt: new Date("2026-09-28T18:00:00Z") })] });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(upserts()[0]).toMatchObject({ create: { remindersSent: [UM_DIA], reminderSentAt: null } });
  });

  it("remarcação do Clinicorp para hoje dispensa a véspera e limpa a indicação do envio antigo", async () => {
    db.clinicorpReminder.findMany.mockResolvedValue([{
      clinicorpAppointmentId: consulta().id, startsAt: consulta().startsAt, remindersSent: [UM_DIA], reminderSentAt: AGORA,
    }]);
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ startsAt: new Date("2026-09-28T18:00:00Z") })] });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(upserts()[0]).toMatchObject({ update: { remindersSent: { set: [UM_DIA] }, reminderSentAt: null } });
  });

  it.each(["2026-09-28T18:00:00Z", "2026-09-30T18:00:00Z"])("envio manual não usa modelo da véspera fora do dia previsto: %s", async (startsAt) => {
    const result = await sendClinicorpConfirmation(CONTA, consulta({ startsAt: new Date(startsAt) }), parseScheduleConfig(config),
      { now: AGORA, operation: "send", userId: "u" });
    expect(result).toMatchObject({ sent: false, reason: "outside_window" });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });

  it("envio manual pode antecipar a hora na própria véspera", async () => {
    config.reminders = [{ minutesBefore: UM_DIA, sendTime: "16:00", template: "É amanhã." }];
    expect(await sendClinicorpConfirmation(CONTA, consulta(), parseScheduleConfig(config), { now: AGORA, operation: "send", userId: "u" }))
      .toMatchObject({ sent: true });
    expect(meta.sendBroadcastTemplate).toHaveBeenCalledOnce();
  });

  it("permite registrar a confirmação já feita pela equipe no próprio dia sem enviar mensagem", async () => {
    const result = await sendClinicorpConfirmation(CONTA, consulta({ startsAt: new Date("2026-09-28T18:00:00Z") }), parseScheduleConfig(config),
      { now: AGORA, operation: "manual", userId: "u" });
    expect(result).toMatchObject({ sent: false, reason: "manual" });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });

  it("mantém o lembrete de duas horas no próprio dia, fechando o da véspera sem enviar", async () => {
    config.reminders = [{ minutesBefore: UM_DIA, template: "É amanhã." }, { minutesBefore: 120, template: "Hoje às {{hora}}." }];
    provider("evolution");
    db.lead.findFirst.mockResolvedValue({ phone: "5514991406457", conversation: { id: "c", lastInboundAt: AGORA, whatsappProvider: "evolution" } });
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ startsAt: new Date("2026-09-28T14:00:00Z") })] });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 1 });
    expect(evolution.sendMessage).toHaveBeenCalledWith("inst-1", "5514991406457", "Hoje às 11:00.");
    expect(upserts()[0]).toMatchObject({ create: { remindersSent: [UM_DIA, 120], reminderSentAt: AGORA } });
  });

  it("pula a consulta que o próprio fechai espelhou no Clinicorp", async () => {
    db.appointment.findMany.mockResolvedValue([{ clinicorpAppointmentId: "4791226171916288" }]);
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it("não repete o que já saiu, mas volta a lembrar se a consulta foi remarcada lá", async () => {
    db.clinicorpReminder.findMany.mockResolvedValue([
      { clinicorpAppointmentId: "4791226171916288", startsAt: consulta().startsAt, remindersSent: [UM_DIA] },
    ]);
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();

    db.clinicorpReminder.findMany.mockResolvedValue([
      { clinicorpAppointmentId: "4791226171916288", startsAt: new Date("2026-09-25T11:00:00Z"), remindersSent: [UM_DIA] },
    ]);
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).toHaveBeenCalledOnce();
    expect(upserts().at(-1)).toMatchObject({ update: { startsAt: consulta().startsAt, remindersSent: { set: [UM_DIA] } } });
  });

  it("ainda não venceu: não manda", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ startsAt: new Date("2026-09-30T11:00:00Z") })], skipped: 0 });
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ["número bloqueado", () => blocklist.isPhoneBlocked.mockResolvedValue(true)],
    ["sem telefone", () => clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ phone: null })], skipped: 0 })],
    ["pediu para parar", () => db.lead.findFirst.mockResolvedValue({ phone: "5514991406457", conversation: { id: "c", lastInboundAt: null, followUpReason: "stop", variables: null } })],
  ])("%s: fecha sem enviar", async (_, arrange) => {
    arrange();
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(blockReminder).toHaveBeenCalled();
  });

  it("lembrete desligado, WhatsApp desconectado ou Clinicorp fora: nada sai", async () => {
    config.reminderEnabled = false;
    await scanAndSendClinicorpReminders(AGORA);
    config.reminderEnabled = true;
    db.whatsappInstance.findMany.mockResolvedValue([{ status: "disconnected", provider: "meta", externalId: "inst-1" }]);
    await scanAndSendClinicorpReminders(AGORA);
    provider("meta");
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "error", error: "fora" });
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();
  });
});

describe("com as duas conexões (QR e Meta) de pé", () => {
  const QR = { provider: "evolution", externalId: "inst-qr", status: "connected" };
  const META = { provider: "meta", externalId: "phone-meta", status: "connected" };
  const contato = (over: Record<string, unknown> = {}) => ({
    phone: "5514991406457",
    conversation: {
      id: "conversa-1", lastInboundAt: new Date("2026-09-01T12:00:00Z"),
      followUpReason: null, variables: null, whatsappProvider: "evolution", ...over,
    },
  });

  beforeEach(() => db.whatsappInstance.findMany.mockResolvedValue([QR, META]));

  it("quem já conversou pelo QR recebe o texto pelo QR — o número que ele conhece", async () => {
    db.lead.findFirst.mockResolvedValue(contato());

    await scanAndSendClinicorpReminders(AGORA);

    expect(evolution.sendMessage.mock.calls[0].slice(0, 2)).toEqual(["inst-qr", "5514991406457"]);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it("conversa antiga, sem canal registrado, também segue pelo QR", async () => {
    db.lead.findFirst.mockResolvedValue(contato({ whatsappProvider: null }));

    await scanAndSendClinicorpReminders(AGORA);

    expect(evolution.sendMessage).toHaveBeenCalledOnce();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it("quem nunca conversou recebe o template pela Meta — nunca primeiro contato pelo QR", async () => {
    await scanAndSendClinicorpReminders(AGORA);

    expect(meta.sendBroadcastTemplate).toHaveBeenCalledOnce();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });

  it("quem fala pela Meta recebe pela Meta, mesmo com o QR de pé", async () => {
    db.lead.findFirst.mockResolvedValue(contato({ whatsappProvider: "meta" }));

    await scanAndSendClinicorpReminders(AGORA);

    expect(meta.sendBroadcastTemplate).toHaveBeenCalledOnce();
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });

  it("quem fala pela Meta, sem template escolhido: fica pendente e NÃO cai no QR", async () => {
    delete config.metaReminderTemplate;
    db.lead.findFirst.mockResolvedValue(contato({ whatsappProvider: "meta" }));

    const result = await scanAndSendClinicorpReminders(AGORA);

    expect(result).toMatchObject({ sent: 0, firstContactSkipped: 1 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();
  });

  it("Meta parada: o paciente novo espera (o QR não faz primeiro contato)", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, { ...META, status: "disconnected" }]);

    const result = await scanAndSendClinicorpReminders(AGORA);

    expect(result).toMatchObject({ sent: 0, firstContactSkipped: 1 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });

  it("QR parado: o paciente novo continua recebendo pela Meta", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ ...QR, status: "disconnected" }, META]);

    await scanAndSendClinicorpReminders(AGORA);

    expect(meta.sendBroadcastTemplate).toHaveBeenCalledOnce();
  });

  it("a conversa criada pelo template nasce da Meta: a resposta manual não sai pelo QR", async () => {
    await scanAndSendClinicorpReminders(AGORA);

    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversa-nova" },
      data: { whatsappProvider: "meta" },
    });
  });

  it("conversa do QR sem entrada não migra para Meta silenciosamente", async () => {
    // Paciente do QR sem `lastInboundAt` (nunca escreveu) vai pela Meta, mas a
    // conversa dele continua sendo do QR até ele responder por lá.
    db.lead.findFirst.mockResolvedValue(contato({ lastInboundAt: null }));
    conversations.getOrCreateConversation.mockResolvedValue({
      lead: {}, conversation: { id: "conversa-1", whatsappProvider: "evolution" },
    });

    await scanAndSendClinicorpReminders(AGORA);

    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });
});


describe("QR autorizado para avaliações externas", () => {
  beforeEach(() => {
    provider("evolution");
    config.clinicorpQrEnabled = true;
    config.clinicorpQrRiskAcceptance = createQrRiskAcceptance("Responsável de teste", "user-test");
    config.clinicorpReminderCategoryIds = ["1"];
    config.reminderAudience = "selected_types";
    config.reminderTypes = ["Avaliação"];
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ categoryId: "1" })], skipped: 0 });
  });
  it("envia pelo QR sem conversa anterior e cria contexto para a resposta", async () => {
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 1 });
    expect(evolution.sendMessage).toHaveBeenCalledOnce();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(conversations.getOrCreateConversation).toHaveBeenCalledWith(CONTA, "5514991406457", "Maria Souza");
  });
  it("não envia somente por descrição quando o marcador autorizado não está presente", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ category: "Avaliação" })] });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });
  it("não envia a categoria de mesmo nome com outro id", async () => {
    config.clinicorpReminderCategoryIds = ["99"];
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });
  it("contato que usa Meta não é transferido para QR mesmo com autorização", async () => {
    db.lead.findFirst.mockResolvedValue({ phone: "5514991406457", conversation: { id: "c", lastInboundAt: null, whatsappProvider: "meta" } });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });
  it("exclui testes mesmo que o telefone bata com o da agenda", async () => {
    db.lead.findFirst.mockResolvedValue({ phone: "5514991406457", isTest: true });
    expect(await scanAndSendClinicorpReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
  });
});


describe("conferência imediatamente antes do envio", () => {
  it("não envia se a consulta foi cancelada depois da primeira leitura", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ canceled: true })] });
    expect(await sendClinicorpConfirmation(CONTA, consulta(), parseScheduleConfig(config), { now: AGORA })).toMatchObject({ reason: "changed", sent: false });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });
  it("não confirma o horário antigo após remarcação", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ startsAt: new Date("2026-09-29T14:00:00Z") })] });
    expect(await sendClinicorpConfirmation(CONTA, consulta(), parseScheduleConfig(config), { now: AGORA })).toMatchObject({ reason: "changed" });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });
  it("respeita lembrete desligado enquanto o envio estava na fila", async () => {
    const original = parseScheduleConfig(config);
    config.reminderEnabled = false;
    expect(await sendClinicorpConfirmation(CONTA, consulta(), original, { now: AGORA })).toMatchObject({ reason: "changed" });
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });
});
