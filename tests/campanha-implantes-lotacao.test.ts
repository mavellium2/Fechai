import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-02 — vagas por DIA (`rules.capacityPerDay`) no lugar do conflito de horário.
 * Esgotado um dia, oferece o outro; esgotados os dois (ou sem limite definido),
 * transfere para a equipe pelo transbordo de sempre. Prisma simulado, sem banco.
 */

type Row = { id: string; tenantId: string; leadId: string; startsAt: Date; status: string };

const db = vi.hoisted(() => ({
  campaignLead: { findMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  tenantAction: { findFirst: vi.fn(), findUnique: vi.fn() },
  conversation: { update: vi.fn(), updateMany: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  leadAdOrigin: { findMany: vi.fn() },
  state: { rows: [] as unknown[], inTransaction: false, queue: Promise.resolve() as Promise<unknown> },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: async () => ({ status: "skipped" }), updateIcloudEvent: async () => ({ status: "skipped" }),
  deleteIcloudEvent: async () => true, listIcloudBusyBlocks: async () => [], hasIcloudConflict: async () => false,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: vi.fn(async () => null), deleteEventFromGoogle: vi.fn(async () => true) }));
vi.mock("@/modules/scheduling/clinicorp", () => ({
  pushAppointmentToClinicorp: vi.fn(), cancelAppointmentInClinicorp: vi.fn(async () => true),
  hasClinicorpConflict: vi.fn(async () => false), listClinicorpBusyBlocks: vi.fn(async () => []), clinicorpConfirmationPending: vi.fn(async () => false),
}));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({ syncAppointmentToClinicorp: vi.fn(async () => ({ status: "skipped" })) }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: vi.fn(),
}));

import { runToolHandler, type ToolContext } from "@/modules/agent-engine/tools";
import { OverrideSlotFullError } from "@/modules/campaign-override/slot-lock";
import { CampaignRuleError } from "@/modules/campaigns/slots";
import { createAppointment } from "@/modules/scheduling/repository";

const TENANT = "conta-1";
const LEADS = ["lead-1", "lead-2", "lead-3"];
const ctxOf = (leadId: string, dryRun = false) =>
  ({ tenantId: TENANT, leadId, agentId: "agente-1", conversationId: `conversa-${leadId}`, ...(dryRun ? { dryRun } : {}) }) as ToolContext;
const schedule = (leadId: string, date: string, time = "09:00") =>
  runToolHandler("schedule_meeting", ctxOf(leadId), { date, time, patientName: "Paciente" });
const needsHumanMarked = () =>
  db.conversation.updateMany.mock.calls.some(([arg]) => (arg as { data: { needsHuman?: boolean } }).data.needsHuman === true);

function setRules(rules: Record<string, unknown>) {
  const row = {
    id: "o1", key: "implantes-2026-11", adCodes: [], adSourceIds: [], broadcastCampaignIds: [], leadIds: LEADS,
    startsAt: new Date("2026-11-10T00:00:00Z"), endsAt: new Date("2026-11-20T02:59:59Z"),
    rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00", ...rules },
  };
  db.campaignOverride.findMany.mockResolvedValue([row]);
}
const booked = (startsAtIso: string, count: number, leadPrefix = "outro") => {
  for (let i = 0; i < count; i++) {
    (db.state.rows as Row[]).push({ id: `${leadPrefix}-${i}`, tenantId: TENANT, leadId: `${leadPrefix}-${i}`, startsAt: new Date(startsAtIso), status: "scheduled" });
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  db.state.rows = [];
  db.state.inTransaction = false;
  db.state.queue = Promise.resolve();
  setRules({ capacityPerDay: 2 });
  db.campaignLead.findMany.mockResolvedValue([]);
  db.leadAdOrigin.findMany.mockResolvedValue([]);
  db.tenantAction.findFirst.mockResolvedValue({ config: {} });
  db.tenantAction.findUnique.mockResolvedValue({ config: {} });
  db.appointment.findFirst.mockResolvedValue(null);
  db.appointment.findMany.mockResolvedValue([]);
  db.appointment.update.mockResolvedValue({});
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999", isTest: false });
  db.lead.update.mockResolvedValue({});
  db.$executeRaw.mockResolvedValue(1);
  db.appointment.count.mockImplementation(async ({ where }: { where: { startsAt: Date; id?: { not: string } } }) =>
    (db.state.rows as Row[]).filter((r) => r.startsAt.getTime() === where.startsAt.getTime() && r.id !== where.id?.not).length,
  );
  db.appointment.create.mockImplementation(async ({ data }: { data: { leadId: string; startsAt: Date; tenantId: string } }) => {
    const row = { id: `criada-${db.state.rows.length}`, tenantId: data.tenantId, leadId: data.leadId, startsAt: data.startsAt, status: "scheduled" };
    db.state.rows.push(row);
    return row;
  });
  // Transação em série, como o advisory lock: a seguinte só começa quando a anterior termina.
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => {
    const run = db.state.queue.then(async () => {
      db.state.inTransaction = true;
      try { return await work(db); } finally { db.state.inTransaction = false; }
    });
    db.state.queue = run.catch(() => undefined);
    return run;
  });
});
afterEach(() => vi.useRealTimers());

