import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  icloudCalendarIntegration: { findMany: vi.fn() },
  appointment: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  lead: { findFirst: vi.fn() },
}));
const icloud = vi.hoisted(() => ({ push: vi.fn(), remove: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: icloud.push, deleteIcloudEvent: icloud.remove, scheduleContextFor: icloud.context,
}));

import { backoffMinutes, scanIcloudSync } from "@/modules/scheduling/icloud-sync";

const NOW = new Date("2026-10-06T15:00:00Z");
const URL_OF = (id: string) => `https://p1-caldav.icloud.com/c/fechai-${id}.ics`;
const appt = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "scheduled", startsAt: new Date("2026-10-08T17:00:00Z"), endsAt: new Date("2026-10-08T18:00:00Z"),
  icloudEventUrl: null, icloudSyncAttempts: 0, title: "Consulta", patientName: "Maria", procedure: "Implante",
  notes: null, agentId: "ag1", leadId: "l1", ...extra,
});
let rows: Record<string, ReturnType<typeof appt>>;
let logged: string;

beforeEach(() => {
  vi.resetAllMocks();
  logged = "";
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged += a.map(String).join(" "); });
  rows = {};
  db.icloudCalendarIntegration.findMany.mockResolvedValue([{ tenantId: "t1" }]);
  db.appointment.findMany.mockResolvedValue([]);
  db.appointment.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null);
  db.appointment.updateMany.mockResolvedValue({ count: 1 });
  db.lead.findFirst.mockResolvedValue({ phone: "5511999990000", isTest: false });
  icloud.context.mockResolvedValue({ timeZone: "America/Sao_Paulo", location: "Rua A" });
  icloud.remove.mockResolvedValue(true);
  icloud.push.mockImplementation(async (_t: string, input: { appointmentId: string }) => ({ status: "synced", url: URL_OF(input.appointmentId) }));
});

const due = (...ids: string[]) => {
  for (const id of ids) rows[id] = appt(id);
  db.appointment.findMany.mockResolvedValue(ids.map((id) => ({ id })));
};

describe("quem entra na varredura", () => {
  it("só contas habilitadas, com envio ligado, calendário escolhido e sem senha revogada nem calendário com erro", async () => {
    await scanIcloudSync(NOW);
    expect(db.icloudCalendarIntegration.findMany.mock.calls[0][0].where).toEqual({
      syncEnabled: true, calendarUrl: { not: null }, authFailedAt: null, connectionError: null,
      tenant: { status: "active", calendarFeatures: { icloudEnabled: true } },
    });
  });

  it("só consultas futuras, marcadas, sem endereço, fora do período de graça e com recuo vencido; da mais próxima à mais distante", async () => {
    await scanIcloudSync(NOW);
    const q = db.appointment.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({
      tenantId: "t1", status: "scheduled", startsAt: { gt: NOW }, icloudEventUrl: null,
      createdAt: { lt: new Date(NOW.getTime() - 2 * 60_000) },
      OR: [{ icloudNextAttemptAt: null }, { icloudNextAttemptAt: { lte: NOW } }],
    });
    expect(q.orderBy).toEqual({ startsAt: "asc" });
    expect(q.take).toBe(10);
  });

  it("no máximo 50 por rodada, 10 por conta", async () => {
    db.icloudCalendarIntegration.findMany.mockResolvedValue(["a", "b", "c", "d", "e", "f", "g"].map((tenantId) => ({ tenantId })));
    db.appointment.findMany.mockImplementation(async ({ where, take }: { where: { tenantId: string }; take: number }) =>
      Array.from({ length: take }, (_, i) => { const id = `${where.tenantId}${i}`; rows[id] = appt(id); return { id }; }));
    const result = await scanIcloudSync(NOW);
    expect(result.sent).toBe(50);
    expect(icloud.push).toHaveBeenCalledTimes(50);
    expect(db.appointment.findMany.mock.calls.map((c) => c[0].take)).toEqual([10, 10, 10, 10, 10]);
  });
});

