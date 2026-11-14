import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CMP-03 — remarcar com Clinicorp "não espelhar" (campanha real): o Clinicorp
 * não é tocado (nem cancelar a consulta antiga, nem criar a nova). Sem `off`,
 * o caminho segue igual. Prisma simulado, sem banco.
 */

const db = vi.hoisted(() => ({
  campaignLead: { findMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  $transaction: vi.fn(),
  appointmentReschedule: { create: vi.fn(), deleteMany: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  lead: { findFirst: vi.fn() },
}));
const clinicorp = vi.hoisted(() => ({ push: vi.fn(), cancel: vi.fn() }));
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
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({ syncAppointmentToClinicorp: vi.fn() }));

import { rescheduleAppointment } from "@/modules/scheduling/repository";

const TENANT = "conta-1";
const LEAD = "lead-1";

function link(rules: Record<string, unknown>) {
  return {
    assignedAt: new Date("2026-11-10T12:00:00Z"),
    sentAssetIds: [],
    campaign: {
      id: "camp-real", name: "Implantes", objective: null, description: null, timezone: "America/Sao_Paulo",
      startsAt: new Date("2026-11-01T03:00:00Z"), endsAt: new Date("2026-11-20T02:59:59Z"), rules, assets: [],
    },
  };
}

const previous = {
  id: "consulta-1", tenantId: TENANT, leadId: LEAD, status: "scheduled",
  startsAt: new Date("2026-11-18T12:00:00Z"), endsAt: new Date("2026-11-18T12:30:00Z"), title: "Paciente", notes: null,
  patientName: "Paciente", serviceType: null, procedure: null, googleEventId: null, clinicorpAppointmentId: "555",
  remindersSent: [], reminderSentAt: null, confirmedAt: null, confirmationSource: null, rescheduledAt: null, icloudEventUrl: null, agentId: "agente-1",
};

const move = () =>
  rescheduleAppointment({ tenantId: TENANT, leadId: LEAD, id: previous.id, startsAt: new Date("2026-11-19T12:00:00Z"), timezone: "America/Sao_Paulo" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.campaignOverride.findMany.mockResolvedValue([]);
  db.appointment.findFirst.mockResolvedValueOnce({ ...previous }).mockResolvedValue(null);
  db.appointment.findMany.mockResolvedValue([]);
  db.appointment.count.mockResolvedValue(0);
  db.appointment.updateMany.mockResolvedValue({ count: 1 });
  db.appointmentReschedule.create.mockResolvedValue({ id: "hist-1" });
  db.lead.findFirst.mockResolvedValue({ name: "Paciente", phone: "5511999999999", isTest: false });
  clinicorp.cancel.mockResolvedValue(true);
  clinicorp.push.mockResolvedValue({ status: "synced", appointmentId: "888" });
});
afterEach(() => vi.useRealTimers());

describe("remarcar com Clinicorp da campanha", () => {
  it("off: não cancela nem cria no Clinicorp e mantém o id antigo (a recepção ajusta à mão)", async () => {
    db.campaignLead.findMany.mockResolvedValue([link({ dates: ["2026-11-19"], times: ["09:00"], clinicorp: { mode: "off" } })]);
    const result = await move();
    expect(result).toMatchObject({ status: "rescheduled", clinicorpSync: { status: "skipped" } });
    expect(clinicorp.cancel).not.toHaveBeenCalled();
    expect(clinicorp.push).not.toHaveBeenCalled();
    const [{ data }] = db.appointment.updateMany.mock.calls.at(-1) as [{ data: { clinicorpAppointmentId: string | null } }];
    expect(data.clinicorpAppointmentId).toBe("555");
  });

  it("sem off: cancela a antiga e cria a nova, como sempre", async () => {
    db.campaignLead.findMany.mockResolvedValue([link({ dates: ["2026-11-19"], times: ["09:00"] })]);
    const result = await move();
    expect(result).toMatchObject({ status: "rescheduled", clinicorpSync: { status: "synced" } });
    expect(clinicorp.cancel).toHaveBeenCalledWith(TENANT, "555");
    expect(clinicorp.push).toHaveBeenCalledOnce();
  });
});
