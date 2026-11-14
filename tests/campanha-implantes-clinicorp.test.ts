import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-02 — as consultas marcadas nas vagas do evento (regra provisória) NÃO são
 * espelhadas no Clinicorp: a recepção as lança à mão (`--evento` na lista). Quem não
 * é da campanha segue espelhando como sempre. Prisma simulado, sem banco.
 */

const db = vi.hoisted(() => ({
  campaignLead: { findMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  leadAdOrigin: { findMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  appointmentReschedule: { create: vi.fn(), deleteMany: vi.fn() },
  tenantAction: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  conversation: { update: vi.fn(), updateMany: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
const clinicorp = vi.hoisted(() => ({
  sync: vi.fn(),
  push: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: async () => ({ status: "skipped" }), updateIcloudEvent: async () => ({ status: "skipped" }),
  deleteIcloudEvent: async () => true, listIcloudBusyBlocks: async () => [], hasIcloudConflict: async () => false,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: vi.fn(async () => null), deleteEventFromGoogle: vi.fn(async () => true) }));
vi.mock("@/modules/scheduling/clinicorp", () => ({
  pushAppointmentToClinicorp: clinicorp.push,
  cancelAppointmentInClinicorp: clinicorp.cancel,
  hasClinicorpConflict: vi.fn(async () => false),
  listClinicorpBusyBlocks: vi.fn(async () => []),
  clinicorpConfirmationPending: vi.fn(async () => false),
}));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({ syncAppointmentToClinicorp: clinicorp.sync }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: vi.fn(),
}));

import { runToolHandler, type ToolContext } from "@/modules/agent-engine/tools";
import { createAppointment, rescheduleAppointment } from "@/modules/scheduling/repository";

const TENANT = "conta-1";
const CAMPAIGN_LEAD = "lead-1";
const NORMAL_LEAD = "lead-9";
const ctxOf = (leadId: string) => ({ tenantId: TENANT, leadId, agentId: "agente-1", conversationId: `conversa-${leadId}` }) as ToolContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  db.campaignOverride.findMany.mockImplementation(async ({ where }: { where: { startsAt: { lte: Date }; endsAt: { gte: Date } } }) => {
    const row = {
      id: "o1", key: "implantes-2026-11", adCodes: [], adSourceIds: [], broadcastCampaignIds: [], leadIds: [CAMPAIGN_LEAD],
      startsAt: new Date("2026-11-10T00:00:00Z"), endsAt: new Date("2026-11-20T02:59:59Z"),
      rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00", capacityPerDay: 5 },
    };
    return row.startsAt <= where.startsAt.lte && row.endsAt >= where.endsAt.gte ? [row] : [];
  });
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
  db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999", isTest: false });
  db.lead.findFirst.mockResolvedValue({ name: "Paciente", phone: "5511999999999", isTest: false });
  db.lead.update.mockResolvedValue({});
  clinicorp.sync.mockResolvedValue({ status: "synced", appointmentId: "777" });
  clinicorp.push.mockResolvedValue({ status: "synced", appointmentId: "888" });
  clinicorp.cancel.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

const create = (leadId: string, startsAtIso: string) =>
  createAppointment({
    tenantId: TENANT, agentId: "agente-1", leadId, title: "Paciente", startsAt: new Date(startsAtIso),
    durationMinutes: 30, source: "agent", timezone: "America/Sao_Paulo",
  });

describe("espelho no Clinicorp", () => {
  it("consulta do override (18/11 às 09:00) não chama syncAppointmentToClinicorp", async () => {
    const appointment = await create(CAMPAIGN_LEAD, "2026-11-18T12:00:00Z");
    expect(clinicorp.sync).not.toHaveBeenCalled();
    expect(clinicorp.push).not.toHaveBeenCalled();
    expect(appointment.clinicorpSync).toEqual({ status: "skipped" });
    expect(appointment.clinicorpAppointmentId).toBeNull();
    expect(appointment.status).not.toBe("canceled");
  });

  it("pela tool schedule_meeting também: agenda no fechai e confirma ao contato, sem Clinicorp", async () => {
    const reply = await runToolHandler("schedule_meeting", ctxOf(CAMPAIGN_LEAD), { date: "2026-11-19", time: "09:00", patientName: "Paciente" });
    expect(reply).toContain("Agendado para");
    expect(clinicorp.sync).not.toHaveBeenCalled();
    expect(db.appointment.create).toHaveBeenCalledOnce();
  });

  it("lead fora da campanha segue espelhando no Clinicorp", async () => {
    const appointment = await create(NORMAL_LEAD, "2026-11-24T12:00:00Z");
    expect(clinicorp.sync).toHaveBeenCalledOnce();
    expect(appointment.clinicorpAppointmentId).toBe("777");
  });

  it("depois do corte rígido o lead da campanha volta a espelhar", async () => {
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    await create(CAMPAIGN_LEAD, "2026-11-24T12:00:00Z");
    expect(clinicorp.sync).toHaveBeenCalledOnce();
  });

  it("remarcar para uma vaga do evento não cria a consulta nova no Clinicorp (a antiga é retirada)", async () => {
    const previous = {
      id: "consulta-1", tenantId: TENANT, leadId: CAMPAIGN_LEAD, status: "scheduled",
      startsAt: new Date("2026-11-18T12:00:00Z"), endsAt: new Date("2026-11-18T12:30:00Z"), title: "Paciente", notes: null,
      patientName: "Paciente", serviceType: null, procedure: null, googleEventId: null, clinicorpAppointmentId: "555",
      remindersSent: [], reminderSentAt: null, confirmedAt: null, confirmationSource: null, rescheduledAt: null, icloudEventUrl: null, agentId: "agente-1",
    };
    db.appointment.findFirst.mockResolvedValue({ ...previous });
    const result = await rescheduleAppointment({
      tenantId: TENANT, leadId: CAMPAIGN_LEAD, id: previous.id, startsAt: new Date("2026-11-19T12:00:00Z"), timezone: "America/Sao_Paulo", eventSlot: true,
    });
    expect(result).toMatchObject({ status: "rescheduled", clinicorpSync: { status: "skipped" } });
    expect(clinicorp.cancel).toHaveBeenCalledWith(TENANT, "555");
    expect(clinicorp.push).not.toHaveBeenCalled();
    const [{ data }] = db.appointment.updateMany.mock.calls.at(-1) as [{ data: { clinicorpAppointmentId: string | null } }];
    expect(data.clinicorpAppointmentId).toBeNull();
  });
});