describe("vagas por dia", () => {
  it("aceita até o limite do dia; o seguinte, sem vaga em 18/11, recebe 19/11", async () => {
    expect(await schedule("lead-1", "2026-11-18")).toContain("Agendado para");
    expect(await schedule("lead-2", "2026-11-18")).toContain("Agendado para");

    const third = await schedule("lead-3", "2026-11-18");
    expect(third).toMatch(/esgotadas/);
    // Esgotado um dia, oferece o outro (sem transferir: ainda há vaga).
    expect(third).toContain("19/11/2026 (2026-11-19): 09:00 (2 vagas)");
    expect(needsHumanMarked()).toBe(false);

    expect(await schedule("lead-3", "2026-11-19")).toContain("Agendado para");
    expect((db.state.rows as Row[]).map((r) => r.startsAt.toISOString())).toEqual([
      "2026-11-18T12:00:00.000Z", "2026-11-18T12:00:00.000Z", "2026-11-19T12:00:00.000Z",
    ]);
  });

  it("list_available_slots mostra as vagas que sobram em cada dia", async () => {
    booked("2026-11-18T12:00:00Z", 1);
    const reply = await runToolHandler("list_available_slots", ctxOf("lead-1"), { date: "2026-11-18" });
    expect(reply).toContain("18/11/2026 (2026-11-18): 09:00 (1 vaga)");
    expect(reply).toContain("19/11/2026 (2026-11-19): 09:00 (2 vagas)");
  });

  it("dois dias esgotados: não agenda e transfere a conversa para a equipe", async () => {
    booked("2026-11-18T12:00:00Z", 2);
    booked("2026-11-19T12:00:00Z", 2, "outro-b");
    const reply = await schedule("lead-1", "2026-11-18");
    expect(reply).toMatch(/esgotadas/);
    expect(reply).toContain("Nenhuma vaga livre");
    expect(reply).toContain("transfira para um atendente");
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(needsHumanMarked()).toBe(true);
  });

  it("dois dias esgotados em list_available_slots também transfere (e a simulação não transfere)", async () => {
    booked("2026-11-18T12:00:00Z", 2);
    booked("2026-11-19T12:00:00Z", 2, "outro-b");
    const dry = await runToolHandler("list_available_slots", ctxOf("lead-1", true), { date: "2026-11-18" });
    expect(dry).toContain("Nenhuma vaga livre");
    expect(needsHumanMarked()).toBe(false);

    await runToolHandler("list_available_slots", ctxOf("lead-1"), { date: "2026-11-18" });
    expect(needsHumanMarked()).toBe(true);
  });

  it("sem capacityPerDay: recusa marcar e transfere (lado seguro), nunca aceita sem limite", async () => {
    setRules({});
    const reply = await schedule("lead-1", "2026-11-18");
    expect(reply).toMatch(/esgotadas/);
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(needsHumanMarked()).toBe(true);
  });
});

describe("corrida entre duas marcações", () => {
  const create = (leadId: string) =>
    createAppointment({
      tenantId: TENANT, agentId: "agente-1", leadId, title: "Paciente",
      startsAt: new Date("2026-11-18T12:00:00Z"), durationMinutes: 30, source: "agent", timezone: "America/Sao_Paulo",
    });

  it("duas criações concorrentes não passam do limite: a segunda perde a vaga sob o lock", async () => {
    setRules({ capacityPerDay: 1 });
    const results = await Promise.allSettled([create("lead-1"), create("lead-2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(OverrideSlotFullError);
    expect(lost.reason).toBeInstanceOf(CampaignRuleError);
    expect(db.state.rows).toHaveLength(1);
    // Cada criação travou o horário (conta + instante) dentro da transação.
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    const sql = (db.$executeRaw.mock.calls[0][0] as string[]).join("");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(db.$executeRaw.mock.calls[0][1]).toBe(`${TENANT}|2026-11-18T12:00:00.000Z`);
  });

  it("quem perde a corrida pela tool recebe a recusa e o outro dia, sem erro", async () => {
    setRules({ capacityPerDay: 1 });
    const [first, second] = await Promise.all([schedule("lead-1", "2026-11-18"), schedule("lead-2", "2026-11-18")]);
    const replies = [first, second];
    expect(replies.filter((r) => r.includes("Agendado para"))).toHaveLength(1);
    const lost = replies.find((r) => !r.includes("Agendado para")) as string;
    expect(lost).toMatch(/esgotadas/);
    expect(lost).toContain("19/11/2026 (2026-11-19): 09:00 (1 vaga)");
  });
});
