import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regras do agente por campanha — os critérios de aceite da spec:
 *
 * 2. Com a regra de datas 18–19/11, um lead pedindo dia 20 não é agendado; o
 *    agente recebe as opções 18 ou 19 e a chegada às 09h00.
 * 3. Agendar fora da regra pelo backend (`createAppointment`) é recusado.
 * 4. Lembretes desligados: nenhum lembrete sai para o lead da campanha.
 * 5. Depois do fim, o lead volta às opções normais da agenda.
 * 6. Lead fora da campanha nunca é afetado (os testes de agenda existentes
 *    rodam com `campaignLead` vazio e seguem iguais).
 */

const db = vi.hoisted(() => ({
  campaignLead: { findMany: vi.fn(), updateMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  $transaction: vi.fn(),
  appointmentReschedule: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  tenantAction: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  conversation: { update: vi.fn(), updateMany: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  agent: { findFirst: vi.fn() },
}));
const mirrors = vi.hoisted(() => ({
  googlePush: vi.fn(),
  clinicorpPush: vi.fn(),
  clinicorpConflict: vi.fn(),
  clinicorpBusy: vi.fn(),
  clinicorpPending: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: async () => ({ status: "skipped" }),
  updateIcloudEvent: async () => ({ status: "skipped" }),
  deleteIcloudEvent: async () => true,
  listIcloudBusyBlocks: async () => [],
  hasIcloudConflict: async () => false,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: mirrors.googlePush, deleteEventFromGoogle: vi.fn() }));
vi.mock("@/modules/scheduling/clinicorp", () => ({
  pushAppointmentToClinicorp: mirrors.clinicorpPush,
  cancelAppointmentInClinicorp: vi.fn(),
  hasClinicorpConflict: mirrors.clinicorpConflict,
  listClinicorpBusyBlocks: mirrors.clinicorpBusy,
  clinicorpConfirmationPending: mirrors.clinicorpPending,
}));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({
  syncAppointmentToClinicorp: (tenantId: string, _id: string, input: unknown) => mirrors.clinicorpPush(tenantId, input),
}));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: vi.fn(),
}));

import { runToolHandler, type ToolContext } from "@/modules/agent-engine/tools";
import { findLeadCampaign, inRulesWindow, pickCampaign } from "@/modules/campaigns/active";
import { campaignAgentFor } from "@/modules/campaigns/agent-routing";
import { messageHasKeyword } from "@/modules/campaigns/attribution";
import {
  campaignRulesPrompt,
  campaignSlotProblem,
  hasSpecialRules,
  parseCampaignRules,
  parseTimeList,
} from "@/modules/campaigns/rules";
import { CampaignRuleError } from "@/modules/campaigns/slots";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { createAppointment } from "@/modules/scheduling/repository";
import { remindersFor } from "../workers/follow-up-worker/reminders";

/** Instituto do Sorriso: implantes em 18 e 19/11/2026, todos às 09:00. */
const SORRISO = {
  dates: ["2026-11-18", "2026-11-19"],
  times: ["09:00"],
  arrival: "chegar às 09h00",
  reminders: "off",
  offer: "Avaliação de implante sem custo no evento.",
  instructions: "Não oferecer outras datas.",
  outside: "handoff",
};

const ctx = { tenantId: "conta-1", leadId: "lead-1", agentId: "agente-1", conversationId: "conversa-1" };
const cfg = parseScheduleConfig({});

