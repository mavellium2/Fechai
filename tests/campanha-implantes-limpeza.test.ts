import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-03 — script das consultas que já existiam: grava `reminderOverride = []` e passa os
 * `ReminderDispatch` em `queued` para `skipped` ("campanha implantes"). Simula por padrão,
 * exige `--actor` para gravar e a auditoria leva só contagens. Prisma simulado, sem banco.
 */

type Appt = { id: string; leadId: string | null; clinicorpAppointmentId: string | null; reminderOverride: unknown };

const db = vi.hoisted(() => ({
  appointment: { findMany: vi.fn(), updateMany: vi.fn() },
  reminderDispatch: { count: vi.fn(), updateMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  leadAdOrigin: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: audit.recordAudit }));

import { AUDIT_EVENTS } from "@/modules/audit/events";
import { CLEARED_REASON, clearCampaignReminders } from "@/modules/campaign-override/clear-reminders";

const TENANT = "t1";
const NOW = new Date("2026-11-13T15:00:00Z");
const appts = (): Appt[] => [
  { id: "a1", leadId: "lead-1", clinicorpAppointmentId: null, reminderOverride: null },
  { id: "a2", leadId: "lead-2", clinicorpAppointmentId: "9001", reminderOverride: [{ minutesBefore: 60, template: "x" }] },
  { id: "a3", leadId: "lead-3", clinicorpAppointmentId: null, reminderOverride: [] },
  { id: "a4", leadId: "lead-9", clinicorpAppointmentId: null, reminderOverride: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.campaignOverride.findMany.mockResolvedValue([
    {
      id: "o1", key: "implantes-2026-11", adCodes: [], adSourceIds: [], broadcastCampaignIds: [], leadIds: ["lead-1", "lead-2", "lead-3"],
      startsAt: new Date("2026-11-10T00:00:00Z"), endsAt: new Date("2026-11-20T02:59:59Z"),
      rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00" },
    },
  ]);
  db.leadAdOrigin.findMany.mockResolvedValue([]);
  db.appointment.findMany.mockResolvedValue(appts());
  db.appointment.updateMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length }));
  db.reminderDispatch.count.mockResolvedValue(4);
  db.reminderDispatch.updateMany.mockResolvedValue({ count: 4 });
  db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "dono" ? { id: "dono", email: "dono@clinica.test", role: "OWNER", tenantId: TENANT }
      : where.id === "outro" ? { id: "outro", email: "outro@outra.test", role: "OWNER", tenantId: "t2" } : null,
  );
});

describe("clearCampaignReminders", () => {
  it("simula por padrão: conta, não grava e não audita", async () => {
    const result = await clearCampaignReminders({ tenantId: TENANT, now: NOW });
    // 3 consultas de leads da campanha; a3 já era `[]`, então 2 mudariam.
    expect(result).toEqual({ matched: 3, appointments: 2, dispatches: 4, applied: false });
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(db.reminderDispatch.updateMany).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("--apply sem --actor é recusado antes de qualquer leitura ou escrita", async () => {
    await expect(clearCampaignReminders({ tenantId: TENANT, apply: true, now: NOW })).rejects.toThrow("--actor");
    expect(db.appointment.findMany).not.toHaveBeenCalled();
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("--actor de outra conta é recusado e nada é gravado", async () => {
    await expect(clearCampaignReminders({ tenantId: TENANT, apply: true, actorId: "outro", now: NOW })).rejects.toThrow("--actor");
    await expect(clearCampaignReminders({ tenantId: TENANT, apply: true, actorId: "fantasma", now: NOW })).rejects.toThrow("--actor");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(db.reminderDispatch.updateMany).not.toHaveBeenCalled();
  });

  it("grava `[]` só nas consultas da campanha e passa os queued desses leads para skipped", async () => {
    const result = await clearCampaignReminders({ tenantId: TENANT, apply: true, actorId: "dono", now: NOW });
    expect(result).toEqual({ matched: 3, appointments: 2, dispatches: 4, applied: true });

    const [update] = db.appointment.updateMany.mock.calls[0] as [{ where: { tenantId: string; id: { in: string[] } }; data: { reminderOverride: unknown } }];
    expect(update.where.tenantId).toBe(TENANT);
    expect(update.where.id.in).toEqual(["a1", "a2"]);
    expect(update.data).toEqual({ reminderOverride: [] });

    const [skip] = db.reminderDispatch.updateMany.mock.calls[0] as [{ where: { tenantId: string; state: string; sourceKey: { in: string[] } }; data: unknown }];
    expect(skip.where.state).toBe("queued");
    expect(skip.where.tenantId).toBe(TENANT);
    // Chave da consulta do fechai e, quando espelhada, a do Clinicorp. Nunca a de quem não é da campanha.
    expect(skip.where.sourceKey.in).toEqual(expect.arrayContaining(["appointment:a1", "appointment:a2", "clinicorp:9001", "appointment:a3"]));
    expect(skip.where.sourceKey.in).not.toContain("appointment:a4");
    expect(skip.data).toEqual({ state: "skipped", reason: "campanha implantes" });
    expect(CLEARED_REASON).toBe("campanha implantes");
  });

  it("a auditoria leva só contagens, sem dado pessoal nem id de lead", async () => {
    await clearCampaignReminders({ tenantId: TENANT, apply: true, actorId: "dono", now: NOW });
    expect(audit.recordAudit).toHaveBeenCalledOnce();
    const [call] = audit.recordAudit.mock.calls[0] as unknown as [{ event: string; meta: Record<string, unknown>; target: { type: string; id: string }; actor: { id: string } }];
    expect(call.event).toBe("campaign_override.reminders_cleared");
    expect(call.meta).toEqual({ appointments: 2, dispatches: 4 });
    expect(call.target).toEqual({ type: "CampaignOverride", id: TENANT });
    expect(call.actor.id).toBe("dono");
    const serialized = JSON.stringify(call.meta) + JSON.stringify(call.target);
    expect(serialized).not.toMatch(/lead-|@|a1|9001/);
  });

  it("o evento existe no catálogo de auditoria, no grupo campanhas e não é revertível", () => {
    const def = AUDIT_EVENTS["campaign_override.reminders_cleared" as keyof typeof AUDIT_EVENTS] as { group: string; revertible?: boolean };
    expect(def).toBeTruthy();
    expect(def.group).toBe("campanhas");
    expect(def.revertible).toBeFalsy();
  });

  it("sem consulta futura não grava nada", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    expect(await clearCampaignReminders({ tenantId: TENANT, apply: true, actorId: "dono", now: NOW })).toEqual({
      matched: 0, appointments: 0, dispatches: 0, applied: true,
    });
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("falha ao ler a regra não vira 'nenhuma consulta da campanha'", async () => {
    db.campaignOverride.findMany.mockRejectedValue(new Error("banco fora do ar"));
    await expect(clearCampaignReminders({ tenantId: TENANT, apply: true, actorId: "dono", now: NOW })).rejects.toThrow("banco fora do ar");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});
