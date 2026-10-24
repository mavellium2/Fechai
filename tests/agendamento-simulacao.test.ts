import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Simulação (chat de teste): validações e leituras rodam, mas nada grava nem
// espelha. Mesmo esqueleto de mocks de agendamento-tools.test.ts.
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  appointmentReschedule: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  tenantAction: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  conversation: { update: vi.fn(), updateMany: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
const mirrors = vi.hoisted(() => ({ googlePush: vi.fn(), googleDelete: vi.fn(), clinicorpPush: vi.fn(), clinicorpCancel: vi.fn(), clinicorpConflict: vi.fn(), clinicorpBusy: vi.fn(), clinicorpPending: vi.fn() }));
const icloud = vi.hoisted(() => ({ push: vi.fn(), update: vi.fn(), remove: vi.fn(), busy: vi.fn(), conflict: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: icloud.push, updateIcloudEvent: icloud.update, deleteIcloudEvent: icloud.remove,
  listIcloudBusyBlocks: icloud.busy, hasIcloudConflict: icloud.conflict,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: mirrors.googlePush, deleteEventFromGoogle: mirrors.googleDelete }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ pushAppointmentToClinicorp: mirrors.clinicorpPush, cancelAppointmentInClinicorp: mirrors.clinicorpCancel, hasClinicorpConflict: mirrors.clinicorpConflict, listClinicorpBusyBlocks: mirrors.clinicorpBusy, clinicorpConfirmationPending: mirrors.clinicorpPending }));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({
  syncAppointmentToClinicorp: (tenantId: string, _id: string, input: unknown) => mirrors.clinicorpPush(tenantId, input),
}));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: vi.fn(),
}));

import { runToolHandler, type ToolContext } from "@/modules/agent-engine/tools";
import { parseScheduleConfig } from "@/modules/scheduling/config";

const base = { tenantId: "conta-1", leadId: "cliente-1", agentId: "agente-1", conversationId: "conversa-1" };
const real = (): ToolContext => ({ ...base });
const dry = (): ToolContext => ({ ...base, dryRun: true });
const cfg = parseScheduleConfig({ allowCancellation: true, allowRescheduling: true, breaks: [{ label: "Almoço", startTime: "12:00", endTime: "13:00" }] });
const appointment = {
  id: "consulta-1", tenantId: base.tenantId, leadId: base.leadId, status: "scheduled",
  startsAt: new Date("2026-09-17T13:00:00Z"), endsAt: new Date("2026-09-17T13:30:00Z"),
  title: "Consulta", notes: null, googleEventId: "google-antigo", clinicorpAppointmentId: "123", icloudEventUrl: "https://icloud/evento.ics",
  remindersSent: [1440], reminderSentAt: new Date("2026-09-16T11:00:00Z"),
};
const schedule = (ctx: ToolContext, args = {}) => runToolHandler("schedule_meeting", ctx, { date: "2026-09-18", time: "14:00", patientName: "Paciente", ...args });
const cancel = (ctx: ToolContext, args = {}) => runToolHandler("cancel_meeting", ctx, { appointmentId: appointment.id, confirmed: true, ...args });
const reschedule = (ctx: ToolContext, args = {}) => runToolHandler("reschedule_meeting", ctx, { appointmentId: appointment.id, date: "2026-09-18", time: "14:00", confirmed: true, ...args });

/** Nenhum caminho de escrita: banco da agenda nem espelhos externos. */
function expectNothingWritten() {
  expect(db.appointment.create).not.toHaveBeenCalled();
  expect(db.appointment.update).not.toHaveBeenCalled();
  expect(db.appointment.updateMany).not.toHaveBeenCalled();
  expect(db.appointmentReschedule.create).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(db.lead.update).not.toHaveBeenCalled();
  expect(mirrors.clinicorpPush).not.toHaveBeenCalled();
  expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
  expect(mirrors.googlePush).not.toHaveBeenCalled();
  expect(mirrors.googleDelete).not.toHaveBeenCalled();
  expect(icloud.push).not.toHaveBeenCalled();
  expect(icloud.update).not.toHaveBeenCalled();
  expect(icloud.remove).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  db.tenantAction.findFirst.mockResolvedValue({ config: cfg });
  db.tenantAction.findUnique.mockResolvedValue({ config: cfg });
  db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id && where.tenantId === base.tenantId && where.leadId === base.leadId ? { ...appointment } : null);
  db.appointment.findMany.mockResolvedValue([]);
  db.appointment.updateMany.mockResolvedValue({ count: 1 });
  db.appointment.create.mockResolvedValue({ id: "novo" });
  db.appointment.update.mockResolvedValue({});
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.appointmentReschedule.create.mockResolvedValue({ id: "historico-1" });
  db.appointmentReschedule.deleteMany.mockResolvedValue({ count: 1 });
  db.lead.findFirst.mockResolvedValue({ name: "Cliente", phone: "5511999999999" });
  db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999" });
  db.lead.update.mockResolvedValue({});
  mirrors.googleDelete.mockResolvedValue(true);
  mirrors.clinicorpCancel.mockResolvedValue(true);
  mirrors.googlePush.mockResolvedValue("google-novo");
  mirrors.clinicorpPush.mockResolvedValue({ status: "synced", appointmentId: "456" });
  mirrors.clinicorpConflict.mockResolvedValue(false);
  mirrors.clinicorpBusy.mockResolvedValue([]);
  mirrors.clinicorpPending.mockResolvedValue(false);
  icloud.push.mockResolvedValue({ status: "skipped" });
  icloud.update.mockResolvedValue({ status: "skipped" });
  icloud.remove.mockResolvedValue(true);
  icloud.busy.mockResolvedValue([]);
  icloud.conflict.mockResolvedValue(false);
});
afterEach(() => vi.useRealTimers());

