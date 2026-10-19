import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const db = vi.hoisted(() => ({ appointment: { findMany: vi.fn() }, appointmentReschedule: { findMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { listMonthAppointments, listMonthAppointmentReschedules } from "@/modules/scheduling/repository";
import { AppointmentRescheduleItem } from "../src/app/(dashboard)/agenda/AppointmentRescheduleItem";

beforeEach(() => vi.clearAllMocks());

it("consultas canceladas continuam na data original na leitura da agenda", async () => {
  const canceled = { id: "consulta-1", status: "canceled", startsAt: new Date("2026-09-30T17:00:00Z") };
  db.appointment.findMany.mockResolvedValue([canceled]);
  const month = await listMonthAppointments("conta-1", 2026, 9, "America/Sao_Paulo");
  expect(month.byDay.get("2026-09-30")).toEqual([canceled]);
  expect(db.appointment.findMany.mock.calls[0][0].where).not.toHaveProperty("status");
});

it("busca histórico pelo horário antigo, sem depender do mês da consulta atual e com escopo de conta", async () => {
  db.appointmentReschedule.findMany.mockResolvedValue([]);
  await listMonthAppointmentReschedules("conta-1", 2026, 9, "America/Sao_Paulo");
  expect(db.appointmentReschedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    tenantId: "conta-1", appointment: { tenantId: "conta-1" },
    startsAt: { gte: new Date("2026-09-01T03:00:00Z"), lt: new Date("2026-10-01T03:00:00Z") },
  } }));
});

it("mostra o horário original e a nova data, sem oferecer envio, confirmação ou cancelamento", () => {
  const history = {
    id: "historico-1", startsAt: new Date("2026-09-30T17:00:00Z"), endsAt: new Date("2026-09-30T17:30:00Z"),
    nextStartsAt: new Date("2026-10-02T18:00:00Z"), createdAt: new Date("2026-09-29T12:00:00Z"),
    notes: "Observação original", appointment: { patientName: "Paciente de teste", title: "Avaliação", lead: null },
  } as Parameters<typeof AppointmentRescheduleItem>[0]["history"];
  const html = renderToStaticMarkup(createElement(AppointmentRescheduleItem, { history, timezone: "America/Sao_Paulo" }));
  expect(html).toContain("Remarcado");
  expect(html).toContain("14:00");
  expect(html).toContain("15:00");
  expect(html).toContain("Observação original");
  expect(html).toContain("ano=2026&amp;mes=10&amp;dia=02");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<form");
});
