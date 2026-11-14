import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-02 — a agenda do lead da campanha de implantes: só 18 ou 19/11/2026 às 09:00,
 * recusado no servidor (backend), nos quatro pontos: `list_available_slots`,
 * `schedule_meeting`, `reschedule_meeting` e `createAppointment`. Prisma simulado, sem banco.
 */

const db = vi.hoisted(() => ({
  campaignLead: { findMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  appointmentReschedule: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  tenantAction: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  conversation: { update: vi.fn(), updateMany: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  leadAdOrigin: { findMany: vi.fn() },
}));
const mirrors = vi.hoisted(() => ({ googlePush: vi.fn(), clinicorpPush: vi.fn(), clinicorpCancel: vi.fn(), clinicorpConflict: vi.fn(), clinicorpBusy: vi.fn(), clinicorpPending: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: async () => ({ status: "skipped" }),
  updateIcloudEvent: async () => ({ status: "skipped" }),
  deleteIcloudEvent: async () => true,
  listIcloudBusyBlocks: async () => [],
  hasIcloudConflict: async () => false,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: mirrors.googlePush, deleteEventFromGoogle: vi.fn(async () => true) }));
vi.mock("@/modules/scheduling/clinicorp", () => ({
  pushAppointmentToClinicorp: mirrors.clinicorpPush,
  cancelAppointmentInClinicorp: mirrors.clinicorpCancel,
  hasClinicorpConflict: mirrors.clinicorpConflict,
  listClinicorpBusyBlocks: mirrors.clinicorpBusy,
  clinicorpConfirmationPending: mirrors.clinicorpPending,
}));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({
  syncAppointmentToClinicorp: (tenantId: string, _id: string, input: unknown) => mirrors.clinicorpPush(tenantId, input),
}));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: vi.fn(),
}));

import { runToolHandler, type ToolContext } from "@/modules/agent-engine/tools";
import { findLeadCampaign } from "@/modules/campaigns/active";
import { OVERRIDE_CAMPAIGN_ID, OVERRIDE_REFUSAL } from "@/modules/campaign-override/agent";
import { createAppointment } from "@/modules/scheduling/repository";

const TENANT = "conta-1";
const CAMPAIGN_LEAD = "lead-1";
const NORMAL_LEAD = "lead-9";
const ctxOf = (leadId: string) => ({ tenantId: TENANT, leadId, agentId: "agente-1", conversationId: `conversa-${leadId}` });

function overrideRow(rules: Record<string, unknown> = { capacityPerDay: 5 }) {
  return {
    id: "o1",
    key: "implantes-2026-11",
    adCodes: [],
    adSourceIds: [],
    broadcastCampaignIds: [],
    leadIds: [CAMPAIGN_LEAD],
    startsAt: new Date("2026-11-10T00:00:00Z"),
    // Corte rígido: 19/11/2026 23:59:59 em Brasília.
    endsAt: new Date("2026-11-20T02:59:59Z"),
    rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00", ...rules },
  };
}

/** Uma `Campaign` real ligada ao lead (a do #28), com as próprias datas. */
function realCampaignLink() {
  return {
    assignedAt: new Date("2026-11-10T12:00:00Z"),
    sentAssetIds: [],
    campaign: {
      id: "camp-real", name: "Campanha real", objective: null, description: null, timezone: "America/Sao_Paulo",
      startsAt: new Date("2026-11-01T03:00:00Z"), endsAt: new Date("2026-11-30T02:59:59Z"), agentId: null, baseAgentId: null,
      rules: { dates: ["2026-11-25"], times: ["10:00"] }, assets: [],
    },
  };
}