describe("simulação da agenda (dryRun)", () => {
  it("schedule_meeting valida e descreve, sem criar nem espelhar", async () => {
    const out = await schedule(dry());
    expect(out).toContain("Simulação");
    expect(out).toContain("seria marcado");
    expectNothingWritten();
    // Leituras continuam: conflito conferido nas agendas externas.
    expect(mirrors.clinicorpConflict).toHaveBeenCalled();
    expect(icloud.conflict).toHaveBeenCalled();
  });

  it("schedule_meeting em simulação ainda recusa horário fora do expediente e ocupado", async () => {
    const lunch = await schedule(dry(), { time: "12:30" });
    expect(lunch).not.toContain("Simulação");
    expect(lunch).toContain("Fora dos períodos");

    mirrors.clinicorpConflict.mockResolvedValue(true);
    const busy = await schedule(dry());
    expect(busy).not.toContain("seria marcado");
    expectNothingWritten();
  });

  it("cancel_meeting não cancela nada", async () => {
    const out = await cancel(dry());
    expect(out).toContain("Simulação");
    expect(out).toContain("seria cancelada");
    expectNothingWritten();
  });

  it("cancel_meeting em simulação ainda exige a confirmação do cliente", async () => {
    const out = await cancel(dry(), { confirmed: false });
    expect(out).toContain("Nenhuma alteração foi feita");
    expect(out).not.toContain("Simulação");
    expectNothingWritten();
  });

  it("reschedule_meeting não reagenda nem mexe nos espelhos", async () => {
    const out = await reschedule(dry());
    expect(out).toContain("Simulação");
    expect(out).toContain("seria remarcada");
    expectNothingWritten();
  });

  it("reschedule_meeting em simulação oferece alternativas quando há conflito", async () => {
    mirrors.clinicorpConflict.mockResolvedValue(true);
    const out = await reschedule(dry());
    expect(out).not.toContain("seria remarcada");
    expectNothingWritten();
  });
});

describe("fluxo real (sem dryRun) segue igual", () => {
  it("schedule_meeting cria o agendamento e espelha", async () => {
    const out = await schedule(real());
    expect(out).toContain("Agendado para");
    expect(out).not.toContain("Simulação");
    expect(db.appointment.create).toHaveBeenCalledOnce();
    expect(mirrors.googlePush).toHaveBeenCalledOnce();
    expect(mirrors.clinicorpPush).toHaveBeenCalledOnce();
    expect(icloud.push).toHaveBeenCalledOnce();
  });

  it("dryRun: false explícito também é o fluxo real", async () => {
    const out = await schedule({ ...base, dryRun: false });
    expect(out).toContain("Agendado para");
    expect(db.appointment.create).toHaveBeenCalledOnce();
  });

  it("cancel_meeting cancela e remove dos espelhos", async () => {
    db.appointment.findFirst.mockImplementation(async () => ({ ...appointment }));
    const out = await cancel(real());
    expect(out).not.toContain("Simulação");
    expect(out).toContain("Cancelamento");
    expect(db.appointment.updateMany).toHaveBeenCalled();
    expect(mirrors.googleDelete).toHaveBeenCalled();
    expect(mirrors.clinicorpCancel).toHaveBeenCalled();
  });

  it("reschedule_meeting reagenda de verdade", async () => {
    const out = await reschedule(real());
    expect(out).not.toContain("Simulação");
    expect(out).toContain("reagendada");
    expect(db.appointmentReschedule.create).toHaveBeenCalledOnce();
    expect(mirrors.googlePush).toHaveBeenCalled();
    expect(mirrors.clinicorpPush).toHaveBeenCalled();
  });
});