/** O vínculo do lead com a campanha, como `findLeadCampaign` lê do banco. */
function campaignLink(rules: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    assignedAt: new Date("2026-11-10T12:00:00Z"),
    sentAssetIds: [],
    campaign: {
      id: "camp-1",
      name: "Implantes Nov/26",
      objective: "Agendar avaliações do evento",
      description: null,
      timezone: "America/Sao_Paulo",
      startsAt: new Date("2026-11-01T03:00:00Z"),
      endsAt: new Date("2026-11-20T02:59:59Z"),
      rules,
      assets: [],
      ...over,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  db.tenantAction.findFirst.mockResolvedValue({ config: cfg });
  db.campaignLead.findMany.mockResolvedValue([campaignLink(SORRISO)]);
  db.campaignOverride.findMany.mockResolvedValue([]);
  db.campaignLead.updateMany.mockResolvedValue({ count: 1 });
  db.appointment.findFirst.mockResolvedValue(null);
  db.appointment.findMany.mockResolvedValue([]);
  db.appointment.count.mockResolvedValue(0);
  db.appointment.create.mockResolvedValue({ id: "consulta-nova" });
  db.appointment.update.mockResolvedValue({});
  db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999" });
  db.lead.update.mockResolvedValue({});
  mirrors.googlePush.mockResolvedValue(null);
  mirrors.clinicorpPush.mockResolvedValue({ status: "skipped" });
  mirrors.clinicorpConflict.mockResolvedValue(false);
  mirrors.clinicorpBusy.mockResolvedValue([]);
  mirrors.clinicorpPending.mockResolvedValue(false);
});
afterEach(() => vi.useRealTimers());

describe("regras — leitura e validação (puro)", () => {
  it("lê lixo sem lançar e cai no padrão (atendimento normal)", () => {
    for (const raw of [null, undefined, "x", 42, [], { dates: "2026-11-18", times: 9 }]) {
      const rules = parseCampaignRules(raw);
      expect(rules.dates).toEqual([]);
      expect(rules.reminders).toBe("default");
      expect(hasSpecialRules(rules)).toBe(false);
    }
  });

  it("normaliza horários, descarta data inexistente e limita a extensão a 30 dias", () => {
    const rules = parseCampaignRules({ dates: ["2026-11-19", "2026-02-30", "2026-11-18"], times: ["9h", "9:00", "14h30", "25:00"], graceDays: 99 });
    expect(rules.dates).toEqual(["2026-11-18", "2026-11-19"]);
    expect(rules.times).toEqual(["09:00", "14:30"]);
    expect(rules.graceDays).toBe(30);
    expect(parseTimeList("9:00, 9h30 14h")).toEqual(["09:00", "09:30", "14:00"]);
  });

  it("lembretes personalizados sem nenhum lembrete válido viram desligados (nunca o padrão)", () => {
    expect(parseCampaignRules({ reminders: "custom", customReminders: [] }).reminders).toBe("off");
    expect(parseCampaignRules({ reminders: "custom", customReminders: [{ minutesBefore: 1440, template: "Oi" }] }).customReminders).toEqual([
      { minutesBefore: 1440, template: "Oi" },
    ]);
  });

  it("dia 20 é recusado com as opções da campanha; 18 às 08:00 também; 18 às 09:00 passa", () => {
    const rules = parseCampaignRules(SORRISO);
    expect(campaignSlotProblem(rules, "2026-11-20", "09:00")).toMatch(/Fora das datas.*18\/11\/2026 às 09:00; 19\/11\/2026 às 09:00/);
    expect(campaignSlotProblem(rules, "2026-11-18", "08:00")).toMatch(/Fora dos horários/);
    expect(campaignSlotProblem(rules, "2026-11-18", "09:00")).toBeNull();
    // Sem restrição de agenda, nada é recusado.
    expect(campaignSlotProblem(parseCampaignRules({ offer: "x" }), "2030-01-01", "23:00")).toBeNull();
  });

  it("o prompt traz só as opções da campanha, a chegada e o que fazer fora da regra", () => {
    const rules = parseCampaignRules(SORRISO);
    const withHandoff = campaignRulesPrompt({ name: "Implantes", objective: null, description: null }, rules, { handoffAvailable: true, assets: [] });
    expect(withHandoff).toContain("SOMENTE estas opções — 18/11/2026 às 09:00; 19/11/2026 às 09:00");
    expect(withHandoff).toContain("chegar às 09h00");
    expect(withHandoff).toContain("não há lembretes automáticos");
    expect(withHandoff).toContain("handoff_human");
    const withoutHandoff = campaignRulesPrompt({ name: "Implantes", objective: null, description: null }, rules, { handoffAvailable: false, assets: [] });
    expect(withoutHandoff).not.toContain("handoff_human");
    expect(withoutHandoff).toContain("a equipe vai entrar em contato");
  });
});