const schedule = (leadId: string, date: string, time: string) =>
  runToolHandler("schedule_meeting", ctxOf(leadId) as ToolContext, { date, time, patientName: "Paciente" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  let override = overrideRow();
  db.campaignOverride.findMany.mockImplementation(async ({ where }: { where: { startsAt: { lte: Date }; endsAt: { gte: Date } } }) =>
    override.startsAt <= where.startsAt.lte && override.endsAt >= where.endsAt.gte ? [override] : [],
  );
  (db as unknown as { setOverride: (r: Record<string, unknown>) => void }).setOverride = (rules) => { override = overrideRow(rules); };
  db.campaignLead.findMany.mockResolvedValue([]);
  db.leadAdOrigin.findMany.mockResolvedValue([]);
  db.tenantAction.findFirst.mockResolvedValue({ config: { allowRescheduling: true } });
  db.tenantAction.findUnique.mockResolvedValue({ config: { allowRescheduling: true } });
  db.appointment.findFirst.mockResolvedValue(null);
  db.appointment.findMany.mockResolvedValue([]);
  db.appointment.count.mockResolvedValue(0);
  db.appointment.create.mockResolvedValue({ id: "consulta-nova" });
  db.appointment.update.mockResolvedValue({});
  db.appointment.updateMany.mockResolvedValue({ count: 1 });
  db.appointmentReschedule.create.mockResolvedValue({ id: "historico-1" });
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.$executeRaw.mockResolvedValue(1);
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999", isTest: false });
  db.lead.findFirst.mockResolvedValue({ name: "Paciente", phone: "5511999999999", isTest: false });
  db.lead.update.mockResolvedValue({});
  mirrors.googlePush.mockResolvedValue(null);
  mirrors.clinicorpPush.mockResolvedValue({ status: "skipped" });
  mirrors.clinicorpCancel.mockResolvedValue(true);
  mirrors.clinicorpConflict.mockResolvedValue(false);
  mirrors.clinicorpBusy.mockResolvedValue([]);
  mirrors.clinicorpPending.mockResolvedValue(false);
});
afterEach(() => vi.useRealTimers());