describe("enviar", () => {
  it("envia com o contexto da agenda e liga o endereço só se a consulta continua igual", async () => {
    due("a1");
    const result = await scanIcloudSync(NOW);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(icloud.push).toHaveBeenCalledWith("t1", expect.objectContaining({
      appointmentId: "a1", patientName: "Maria", procedure: "Implante", phone: "5511999990000", location: "Rua A", timeZone: "America/Sao_Paulo",
    }));
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: "a1", tenantId: "t1", status: "scheduled", startsAt: rows.a1.startsAt, endsAt: rows.a1.endsAt, icloudEventUrl: null },
      data: { icloudEventUrl: URL_OF("a1"), icloudSyncAttempts: 0, icloudNextAttemptAt: null },
    });
  });

  it("lead de teste vai sem telefone", async () => {
    due("a1");
    db.lead.findFirst.mockResolvedValue({ phone: "5511999990000", isTest: true });
    await scanIcloudSync(NOW);
    expect(icloud.push).toHaveBeenCalledWith("t1", expect.objectContaining({ phone: null, isTest: true }));
  });

  it("relê antes de enviar: cancelada, já enviada ou já passada não vai", async () => {
    due("cancelada", "enviada", "passada");
    rows.cancelada = appt("cancelada", { status: "canceled" });
    rows.enviada = appt("enviada", { icloudEventUrl: URL_OF("enviada") });
    rows.passada = appt("passada", { startsAt: new Date("2026-10-06T14:00:00Z") });
    await scanIcloudSync(NOW);
    expect(icloud.push).not.toHaveBeenCalled();
  });

  it("cancelou durante o envio: apaga o evento recém-criado", async () => {
    due("a1");
    db.appointment.updateMany.mockResolvedValue({ count: 0 });
    db.appointment.findFirst.mockResolvedValueOnce(rows.a1).mockResolvedValueOnce({ status: "canceled" });
    const result = await scanIcloudSync(NOW);
    expect(icloud.remove).toHaveBeenCalledWith("t1", URL_OF("a1"), "a1");
    expect(result.sent).toBe(0);
  });

  it("remarcou durante o envio: não apaga nem liga o endereço antigo (a próxima rodada reenvia)", async () => {
    due("a1");
    db.appointment.updateMany.mockResolvedValue({ count: 0 });
    db.appointment.findFirst.mockResolvedValueOnce(rows.a1).mockResolvedValueOnce({ status: "scheduled" });
    await scanIcloudSync(NOW);
    expect(icloud.remove).not.toHaveBeenCalled();
  });
});

describe("falhas", () => {
  it("5xx/timeout: recuo de 2, 4, 8… minutos até 60, sem desistir", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMinutes)).toEqual([2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it("falha temporária grava a tentativa e o próximo horário, e segue com as outras consultas", async () => {
    due("a1", "a2");
    rows.a1 = appt("a1", { icloudSyncAttempts: 2 });
    icloud.push.mockResolvedValueOnce({ status: "failed", reason: "transient" });
    const result = await scanIcloudSync(NOW);
    expect(result).toMatchObject({ sent: 1, failed: 1 });
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: "a1", tenantId: "t1", icloudEventUrl: null },
      data: { icloudSyncAttempts: 3, icloudNextAttemptAt: new Date(NOW.getTime() + 8 * 60_000) },
    });
  });

  it("recusa de uma consulta (4xx) também recua, sem travar as outras", async () => {
    due("a1", "a2");
    icloud.push.mockResolvedValueOnce({ status: "failed", reason: "rejected" });
    expect(await scanIcloudSync(NOW)).toMatchObject({ sent: 1, failed: 1 });
  });

  it("senha revogada: para a conta, conta como revogada e não tenta as demais", async () => {
    due("a1", "a2", "a3");
    icloud.push.mockResolvedValueOnce({ status: "failed", reason: "auth" });
    const result = await scanIcloudSync(NOW);
    expect(result).toMatchObject({ revoked: 1, sent: 0 });
    expect(icloud.push).toHaveBeenCalledTimes(1);
  });

  it("calendário sumido, ou integração que mudou no meio: para a conta", async () => {
    due("a1", "a2");
    icloud.push.mockResolvedValueOnce({ status: "failed", reason: "calendar" });
    await scanIcloudSync(NOW);
    expect(icloud.push).toHaveBeenCalledTimes(1);
    icloud.push.mockClear();
    icloud.push.mockResolvedValueOnce({ status: "skipped" });
    await scanIcloudSync(NOW);
    expect(icloud.push).toHaveBeenCalledTimes(1);
  });

  it("uma conta com senha revogada não impede as outras", async () => {
    db.icloudCalendarIntegration.findMany.mockResolvedValue([{ tenantId: "t1" }, { tenantId: "t2" }]);
    db.appointment.findMany.mockImplementation(async ({ where }: { where: { tenantId: string } }) => {
      const id = `${where.tenantId}-a`; rows[id] = appt(id); return [{ id }];
    });
    icloud.push.mockResolvedValueOnce({ status: "failed", reason: "auth" });
    const result = await scanIcloudSync(NOW);
    expect(result).toMatchObject({ revoked: 1, sent: 1, tenants: 2 });
  });

  it("nunca lança: banco caindo no meio, push explodindo", async () => {
    db.icloudCalendarIntegration.findMany.mockRejectedValue(new Error("db"));
    await expect(scanIcloudSync(NOW)).resolves.toMatchObject({ sent: 0 });
    db.icloudCalendarIntegration.findMany.mockResolvedValue([{ tenantId: "t1" }]);
    due("a1");
    icloud.push.mockRejectedValue(new Error("boom"));
    await expect(scanIcloudSync(NOW)).resolves.toMatchObject({ failed: 1 });
    expect(logged).not.toContain("Maria");
  });
});
