import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
  agent: { findFirst: vi.fn() },
}));
const recovery = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "tenant-1" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/modules/agent-engine/recover-pending", () => ({ recoverPendingAgentReply: recovery.run }));

import { setConversationAgentPaused } from "@/app/(dashboard)/conversas/actions";

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  db.conversation.findFirst.mockResolvedValue({ agent: null });
  db.agent.findFirst.mockResolvedValue({ id: "agente-ativo" });
  recovery.run.mockResolvedValue({ status: "none" });
});

it("reativa uma conversa órfã no agente ativo padrão", async () => {
  const result = await setConversationAgentPaused("conversa-1", false);

  expect(result.ok).toBe(true);
  expect(db.agent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { tenantId: "tenant-1", enabled: true, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  }));
  expect(db.conversation.updateMany).toHaveBeenCalledWith({
    where: { id: "conversa-1", tenantId: "tenant-1" },
    data: { agentId: "agente-ativo", agentPaused: false, needsHuman: false, assignedUserId: null, assignedAt: null },
  });
  expect(recovery.run).toHaveBeenCalledWith("tenant-1", "conversa-1", "agente-ativo");
});

it("faz o agente responder à mensagem pendente ao reativar", async () => {
  recovery.run.mockResolvedValue({ status: "sent" });

  const result = await setConversationAgentPaused("conversa-1", false);

  expect(result).toEqual({ ok: true, info: "Agente reativado e resposta enviada à mensagem pendente." });
});

it("mantém o agente atribuído quando ele ainda está ativo", async () => {
  db.conversation.findFirst.mockResolvedValue({
    agent: { id: "agente-atual", enabled: true, archived: false },
  });

  await setConversationAgentPaused("conversa-1", false);

  expect(db.agent.findFirst).not.toHaveBeenCalled();
  expect(db.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: { agentId: "agente-atual", agentPaused: false, needsHuman: false, assignedUserId: null, assignedAt: null },
  }));
});

it("não promete reativação se não houver agente ativo", async () => {
  db.agent.findFirst.mockResolvedValue(null);

  const result = await setConversationAgentPaused("conversa-1", false);

  expect(result.ok).toBe(false);
  expect(db.conversation.updateMany).not.toHaveBeenCalled();
});