describe("vigência — fim sem cron e extensão para quem agendou", () => {
  const campaign = { startsAt: new Date("2026-11-01T03:00:00Z"), endsAt: new Date("2026-11-20T02:59:59Z"), rules: { graceDays: 3 } };

  it("vale do início ao fim; antes e depois, não", () => {
    expect(inRulesWindow(campaign, new Date("2026-10-31T12:00:00Z"), true)).toBe(false);
    expect(inRulesWindow(campaign, new Date("2026-11-15T12:00:00Z"), false)).toBe(true);
    expect(inRulesWindow({ ...campaign, rules: null }, new Date("2026-11-21T12:00:00Z"), true)).toBe(false);
  });

  it("a extensão só vale para quem tem consulta marcada", () => {
    expect(inRulesWindow(campaign, new Date("2026-11-21T12:00:00Z"), true)).toBe(true);
    expect(inRulesWindow(campaign, new Date("2026-11-21T12:00:00Z"), false)).toBe(false);
    expect(inRulesWindow(campaign, new Date("2026-11-24T12:00:00Z"), true)).toBe(false);
  });

  it("com várias campanhas em vigor, vale a de atribuição mais recente", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const older = { assignedAt: new Date("2026-11-02T00:00:00Z"), campaign: { id: "a", ...campaign } };
    const newer = { assignedAt: new Date("2026-11-10T00:00:00Z"), campaign: { id: "b", ...campaign } };
    const ended = { assignedAt: new Date("2026-11-12T00:00:00Z"), campaign: { id: "c", ...campaign, endsAt: new Date("2026-11-05T00:00:00Z"), rules: null } };
    expect(pickCampaign([older, ended, newer], now, () => false)?.campaign.id).toBe("b");
  });
});

describe("lembretes da campanha", () => {
  const account = { reminderEnabled: true, reminders: [{ minutesBefore: 1440, template: "Amanhã" }] };

  it("desligados: nada sai; personalizados: os da campanha; sem campanha: os da conta", () => {
    expect(remindersFor({ reminderOverride: null }, account, parseCampaignRules({ reminders: "off" }))).toEqual([]);
    expect(
      remindersFor({ reminderOverride: null }, account, parseCampaignRules({ reminders: "custom", customReminders: [{ minutesBefore: 120, template: "Daqui a pouco" }] })),
    ).toEqual([{ minutesBefore: 120, template: "Daqui a pouco" }]);
    expect(remindersFor({ reminderOverride: null }, account, undefined)).toEqual(account.reminders);
  });

  it("o lembrete escolhido para a consulta vence a campanha (escolha explícita da equipe)", () => {
    const own = [{ minutesBefore: 60, template: "Em 1 hora" }];
    expect(remindersFor({ reminderOverride: own }, account, parseCampaignRules({ reminders: "off" }))).toEqual(own);
  });
});

describe("palavra-chave da campanha", () => {
  it("ignora caixa e acento, e casa só a palavra inteira", () => {
    expect(messageHasKeyword("Oi! Quero saber do IMPLÂNTE, por favor", "implante")).toBe(true);
    expect(messageHasKeyword("evento implante amanhã", "Evento Implante")).toBe(true);
    expect(messageHasKeyword("implantes dentários", "implante")).toBe(false);
  });
});

