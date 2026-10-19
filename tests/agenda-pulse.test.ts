import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { findFirst: vi.fn() },
  appointment: { aggregate: vi.fn() },
  reminderDispatch: { aggregate: vi.fn() },
  appointmentReschedule: { aggregate: vi.fn() },
}));
const clinicorp = vi.hoisted(() => ({ listClinicorpAgenda: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/clinicorp", () => clinicorp);

import { agendaVersion, monthDays, readAgendaPulse, warmNeighborMonths } from "@/modules/scheduling/agenda-pulse";
import type { ClinicorpAgenda, ClinicorpAgendaItem } from "@/modules/scheduling/clinicorp";

const item = (id: string, hour: string, patientName = "Paciente"): ClinicorpAgendaItem => ({
  id, patientName, startsAt: new Date(`2026-09-29T${hour}:00Z`), endsAt: null, phone: null, professional: null, notes: null,
});
// `fetchedAt` diferente a cada leitura: a versão não pode depender dele.
const ok = (items: ClinicorpAgendaItem[]): ClinicorpAgenda => ({ status: "ok", items, skipped: 0, fetchedAt: Math.random() });
const local = { count: 2, lastUpdate: new Date("2026-09-28T12:00:00Z") };

beforeEach(() => { vi.clearAllMocks(); db.reminderDispatch.aggregate.mockResolvedValue({ _max: { updatedAt: null } });
  db.appointmentReschedule.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { createdAt: null } }); });

describe("versão da agenda ao vivo", () => {
  it("atualiza o mesmo cartão quando a consulta é cancelada no Clinicorp", () => {
    const original = item("1", "12:00");
    expect(agendaVersion(local, ok([{ ...original, canceled: true }])))
      .not.toBe(agendaVersion(local, ok([original])));
  });
  it("é a mesma para o mesmo conteúdo, em qualquer ordem — senão a tela se refaz em loop", () => {
    expect(agendaVersion(local, ok([item("1", "12:00"), item("2", "12:00")])))
      .toBe(agendaVersion(local, ok([item("2", "12:00"), item("1", "12:00")])));
  });

  it("muda com consulta nova, removida ou alterada no Clinicorp", () => {
    const base = agendaVersion(local, ok([item("1", "12:00")]));
    expect(agendaVersion(local, ok([item("1", "12:00"), item("2", "13:00")]))).not.toBe(base);
    expect(agendaVersion(local, ok([]))).not.toBe(base);
    expect(agendaVersion(local, ok([item("1", "14:00")]))).not.toBe(base);
    expect(agendaVersion(local, ok([item("1", "12:00", "Outro nome")]))).not.toBe(base);
  });

  it("muda com o que o agente marcou ou alterou no fechai", () => {
    const base = agendaVersion(local, ok([]));
    expect(agendaVersion({ ...local, count: 3 }, ok([]))).not.toBe(base);
    expect(agendaVersion({ ...local, lastUpdate: new Date("2026-09-28T12:00:01Z") }, ok([]))).not.toBe(base);
  });

  it("atualiza o mês antigo quando a consulta muda para outro mês", () => {
    const base = { ...local, historyCount: 0, historyUpdate: null };
    expect(agendaVersion({ ...base, historyCount: 1, historyUpdate: local.lastUpdate }, ok([])))
      .not.toBe(agendaVersion(base, ok([])));
  });

  it("muda quando o Clinicorp cai ou volta", () => {
    expect(agendaVersion(local, { status: "error", error: "fora" })).not.toBe(agendaVersion(local, ok([])));
    expect(agendaVersion(local, { status: "off" })).not.toBe(agendaVersion(local, ok([])));
  });
});

describe("pulso da agenda", () => {
  it("relê o Clinicorp de verdade e conta os compromissos do mês pelo mesmo filtro da página", async () => {
    db.agent.findFirst.mockResolvedValue({ actions: [{ config: { timezone: "America/Sao_Paulo" } }] });
    db.appointment.aggregate.mockResolvedValue({ _count: { _all: 2 }, _max: { updatedAt: local.lastUpdate } });
    clinicorp.listClinicorpAgenda.mockResolvedValue(ok([item("1", "12:00")]));

    const pulse = await readAgendaPulse("tenant-1", 2026, 9);

    expect(clinicorp.listClinicorpAgenda).toHaveBeenCalledWith("tenant-1", "2026-09-01", "2026-09-30", "America/Sao_Paulo", { fresh: true });
    expect(db.appointment.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-1", startsAt: { gte: new Date("2026-09-01T03:00:00Z"), lt: new Date("2026-10-01T03:00:00Z") } },
    }));
    expect(pulse.version).toBe(agendaVersion({ ...local, reminderUpdate: null, historyCount: 0, historyUpdate: null }, ok([item("1", "12:00")])));
    expect(db.appointmentReschedule.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-1", appointment: { tenantId: "tenant-1" }, startsAt: { gte: new Date("2026-09-01T03:00:00Z"), lt: new Date("2026-10-01T03:00:00Z") } },
    }));
    expect(pulse.checkedAt).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("aquece o mês anterior e o seguinte, pelo cache (sem forçar releitura), virando o ano", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue(ok([]));
    await warmNeighborMonths("tenant-1", 2026, 12, "America/Sao_Paulo");
    expect(clinicorp.listClinicorpAgenda.mock.calls).toEqual([
      ["tenant-1", "2026-11-01", "2026-11-30", "America/Sao_Paulo"],
      ["tenant-1", "2027-01-01", "2027-01-31", "America/Sao_Paulo"],
    ]);
  });

  it("dá o último dia certo de cada mês", () => {
    expect(monthDays(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthDays(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});
