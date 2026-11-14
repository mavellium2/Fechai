import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CMP-03 — follow-up desligado por campanha: o scan pula o lead da campanha em
 * vigor SEM marcar a etapa, volta a enviar depois do fim, e quem não é de
 * campanha segue igual. Prisma simulado, sem banco.
 */

const db = vi.hoisted(() => ({
  tenantAction: { findMany: vi.fn() },
  conversation: { findMany: vi.fn(), update: vi.fn() },
  campaignLead: { findMany: vi.fn() },
  appointment: { findMany: vi.fn() },
  message: { create: vi.fn() },
}));
const send = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/modules/campaign-override/agent", () => ({
  loadOverrideReminderRules: async () => new Map(),
  overrideAsLeadCampaign: async () => null,
}));
vi.mock("../src/modules/reports/contact-context-events", () => ({ recordMessageContext: vi.fn() }));
vi.mock("../src/modules/whatsapp/blocklist", () => ({ isPhoneBlocked: async () => false }));
vi.mock("../src/modules/whatsapp/instances", () => ({
  agentRepliesOn: () => true,
  findWhatsappChannel: async () => ({ externalId: "inst" }),
}));
vi.mock("../src/modules/whatsapp/meta-config", () => ({
  getWhatsAppProviderForInstance: () => ({ isConfigured: () => true, sendMessage: send.sendMessage }),
}));

import { scanAndSendFollowUps } from "../workers/follow-up-worker/scan";

const NOW = new Date("2026-11-14T15:00:00Z");

function convo(leadId: string) {
  return {
    id: `conv-${leadId}`,
    tenantId: "conta-1",
    agentId: "agente-1",
    leadId,
    needsHuman: false,
    agentPaused: false,
    lastInboundAt: new Date("2026-11-14T14:00:00Z"),
    followUpSentAt: null,
    followUpStep: 0,
    followUpReason: null,
    whatsappProvider: "evolution",
    variables: null,
    agent: { systemPrompt: null, enabled: true },
    lead: { phone: "5511999999999", name: "Paciente", appointments: [] },
    messages: [{ role: "assistant", createdAt: new Date("2026-11-14T14:01:00Z"), sentBy: "agent" }],
    satisfactionSurveys: [],
  };
}

function campaignLink(leadId: string, over: { endsAt?: Date; followUp?: boolean } = {}) {
  return {
    leadId,
    assignedAt: new Date("2026-11-10T12:00:00Z"),
    campaign: {
      id: "camp-1",
      startsAt: new Date("2026-11-01T03:00:00Z"),
      endsAt: over.endsAt ?? new Date("2026-11-20T02:59:59Z"),
      rules: { followUp: over.followUp ?? false },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.tenantAction.findMany.mockImplementation(async (args: { where: { key: string } }) =>
    args.where.key === "follow_up"
      ? [{ tenantId: "conta-1", agentId: "agente-1", config: { noReply: { enabled: true, steps: [{ delayMinutes: 30, message: "Oi, sumiu?" }] } } }]
      : [],
  );
  db.conversation.findMany.mockResolvedValue([convo("lead-campanha"), convo("lead-comum")]);
  db.conversation.update.mockResolvedValue({});
  db.appointment.findMany.mockResolvedValue([]);
  db.message.create.mockResolvedValue({ id: "m1" });
  send.sendMessage.mockResolvedValue("key-1");
  db.campaignLead.findMany.mockResolvedValue([campaignLink("lead-campanha")]);
});

// 14:01 + 30 min = 14:31; "agora" às 15:00 (UTC-3 = 12:00, dentro da janela padrão).
describe("follow-up por campanha", () => {
  it("pula o lead da campanha em vigor, sem marcar a etapa, e envia ao lead comum", async () => {
    const result = await scanAndSendFollowUps(NOW);
    expect(result.sent).toBe(1);
    expect(send.sendMessage).toHaveBeenCalledOnce();
    expect(db.conversation.update).toHaveBeenCalledOnce();
    expect(db.conversation.update.mock.calls[0][0].where.id).toBe("conv-lead-comum");
  });

  it("depois do fim da campanha o lead volta a receber", async () => {
    db.campaignLead.findMany.mockResolvedValue([campaignLink("lead-campanha", { endsAt: new Date("2026-11-14T10:00:00Z") })]);
    const result = await scanAndSendFollowUps(NOW);
    expect(result.sent).toBe(2);
  });

  it("campanha com follow-up ligado não muda nada", async () => {
    db.campaignLead.findMany.mockResolvedValue([campaignLink("lead-campanha", { followUp: true })]);
    expect((await scanAndSendFollowUps(NOW)).sent).toBe(2);
  });

  it("sem conseguir ler as campanhas, a volta não envia", async () => {
    db.campaignLead.findMany.mockRejectedValue(new Error("banco fora"));
    const result = await scanAndSendFollowUps(NOW);
    expect(result.sent).toBe(0);
    expect(send.sendMessage).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });
});