describe("agenda do lead da campanha — a trava do backend", () => {
  const schedule = (date: string, time: string) =>
    runToolHandler("schedule_meeting", { ...ctx } as ToolContext, { date, time, patientName: "Paciente" });

  it("lead pede dia 20: não agenda e o agente recebe as opções e a chegada", async () => {
    const reply = await schedule("2026-11-20", "09:00");
    expect(reply).toContain("Horário recusado pela regra da campanha");
    expect(reply).toContain("18/11/2026 às 09:00; 19/11/2026 às 09:00");
    expect(reply).toContain("chegar às 09h00");
    expect(reply).toContain("transfira para um atendente");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("18 às 09:00 é agendado", async () => {
    const reply = await schedule("2026-11-18", "09:00");
    expect(reply).toContain("Agendado para");
    expect(db.appointment.create).toHaveBeenCalledOnce();
  });

  it("vaga de evento: várias pessoas no mesmo horário até lotar, sem olhar conflito de agenda", async () => {
    db.campaignLead.findMany.mockResolvedValue([campaignLink({ ...SORRISO, capacity: 2 })]);
    db.appointment.count.mockResolvedValue(1);
    expect(await schedule("2026-11-18", "09:00")).toContain("Agendado para");
    expect(mirrors.clinicorpConflict).not.toHaveBeenCalled();

    db.appointment.create.mockClear();
    db.appointment.count.mockResolvedValue(2);
    expect(await schedule("2026-11-18", "09:00")).toMatch(/esgotadas/);
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("list_available_slots só mostra as vagas da campanha", async () => {
    db.campaignLead.findMany.mockResolvedValue([campaignLink({ ...SORRISO, capacity: 10 })]);
    const reply = await runToolHandler("list_available_slots", { ...ctx } as ToolContext, { date: "2026-11-14" });
    expect(reply).toContain('Vagas da campanha "Implantes Nov/26"');
    expect(reply).toContain("18/11/2026 (2026-11-18): 09:00 (10 vagas)");
    expect(reply).toContain("19/11/2026 (2026-11-19): 09:00 (10 vagas)");
  });

  it("createAppointment recusa o horário fora da regra mesmo sem passar pela ferramenta do agente", async () => {
    await expect(
      createAppointment({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        leadId: ctx.leadId,
        title: "Paciente",
        startsAt: new Date("2026-11-20T12:00:00Z"),
        durationMinutes: 30,
        source: "agent",
        timezone: "America/Sao_Paulo",
      }),
    ).rejects.toBeInstanceOf(CampaignRuleError);
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("depois do fim da campanha o lead volta à agenda normal", async () => {
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    const reply = await schedule("2026-11-26", "10:00");
    expect(reply).not.toContain("regra da campanha");
    expect(reply).toContain("Agendado para");
  });

  it("campanha pausada não está em vigor (o banco já filtra; a regra não chega ao turno)", async () => {
    db.campaignLead.findMany.mockResolvedValue([]);
    expect(await schedule("2026-11-20", "10:00")).toContain("Agendado para");
  });
});

describe("agente da campanha", () => {
  it("atende o lead da campanha só se existir, estiver ligado e não arquivado", async () => {
    db.campaignLead.findMany.mockResolvedValue([campaignLink(SORRISO, { agentId: "paula-implantes", baseAgentId: "paula" })]);
    const campaign = await findLeadCampaign(ctx.tenantId, ctx.leadId);
    db.agent.findFirst.mockResolvedValue({ id: "paula-implantes" });
    expect(await campaignAgentFor(ctx.tenantId, campaign)).toBe("paula-implantes");
    expect(db.agent.findFirst).toHaveBeenCalledWith({
      where: { id: "paula-implantes", tenantId: ctx.tenantId, archived: false, enabled: true },
      select: { id: true },
    });
    // Cópia desligada ou apagada: o lead segue com o agente de sempre.
    db.agent.findFirst.mockResolvedValue(null);
    expect(await campaignAgentFor(ctx.tenantId, campaign)).toBeNull();
  });

  it("sem campanha em vigor, ou campanha sem agente, não troca ninguém", async () => {
    expect(await campaignAgentFor(ctx.tenantId, null)).toBeNull();
    db.campaignLead.findMany.mockResolvedValue([campaignLink(SORRISO, { agentId: null })]);
    expect(await campaignAgentFor(ctx.tenantId, await findLeadCampaign(ctx.tenantId, ctx.leadId))).toBeNull();
    expect(db.agent.findFirst).not.toHaveBeenCalled();
  });

  it("depois do fim a campanha não é devolvida, e o agente dela deixa de atender", async () => {
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    db.campaignLead.findMany.mockResolvedValue([campaignLink(SORRISO, { agentId: "paula-implantes" })]);
    expect(await campaignAgentFor(ctx.tenantId, await findLeadCampaign(ctx.tenantId, ctx.leadId))).toBeNull();
  });
});
