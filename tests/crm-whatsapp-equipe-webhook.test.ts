import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "@/modules/whatsapp/provider";

const mocks = vi.hoisted(() => ({
  incoming: null as IncomingMessage | null,
  instanceFindFirst: vi.fn(),
  messageFindUnique: vi.fn(),
  getOrCreateConversation: vi.fn(),
  handleTeamLinkCommand: vi.fn(),
  learnTeamMemberLid: vi.fn(),
  runAgentTurn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappInstance: { findFirst: mocks.instanceFindFirst },
    message: { findUnique: mocks.messageFindUnique, findFirst: vi.fn() },
    conversation: { update: vi.fn() },
    lead: { findFirst: vi.fn() },
    // CRM-08: o grupo destes testes não é o de transbordo.
    handoffNotice: { findFirst: vi.fn(async () => null) },
    tenantAction: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: () => ({ name: "evolution", parseWebhook: () => mocks.incoming }),
}));
vi.mock("@/modules/whatsapp/blocklist", () => ({ isPhoneBlocked: vi.fn(async () => false) }));
vi.mock("@/modules/agent-engine/conversation", () => ({
  appendMessage: vi.fn(),
  getOrCreateConversation: mocks.getOrCreateConversation,
}));
vi.mock("@/modules/agent-engine/orchestrator", () => ({ runAgentTurn: mocks.runAgentTurn, resolveAgent: vi.fn() }));
vi.mock("@/modules/agent-engine/handoff", () => ({ notifyHandoffGroup: vi.fn() }));
vi.mock("@/modules/crm/team-whatsapp-command", () => ({ handleTeamLinkCommand: mocks.handleTeamLinkCommand }));
vi.mock("@/modules/crm/team-whatsapp", () => ({ learnTeamMemberLid: mocks.learnTeamMemberLid }));
vi.mock("@/modules/ai/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/modules/voice/reply", () => ({ speakReply: vi.fn() }));

import { POST } from "@/app/api/webhooks/whatsapp/route";

const GROUP: IncomingMessage = {
  instanceExternalId: "instancia-1",
  fromPhone: "120363012345678901",
  text: "#vincular 123456",
  isGroup: true,
  hasAudio: false,
  messageKeyId: "grupo-1",
  groupSender: { phone: "5511987654321", lid: "98765432109876" },
};

const request = () => new Request("https://fechai.test/api/webhooks/whatsapp", {
  method: "POST", headers: { "x-webhook-secret": "segredo-teste" }, body: "{}",
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_WEBHOOK_SECRET = "segredo-teste";
  mocks.instanceFindFirst.mockResolvedValue({ tenantId: "tenant-1", tenant: { whatsappIgnoreGroups: true } });
  mocks.messageFindUnique.mockResolvedValue(null);
});

describe("#vincular chega pelo webhook", () => {
  it("é lido no grupo mesmo com 'ignorar grupos' ligado e nunca abre conversa", async () => {
    mocks.incoming = { ...GROUP };
    mocks.handleTeamLinkCommand.mockResolvedValue({ handled: true });
    const res = await POST(request());
    expect(await res.json()).toMatchObject({ silent: "whatsapp da equipe" });
    expect(mocks.handleTeamLinkCommand).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", incoming: GROUP }));
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("mensagem de grupo comum ensina o LID e continua ignorada pela regra da conta", async () => {
    mocks.incoming = { ...GROUP, text: "bom dia, equipe" };
    mocks.handleTeamLinkCommand.mockResolvedValue({ handled: false });
    const res = await POST(request());
    expect(await res.json()).toMatchObject({ ignored: "grupo" });
    expect(mocks.learnTeamMemberLid).toHaveBeenCalledWith("tenant-1", "5511987654321", "98765432109876");
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
  });
});
