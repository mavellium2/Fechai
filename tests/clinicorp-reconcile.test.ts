import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O fechai acompanha o que a recepção muda direto no Clinicorp.
 *
 * Caso real (24/11/2026): Gilberto foi agendado pela IA às 10:15 e remarcado no
 * Clinicorp para 10:00. O lembrete saiu com "10:15". A Lucimar foi agendada pela
 * IA, não aparecia no Clinicorp, e mesmo assim recebeu lembrete.
 */

const db = vi.hoisted(() => {
  const tx = {
    appointment: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    appointmentReschedule: { create: vi.fn() },
  };
  return { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
});
const stage = vi.hoisted(() => ({ moveLeadToStage: vi.fn() }));
const google = vi.hoisted(() => ({ deleteEventFromGoogle: vi.fn(), pushEventToGoogle: vi.fn() }));
const icloud = vi.hoisted(() => ({ deleteIcloudEvent: vi.fn(), updateIcloudEvent: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/crm/automatic-stage", () => stage);
vi.mock("@/modules/scheduling/clinicorp", () => ({ listClinicorpAgenda: vi.fn() }));
vi.mock("@/modules/scheduling/google", () => google);
vi.mock("@/modules/scheduling/icloud", () => icloud);

import {
  decideReconcile,
  reconcileMirroredAppointments,
  reminderVerdict,
  resetReconcileCache,
  type MirroredAppointment,
} from "@/modules/scheduling/clinicorp-reconcile";
import type { ClinicorpAgenda, ClinicorpAgendaItem } from "@/modules/scheduling/clinicorp";

const TZ = "America/Sao_Paulo";
const AGORA = new Date("2026-11-24T11:30:00.000Z"); // 08:30 em Brasília
const ANTIGA = new Date("2026-11-16T14:53:00.000Z");

// 25/11 às 10:15 em Brasília, como o fechai gravou.
const local = (over: Partial<MirroredAppointment> = {}): MirroredAppointment => ({
  id: "appt-gilberto",
  startsAt: new Date("2026-11-25T13:15:00.000Z"),
  endsAt: new Date("2026-11-25T13:30:00.000Z"),
  clinicorpAppointmentId: "4791226171916288",
  updatedAt: ANTIGA,
  ...over,
});
const remote = (over: Partial<ClinicorpAgendaItem> = {}): ClinicorpAgendaItem => ({
  id: "4791226171916288",
  startsAt: new Date("2026-11-25T13:15:00.000Z"),
  endsAt: new Date("2026-11-25T13:30:00.000Z"),
  patientName: "Gilberto Gonçalves", phone: "14910059843", professional: null, notes: null,
  ...over,
});
const agenda = (items: ClinicorpAgendaItem[], skipped = 0): ClinicorpAgenda => ({ status: "ok", items, skipped, fetchedAt: AGORA.getTime() });

describe("decideReconcile", () => {
  const complete = { readComplete: true, now: AGORA };

  it("mesmo horário: nada a fazer", () => {
    expect(decideReconcile(local(), remote(), complete)).toEqual({ kind: "same" });
  });

  it("remarcada no Clinicorp: segue o horário de lá", () => {
    const decision = decideReconcile(local(), remote({
      startsAt: new Date("2026-11-25T13:00:00.000Z"), endsAt: new Date("2026-11-25T13:15:00.000Z"),
    }), complete);
    expect(decision).toEqual({
      kind: "moved", startsAt: new Date("2026-11-25T13:00:00.000Z"), endsAt: new Date("2026-11-25T13:15:00.000Z"),
    });
  });

  it("remarcada sem fim válido: mantém a duração que a consulta já tinha", () => {
    const decision = decideReconcile(local(), remote({ startsAt: new Date("2026-11-25T13:00:00.000Z"), endsAt: null }), complete);
    expect(decision).toEqual({
      kind: "moved", startsAt: new Date("2026-11-25T13:00:00.000Z"), endsAt: new Date("2026-11-25T13:15:00.000Z"),
    });
  });

  it("cancelada no Clinicorp", () => {
    expect(decideReconcile(local(), remote({ canceled: true }), complete)).toEqual({ kind: "canceled" });
  });

  it("ausente da leitura completa: não está lá", () => {
    expect(decideReconcile(local(), undefined, complete)).toEqual({ kind: "missing" });
  });

  it("ausente numa leitura incompleta não prova nada", () => {
    expect(decideReconcile(local(), undefined, { readComplete: false, now: AGORA })).toEqual({ kind: "unverified" });
  });

  it("consulta que acabou de ser criada ou movida aqui ainda pode não constar da lista", () => {
    const recent = local({ updatedAt: new Date(AGORA.getTime() - 5 * 60_000) });
    expect(decideReconcile(recent, undefined, complete)).toEqual({ kind: "unverified" });
  });
});

describe("reminderVerdict", () => {
  it("sem conferência ou sem consultas espelhadas, segue o fluxo de sempre", () => {
    expect(reminderVerdict(undefined, "a")).toBe("send");
    expect(reminderVerdict({ status: "idle" }, "a")).toBe("send");
  });

  it("não consegue ler o Clinicorp: espera a próxima volta em vez de lembrar com horário não conferido", () => {
    expect(reminderVerdict({ status: "unavailable", error: "x" }, "a")).toBe("wait");
  });

  it("ausente do Clinicorp: não lembra", () => {
    const result = { status: "ok" as const, moved: 0, canceled: 0, missing: new Set(["a"]), unverified: new Set<string>() };
    expect(reminderVerdict(result, "a")).toBe("missing");
    expect(reminderVerdict(result, "b")).toBe("send");
  });

  it("não deu para conferir esta consulta: espera", () => {
    const result = { status: "ok" as const, moved: 0, canceled: 0, missing: new Set<string>(), unverified: new Set(["a"]) };
    expect(reminderVerdict(result, "a")).toBe("wait");
  });
});

describe("reconcileMirroredAppointments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReconcileCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.appointment.updateMany.mockResolvedValue({ count: 1 });
    db.appointmentReschedule.create.mockResolvedValue({});
    db.appointment.findFirst.mockResolvedValue(null);
    google.deleteEventFromGoogle.mockResolvedValue(true);
    google.pushEventToGoogle.mockResolvedValue("google-novo");
  });
  const rows = (...appointments: MirroredAppointment[]) => db.appointment.findMany.mockResolvedValue(appointments);

  it("sem consulta espelhada, nem lê o Clinicorp", async () => {
    rows();
    const read = vi.fn();
    await expect(reconcileMirroredAppointments("t1", TZ, AGORA, { read })).resolves.toEqual({ status: "idle" });
    expect(read).not.toHaveBeenCalled();
  });

  it("remarcada: grava o horário novo, guarda o anterior e libera os lembretes para o horário certo", async () => {
    rows(local());
    const read = vi.fn(async () => agenda([remote({
      startsAt: new Date("2026-11-25T13:00:00.000Z"), endsAt: new Date("2026-11-25T13:15:00.000Z"),
    })]));
    const result = await reconcileMirroredAppointments("t1", TZ, AGORA, { read });

    expect(result).toMatchObject({ status: "ok", moved: 1, canceled: 0 });
    const update = db.appointment.updateMany.mock.calls[0][0];
    // Só grava se ninguém mexeu entre a leitura e a gravação.
    expect(update.where).toMatchObject({ id: "appt-gilberto", tenantId: "t1", status: "scheduled", startsAt: local().startsAt });
    expect(update.data).toMatchObject({
      startsAt: new Date("2026-11-25T13:00:00.000Z"), endsAt: new Date("2026-11-25T13:15:00.000Z"),
      rescheduledAt: AGORA, confirmedAt: null, remindersSent: { set: [] }, reminderSentAt: null,
    });
    expect(db.appointmentReschedule.create.mock.calls[0][0].data).toMatchObject({
      appointmentId: "appt-gilberto", startsAt: local().startsAt, nextStartsAt: new Date("2026-11-25T13:00:00.000Z"),
      clinicorpAppointmentId: "4791226171916288",
    });
  });

  it("remarcada: a leitura vai de ontem até 30 dias depois da última consulta (movida para frente)", async () => {
    rows(local());
    const read = vi.fn(async () => agenda([remote()]));
    await reconcileMirroredAppointments("t1", TZ, AGORA, { read });
    expect(read).toHaveBeenCalledWith("2026-11-23", "2026-12-25");
  });

  it("cancelada no Clinicorp: cancela aqui, com a origem na observação, sem devolver nada ao Clinicorp", async () => {
    rows(local());
    db.appointment.findFirst.mockResolvedValue({ id: "appt-gilberto", leadId: "lead-1", notes: null, googleEventId: "g1", icloudEventUrl: null });
    const read = vi.fn(async () => agenda([remote({ canceled: true })]));
    const result = await reconcileMirroredAppointments("t1", TZ, AGORA, { read });

    expect(result).toMatchObject({ status: "ok", canceled: 1, moved: 0 });
    const update = db.appointment.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe("canceled");
    expect(update.data.notes).toContain("no Clinicorp");
    expect(google.deleteEventFromGoogle).toHaveBeenCalledWith("t1", "g1");
    expect(stage.moveLeadToStage).toHaveBeenCalledWith("t1", "lead-1", "booking_canceled", "system", expect.anything());
  });

  it("ausente do Clinicorp: não altera nada, só aponta para o lembrete não sair (caso da Lucimar)", async () => {
    rows(local({ id: "appt-lucimar", clinicorpAppointmentId: "999" }));
    const read = vi.fn(async () => agenda([remote({ id: "outro" })]));
    const result = await reconcileMirroredAppointments("t1", TZ, AGORA, { read });

    expect(result).toMatchObject({ status: "ok", moved: 0, canceled: 0 });
    expect(result.status === "ok" && result.missing.has("appt-lucimar")).toBe(true);
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("leitura com linha que não deu para posicionar: ausência não vira 'não encontrada'", async () => {
    rows(local({ clinicorpAppointmentId: "999" }));
    const read = vi.fn(async () => agenda([], 1));
    const result = await reconcileMirroredAppointments("t1", TZ, AGORA, { read });
    expect(result.status === "ok" && result.missing.size).toBe(0);
    expect(result.status === "ok" && result.unverified.has("appt-gilberto")).toBe(true);
  });

  it("Clinicorp fora do ar: nada é concluído e ninguém é lembrado com horário não conferido", async () => {
    rows(local());
    const read = vi.fn(async (): Promise<ClinicorpAgenda> => ({ status: "error", error: "timeout" }));
    const result = await reconcileMirroredAppointments("t1", TZ, AGORA, { read });
    expect(result).toEqual({ status: "unavailable", error: "timeout" });
    expect(reminderVerdict(result, "appt-gilberto")).toBe("wait");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("integração desligada: não há o que conferir", async () => {
    rows(local());
    const read = vi.fn(async (): Promise<ClinicorpAgenda> => ({ status: "off" }));
    await expect(reconcileMirroredAppointments("t1", TZ, AGORA, { read })).resolves.toEqual({ status: "idle" });
  });

  it("erro inesperado nunca derruba a varredura", async () => {
    db.appointment.findMany.mockRejectedValue(new Error("banco fora"));
    const result = await reconcileMirroredAppointments("t1", TZ, AGORA, { read: vi.fn() });
    expect(result.status).toBe("unavailable");
  });

  it("a varredura roda a cada minuto, mas o Clinicorp é lido no máximo a cada 4", async () => {
    rows(local());
    const read = vi.fn(async () => agenda([remote()]));
    await reconcileMirroredAppointments("t1", TZ, AGORA, { read });
    await reconcileMirroredAppointments("t1", TZ, new Date(AGORA.getTime() + 60_000), { read });
    expect(read).toHaveBeenCalledTimes(1);
    await reconcileMirroredAppointments("t1", TZ, new Date(AGORA.getTime() + 5 * 60_000), { read });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("o cache é por conta", async () => {
    rows(local());
    const read = vi.fn(async () => agenda([remote()]));
    await reconcileMirroredAppointments("t1", TZ, AGORA, { read });
    await reconcileMirroredAppointments("t2", TZ, AGORA, { read });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