describe("schedule_meeting — lead da campanha só marca 18 ou 19/11 às 09:00", () => {
  it("pede dia 20: recusa com a frase do card e não grava nada", async () => {
    const reply = await schedule(CAMPAIGN_LEAD, "2026-11-20", "09:00");
    expect(reply).toContain(OVERRIDE_REFUSAL);
    expect(reply).toContain("Para a campanha de implantes, só 18 ou 19/11 com chegada às 09h00. Ofereça essas opções.");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("18 às 09:30 é recusado; 18 e 19 às 09:00 são aceitos", async () => {
    expect(await schedule(CAMPAIGN_LEAD, "2026-11-18", "09:30")).toContain(OVERRIDE_REFUSAL);
    expect(await schedule(CAMPAIGN_LEAD, "2026-11-18", "08:00")).toContain(OVERRIDE_REFUSAL);
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(await schedule(CAMPAIGN_LEAD, "2026-11-18", "09:00")).toContain("Agendado para");
    expect(await schedule(CAMPAIGN_LEAD, "2026-11-19", "09:00")).toContain("Agendado para");
    expect(db.appointment.create).toHaveBeenCalledTimes(2);
  });

  it("a trava é do backend: createAppointment recusa o horário fora da regra mesmo sem passar pela tool", async () => {
    await expect(
      createAppointment({
        tenantId: TENANT, agentId: "agente-1", leadId: CAMPAIGN_LEAD, title: "Paciente",
        startsAt: new Date("2026-11-20T12:00:00Z"), durationMinutes: 30, source: "agent", timezone: "America/Sao_Paulo",
      }),
    ).rejects.toThrow(OVERRIDE_REFUSAL);
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("marcação manual da equipe (source manual) não passa pela trava", async () => {
    await expect(
      createAppointment({
        tenantId: TENANT, leadId: CAMPAIGN_LEAD, title: "Paciente",
        startsAt: new Date("2026-11-20T12:00:00Z"), durationMinutes: 30, source: "manual", timezone: "America/Sao_Paulo",
      }),
    ).resolves.toBeTruthy();
    expect(db.appointment.create).toHaveBeenCalledOnce();
  });
});

describe("list_available_slots — só as duas vagas do evento", () => {
  it("devolve 18/11 e 19/11 às 09:00 qualquer que seja o dia pedido, e mais nada", async () => {
    const reply = await runToolHandler("list_available_slots", ctxOf(CAMPAIGN_LEAD) as ToolContext, { date: "2026-11-20" });
    expect(reply).toContain("18/11/2026 (2026-11-18): 09:00 (5 vagas)");
    expect(reply).toContain("19/11/2026 (2026-11-19): 09:00 (5 vagas)");
    expect(reply.match(/^- /gm)).toHaveLength(2);
  });
});

describe("reschedule_meeting — a mesma regra", () => {
  const consulta = {
    id: "consulta-1", tenantId: TENANT, leadId: CAMPAIGN_LEAD, status: "scheduled",
    startsAt: new Date("2026-11-18T13:00:00Z"), endsAt: new Date("2026-11-18T13:30:00Z"),
    title: "Paciente", notes: null, googleEventId: null, clinicorpAppointmentId: null,
    remindersSent: [], reminderSentAt: null, confirmedAt: null, confirmationSource: null, rescheduledAt: null,
  };
  const reschedule = (date: string, time: string) =>
    runToolHandler("reschedule_meeting", ctxOf(CAMPAIGN_LEAD) as ToolContext, { appointmentId: consulta.id, date, time, confirmed: true });

  beforeEach(() => {
    db.appointment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (where.id === consulta.id ? { ...consulta } : null));
  });

  it("remarcar para 20/11 ou para outra hora é recusado, e o horário original continua reservado", async () => {
    for (const [date, time] of [["2026-11-20", "09:00"], ["2026-11-19", "10:00"]]) {
      const reply = await reschedule(date, time);
      expect(reply).toContain(OVERRIDE_REFUSAL);
      expect(reply).toContain("O horário original continua reservado");
    }
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("remarcar para 19/11 às 09:00 funciona", async () => {
    expect(await reschedule("2026-11-19", "09:00")).toContain("reagendada");
    const [move] = db.appointment.updateMany.mock.calls[0] as [{ data: { startsAt: Date; reminderOverride: unknown } }];
    expect(move.data.startsAt).toEqual(new Date("2026-11-19T12:00:00Z"));
    expect(move.data.reminderOverride).toEqual([]);
  });
});

describe("vigência e precedência", () => {
  it("falha ao ler a regra: a agenda não libera horário (a tool falha fechada, nada é gravado)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.campaignOverride.findMany.mockRejectedValue(new Error("banco fora do ar"));
    expect(await schedule(CAMPAIGN_LEAD, "2026-11-20", "09:00")).toBe("Falha ao executar schedule_meeting.");
    expect(await schedule(CAMPAIGN_LEAD, "2026-11-18", "09:00")).toBe("Falha ao executar schedule_meeting.");
    await expect(
      createAppointment({
        tenantId: TENANT, leadId: CAMPAIGN_LEAD, title: "Paciente", startsAt: new Date("2026-11-20T12:00:00Z"),
        durationMinutes: 30, source: "agent", timezone: "America/Sao_Paulo",
      }),
    ).rejects.toThrow("banco fora do ar");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("uma Campaign real ligada ao lead vence a regra provisória", async () => {
    db.campaignLead.findMany.mockResolvedValue([realCampaignLink()]);
    const campaign = await findLeadCampaign(TENANT, CAMPAIGN_LEAD);
    expect(campaign?.campaign.id).toBe("camp-real");
    // 25/11 às 10:00 é da campanha real; 18/11 às 09:00 (do override) não é mais permitido.
    expect(await schedule(CAMPAIGN_LEAD, "2026-11-25", "10:00")).toContain("Agendado para");
    const refused = await schedule(CAMPAIGN_LEAD, "2026-11-18", "09:00");
    expect(refused).toContain("Horário recusado pela regra da campanha");
    expect(refused).not.toContain(OVERRIDE_REFUSAL);
  });

  it("sem Campaign real, o lead recebe a campanha sintética do override", async () => {
    expect((await findLeadCampaign(TENANT, CAMPAIGN_LEAD))?.campaign.id).toBe(OVERRIDE_CAMPAIGN_ID);
    expect(await findLeadCampaign(TENANT, NORMAL_LEAD)).toBeNull();
  });

  it("até 19/11 23:59:59 vale a regra; um segundo depois, tudo volta ao normal sem deploy", async () => {
    vi.setSystemTime(new Date("2026-11-20T02:59:59Z"));
    expect((await findLeadCampaign(TENANT, CAMPAIGN_LEAD))?.campaign.id).toBe(OVERRIDE_CAMPAIGN_ID);
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    expect(await findLeadCampaign(TENANT, CAMPAIGN_LEAD)).toBeNull();
    const reply = await schedule(CAMPAIGN_LEAD, "2026-11-23", "10:00");
    expect(reply).toContain("Agendado para");
    expect(reply).not.toContain(OVERRIDE_REFUSAL);
  });

  it("lead fora da campanha segue a agenda normal: 09:30 e outras datas", async () => {
    expect(await schedule(NORMAL_LEAD, "2026-11-18", "09:30")).toContain("Agendado para");
    expect(await schedule(NORMAL_LEAD, "2026-11-24", "10:00")).toContain("Agendado para");
    const slots = await runToolHandler("list_available_slots", ctxOf(NORMAL_LEAD) as ToolContext, { date: "2026-11-24" });
    expect(slots).not.toContain("Vagas da campanha");
  });
});
