import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  clinicorpAppointmentSync: { upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  appointment: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  tenantAction: { findUnique: vi.fn() }, lead: { findUnique: vi.fn(), update: vi.fn() },
}));
const api = vi.hoisted(() => ({ push: vi.fn(), lookup: vi.fn(), cancel: vi.fn(), status: vi.fn(), features: vi.fn(), googlePush: vi.fn(), googleDelete: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/features", () => ({ getCalendarFeatures: api.features }));
vi.mock("@/modules/scheduling/clinicorp", () => ({
  pushAppointmentToClinicorp: api.push, lookupClinicorpAppointment: api.lookup,
  cancelAppointmentInClinicorp: api.cancel, getClinicorpStatus: api.status,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: api.googlePush, deleteEventFromGoogle: api.googleDelete }));
const icloud = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: vi.fn(async () => ({ status: "skipped" })), updateIcloudEvent: vi.fn(async () => ({ status: "skipped" })),
  deleteIcloudEvent: icloud.remove, listIcloudBusyBlocks: vi.fn(async () => []), hasIcloudConflict: vi.fn(async () => false),
}));

import { processClinicorpSync, scanClinicorpSync, syncAppointmentToClinicorp } from "@/modules/scheduling/clinicorp-sync";
import { createAppointment } from "@/modules/scheduling/repository";
import type { ClinicorpEventInput } from "@/modules/scheduling/clinicorp";

const NOW = new Date("2026-10-06T15:00Z");
const input: ClinicorpEventInput = {
  title: "Paciente", startsAt: new Date("2026-10-08T17:45Z"), endsAt: new Date("2026-10-08T18:00Z"),
  timeZone: "America/Sao_Paulo", lead: { name: "Paciente", phone: "5511999990000" },
};
const target = { subscriberId: "assinante", businessId: "123", dentistId: "456", categoryDescription: "Avaliação", syncEnabled: true };
let appointment: Record<string, unknown>;
let job: Record<string, unknown> | null;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  job = null;
  appointment = { id: "consulta", tenantId: "conta", status: "scheduled", startsAt: input.startsAt, endsAt: input.endsAt, clinicorpAppointmentId: null, googleEventId: null };
  api.features.mockResolvedValue({ clinicorpEnabled: true }); api.status.mockResolvedValue(target);
  api.push.mockResolvedValue({ status: "synced", appointmentId: "789" });
  api.lookup.mockResolvedValue({ status: "absent" }); api.cancel.mockResolvedValue(true);
  api.googlePush.mockResolvedValue(null); api.googleDelete.mockResolvedValue(true); icloud.remove.mockResolvedValue(true);
  db.lead.findUnique.mockResolvedValue(input.lead); db.lead.update.mockResolvedValue({});
  db.appointment.create.mockImplementation(async () => appointment);
  db.appointment.update.mockImplementation(async ({ data }) => Object.assign(appointment, data));
  db.appointment.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.status && where.status !== appointment.status) return { count: 0 };
    if (where.clinicorpAppointmentId === null && appointment.clinicorpAppointmentId !== null) return { count: 0 };
    Object.assign(appointment, data); return { count: 1 };
  });
  db.clinicorpAppointmentSync.upsert.mockImplementation(async ({ create }) => {
    const saved = job ?? { id: "envio", state: "queued", attempts: 0, nextAttemptAt: NOW, lockedUntil: null, lockToken: null, ...create };
    job = saved;
    return { id: saved.id, tenantId: saved.tenantId };
  });
  db.clinicorpAppointmentSync.findUnique.mockImplementation(async () => job ? { ...job, appointment: { ...appointment } } : null);
  db.clinicorpAppointmentSync.updateMany.mockImplementation(async ({ where, data }) => {
    if (!job || (where.id && where.id !== job.id) || (where.lockToken && where.lockToken !== job.lockToken)) return { count: 0 };
    if (where.state?.in && !where.state.in.includes(job.state)) return { count: 0 };
    if (where.nextAttemptAt && (job.nextAttemptAt as Date) > where.nextAttemptAt.lte) return { count: 0 };
    if (where.OR && job.lockedUntil && (job.lockedUntil as Date) > where.OR[1].lockedUntil.lte) return { count: 0 };
    if (where.appointment?.clinicorpAppointmentId === null && appointment.clinicorpAppointmentId !== null) return { count: 0 };
    const attempts = typeof data.attempts === "object" ? Number(job.attempts) + data.attempts.increment : data.attempts;
    Object.assign(job, data, attempts === undefined ? {} : { attempts }); return { count: 1 };
  });
  db.appointment.findMany.mockResolvedValue([]); db.clinicorpAppointmentSync.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("envio automático durável ao Clinicorp", () => {
  it("cria a consulta pelo fluxo real e persiste o envio antes de chamar a API", async () => {
    api.push.mockImplementation(async () => {
      expect(job).toMatchObject({ state: "processing", appointmentId: "consulta", tenantId: "conta" });
      return { status: "synced", appointmentId: "789" };
    });
    const result = await createAppointment({ tenantId: "conta", leadId: "lead", title: "Paciente", startsAt: input.startsAt, durationMinutes: 15, timezone: input.timeZone, source: "agent" });
    expect(result.clinicorpSync).toEqual({ status: "synced", appointmentId: "789" });
    expect(appointment.clinicorpAppointmentId).toBe("789");
    expect(job).toMatchObject({ state: "synced", externalId: "789", lockToken: null });
  });

  it("recupera falha temporária automaticamente, com a mesma referência e destino", async () => {
    api.push.mockResolvedValueOnce({ status: "failed", error: "Tempo esgotado" });
    expect(await syncAppointmentToClinicorp("conta", "consulta", input)).toMatchObject({ status: "failed", automatic: true });
    expect(job).toMatchObject({ state: "retry", attempts: 1, lockedUntil: null });
    expect(await processClinicorpSync("envio", NOW)).toMatchObject({ automatic: true });
    expect(api.push).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    expect(await processClinicorpSync("envio")).toEqual({ status: "synced", appointmentId: "789" });
    for (const call of api.push.mock.calls) expect(call[1]).toMatchObject({ referenceId: "envio", target: { subscriberId: "assinante", businessId: "123" } });
    expect(job?.attempts).toBe(2);
  });

  it("duas tentativas simultâneas fazem apenas uma chamada externa", async () => {
    let finish!: (value: unknown) => void;
    api.push.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = syncAppointmentToClinicorp("conta", "consulta", input);
    await vi.waitFor(() => expect(api.push).toHaveBeenCalledOnce());
    expect(await processClinicorpSync("envio")).toMatchObject({ automatic: true });
    finish({ status: "synced", appointmentId: "789" }); await first;
    expect(api.push).toHaveBeenCalledOnce();
  });

  it("retoma um processo que morreu depois de expirar o claim", async () => {
    await syncAppointmentToClinicorp("conta", "consulta", input);
    Object.assign(job!, { state: "processing", externalId: null, lockedUntil: new Date(NOW.getTime() - 1), lockToken: "processo-morto" });
    appointment.clinicorpAppointmentId = null;
    expect(await processClinicorpSync("envio")).toMatchObject({ status: "synced" });
    expect(job?.lockToken).toBeNull();
  });

  it("conserva a referência após falha ao gravar o ID para reconciliar no próximo ciclo", async () => {
    db.appointment.updateMany.mockRejectedValueOnce(new Error("Banco indisponível"));
    expect(await syncAppointmentToClinicorp("conta", "consulta", input)).toMatchObject({ automatic: true });
    expect(job?.state).toBe("retry");
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    await processClinicorpSync("envio");
    expect(api.push.mock.calls.map(([, value]) => value.referenceId)).toEqual(["envio", "envio"]);
    expect(appointment.clinicorpAppointmentId).toBe("789");
  });

  it("limpa um envio incerto cancelado sem recriar a consulta", async () => {
    api.push.mockResolvedValueOnce({ status: "failed", error: "Sem resposta" });
    await syncAppointmentToClinicorp("conta", "consulta", input);
    appointment.status = "canceled";
    api.lookup.mockResolvedValue({ status: "found", appointmentId: "789" });
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    expect(await processClinicorpSync("envio")).toEqual({ status: "skipped" });
    expect(api.cancel).toHaveBeenCalledWith("conta", "789", expect.objectContaining({ subscriberId: "assinante" }));
    expect(api.push).toHaveBeenCalledOnce(); expect(job?.state).toBe("canceled");
  });

  it("não cria enquanto a limpeza da versão anterior não foi confirmada", async () => {
    api.push.mockResolvedValueOnce({ status: "failed", error: "Sem resposta" });
    await syncAppointmentToClinicorp("conta", "consulta", input);
    appointment.startsAt = new Date("2026-10-09T17:45Z");
    api.lookup.mockResolvedValue({ status: "unavailable", error: "Offline" });
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    expect(await processClinicorpSync("envio")).toMatchObject({ automatic: true });
    expect(api.push).toHaveBeenCalledOnce(); expect(job?.state).toBe("retry");
  });

  it("uma recusa posterior por conflito libera a reserva e cancela o Google", async () => {
    api.push.mockResolvedValueOnce({ status: "failed", error: "Offline" });
    await syncAppointmentToClinicorp("conta", "consulta", input);
    appointment.googleEventId = "google";
    api.push.mockResolvedValue({ status: "failed", reason: "conflict", error: "Horário ocupado" });
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    expect(await processClinicorpSync("envio")).toMatchObject({ reason: "conflict" });
    expect(appointment.status).toBe("canceled"); expect(job?.state).toBe("conflict");
    expect(api.googleDelete).toHaveBeenCalledWith("conta", "google");
  });

  it("a recusa posterior por conflito também apaga o evento do Calendário da Apple", async () => {
    api.push.mockResolvedValueOnce({ status: "failed", error: "Offline" });
    await syncAppointmentToClinicorp("conta", "consulta", input);
    appointment.icloudEventUrl = "https://p1-caldav.icloud.com/c/fechai-consulta.ics";
    api.push.mockResolvedValue({ status: "failed", reason: "conflict", error: "Horário ocupado" });
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    await processClinicorpSync("envio");
    expect(appointment.status).toBe("canceled");
    expect(icloud.remove).toHaveBeenCalledWith("conta", "https://p1-caldav.icloud.com/c/fechai-consulta.ics", "consulta");
  });

  it("sem endereço gravado ainda pede a remoção (o envio pode ter ido sem ser anotado)", async () => {
    api.push.mockResolvedValueOnce({ status: "failed", error: "Offline" });
    await syncAppointmentToClinicorp("conta", "consulta", input);
    api.push.mockResolvedValue({ status: "failed", reason: "conflict", error: "Horário ocupado" });
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    await processClinicorpSync("envio");
    expect(icloud.remove).toHaveBeenCalledWith("conta", null, "consulta");
  });

  it("consulta que mudou durante o envio (nada cancelado) não apaga o evento", async () => {
    api.push.mockResolvedValueOnce({ status: "failed", error: "Offline" });
    await syncAppointmentToClinicorp("conta", "consulta", input);
    api.push.mockResolvedValue({ status: "failed", reason: "conflict", error: "Horário ocupado" });
    db.appointment.updateMany.mockResolvedValueOnce({ count: 0 });
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    await processClinicorpSync("envio");
    expect(icloud.remove).not.toHaveBeenCalled();
  });

  it("não muda o destino nem os dados de uma tentativa ainda incerta", async () => {
    api.push.mockResolvedValue({ status: "failed", error: "Offline" });
    await syncAppointmentToClinicorp("conta", "consulta", input);
    api.status.mockResolvedValue({ ...target, subscriberId: "outra-conta" });
    await syncAppointmentToClinicorp("conta", "consulta", { ...input, title: "Outro nome" });
    expect(job?.target).toMatchObject({ subscriberId: "assinante" });
    expect(job?.payload).toMatchObject({ title: "Paciente" });
  });

  it("recupera consultas antigas sem envio pelo worker", async () => {
    db.appointment.findMany.mockResolvedValue([{ ...appointment, agentId: "agente", title: "Paciente", lead: input.lead }]);
    db.tenantAction.findUnique.mockResolvedValue({ config: { timezone: "America/Sao_Paulo" } });
    expect(await scanClinicorpSync(NOW)).toMatchObject({ recovered: 1 });
    expect(api.push).toHaveBeenCalledWith("conta", expect.objectContaining({ recoverExisting: true, referenceId: "envio" }));
    expect(appointment.clinicorpAppointmentId).toBe("789");
  });

  it("permite enviar a versão nova após reagendamento com versão anterior encerrada", async () => {
    await syncAppointmentToClinicorp("conta", "consulta", input);
    appointment.clinicorpAppointmentId = null;
    appointment.startsAt = new Date("2026-10-09T17:45Z"); appointment.endsAt = new Date("2026-10-09T18:00Z");
    await syncAppointmentToClinicorp("conta", "consulta", { ...input, startsAt: appointment.startsAt as Date, endsAt: appointment.endsAt as Date });
    expect(api.push).toHaveBeenLastCalledWith("conta", expect.objectContaining({ startsAt: appointment.startsAt }));
    expect(job?.state).toBe("synced");
  });

  it("falha de persistência não promete que existe recuperação automática", async () => {
    db.clinicorpAppointmentSync.upsert.mockRejectedValue(new Error("Banco fora"));
    expect(await syncAppointmentToClinicorp("conta", "consulta", input)).toMatchObject({ status: "failed" });
    expect(api.push).not.toHaveBeenCalled(); expect(job).toBeNull();
  });

  it("integração desligada não enfileira nem envia", async () => {
    api.features.mockResolvedValue({ clinicorpEnabled: false });
    expect(await syncAppointmentToClinicorp("conta", "consulta", input)).toEqual({ status: "skipped" });
    expect(db.clinicorpAppointmentSync.upsert).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
  });
});
