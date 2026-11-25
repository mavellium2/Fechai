import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmResult } from "@/modules/ai/types";
import * as agentTools from "@/modules/agent-engine/tools";

/**
 * Testes da regra "agente desligado ainda responde no chat de teste".
 *
 * A chave geral (`Agent.enabled`) cala o agente PARA O CLIENTE — WhatsApp e
 * widget do site. O chat de teste é o dono falando com o próprio agente, e é
 * justamente com ele desligado que se ajusta persona e base antes de religar:
 * um sandbox mudo obrigava a religar (voltando a atender cliente de verdade)
 * só para conferir a mudança.
 *
 * O que está protegido aqui são as duas metades da regra, porque cada uma
 * sozinha é um estrago:
 *
 * - sem o `skipEnabledCheck`, o sandbox volta a ser mudo e o botão de desligar
 *   vira um botão de "não mexer mais neste agente";
 * - sem o gate no caminho normal, desligar não desliga nada e o cliente segue
 *   recebendo resposta automática de um agente que o dono calou.
 */

const db = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn() },
  $transaction: vi.fn(),
  message: { findFirst: vi.fn() },
  conversation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(async () => ({ variables: {}, lead: { name: null, phone: "sandbox:test" } })),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({})),
  },
  agent: { findFirst: vi.fn() },
  tenantAction: { findMany: vi.fn(async () => []) },
}));
const usage = vi.hoisted(() => ({ getUsageSummary: vi.fn(async () => ({ atLimit: false })) }));
const conversation = vi.hoisted(() => ({
  appendMessage: vi.fn(async () => ({ id: "msg-1" })),
  getRecentMessages: vi.fn(async () => []),
}));
/** O LLM não deve ser alcançado quando o gate barra o turno. */
const ai = vi.hoisted(() => ({
  complete: vi.fn(async (): Promise<LlmResult> => ({ content: "oi, tudo bem?", toolCalls: [] })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/billing/usage", () => ({ getUsageSummary: usage.getUsageSummary }));
vi.mock("@/modules/agent-engine/conversation", () => conversation);
vi.mock("@/modules/knowledge-base/embeddings", () => ({ embedQuery: vi.fn(async () => null) }));
vi.mock("@/modules/knowledge-base/repository", () => ({
  searchSimilarChunks: vi.fn(async () => []),
}));
vi.mock("@/modules/ai/usage", () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock("@/modules/ai", () => ({
  isAiError: () => false,
  createProvider: () => ({ provider: "fake", model: "fake-1", complete: ai.complete }),
  getUsableChain: async () => [
    { model: { provider: "fake", id: "fake-1" }, credentialId: null, credentialLabel: null },
  ],
  resolveSecret: async () => "chave-de-teste",
  markCredentialOk: vi.fn(),
  markCredentialCooldown: vi.fn(),
  getCooldownMinutes: () => 5,
}));

import { runAgentTurn } from "@/modules/agent-engine/orchestrator";

const TENANT = "tenant-1";
const CONVERSA = "conversa-1";
const LEAD = "lead-1";

/** Agente da conta, desligado salvo indicação contrária. */
function agente(enabled = false) {
  db.agent.findFirst.mockResolvedValue({
    id: "agente-1",
    systemPrompt: "Você atende a clínica.",
    enabled,
    listenAudio: true,
    stopOnEmoji: true,
    speakReplies: false,
    voiceId: null,
    voiceStyle: "neutra",
    speechBlocklist: "",
  });
}

function turno(over: Parameters<typeof runAgentTurn>[0] extends infer T ? Partial<T> : never = {}) {
  return runAgentTurn({
    tenantId: TENANT,
    conversationId: CONVERSA,
    leadId: LEAD,
    userMessage: "oi",
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.tenant.findUnique.mockResolvedValue({ crmEnabled: false, status: "active" });
  db.conversation.findUnique.mockResolvedValue({ agentPaused: false });
  db.conversation.update.mockResolvedValue({});
  db.conversation.updateMany.mockResolvedValue({});
  db.tenantAction.findMany.mockResolvedValue([]);
  usage.getUsageSummary.mockResolvedValue({ atLimit: false });
  conversation.appendMessage.mockResolvedValue({ id: "msg-1" });
  conversation.getRecentMessages.mockResolvedValue([]);
  db.message.findFirst.mockResolvedValue({ content: "oi" });
});

it("mantém a resposta da IA quando a transação do CRM falha", async () => {
  agente(true);
  db.tenant.findUnique.mockResolvedValue({ crmEnabled: true, status: "active" });
  db.$transaction.mockRejectedValueOnce(new Error("CRM temporariamente indisponível"));

  await expect(turno()).resolves.toMatchObject({ status: "ok", reply: "oi, tudo bem?" });
  expect(db.$transaction).toHaveBeenCalledOnce();
});

it("retoma mensagem existente sem registrar uma segunda fala do contato", async () => {
  agente(true);

  const result = await turno({ existingUserMessageId: "entrada-1" });

  expect(result.status).toBe("ok");
  expect(db.message.findFirst).toHaveBeenCalledWith({
    where: { id: "entrada-1", conversationId: CONVERSA, role: "user" },
    select: { content: true },
  });
  expect(conversation.appendMessage).not.toHaveBeenCalledWith(CONVERSA, "user", "oi");
});

it("oferece alternativas verificadas sem deixar a IA confirmar antes da nova escolha", async () => {
  agente(true);
  const schemas = vi.spyOn(agentTools, "getToolSchemas").mockReturnValue([
    { name: "schedule_meeting", description: "Agendar", parameters: { type: "object", properties: {} } },
  ]);
  const handler = vi.spyOn(agentTools, "runToolHandler").mockImplementation(async (_key, ctx) => {
    ctx.replyOverride = "Esse horário está ocupado. Tenho sexta às 15:00 ou 16:00. Qual fica melhor?";
    return "Conflito no Clinicorp";
  });
  try {
    ai.complete.mockResolvedValueOnce({ content: "Confirmado!", toolCalls: [
      { id: "call-1", name: "schedule_meeting", arguments: {} },
      { id: "call-2", name: "schedule_meeting", arguments: {} },
    ] });
    const result = await turno();
    expect(result.reply).toBe("Esse horário está ocupado. Tenho sexta às 15:00 ou 16:00. Qual fica melhor?");
    expect(handler).toHaveBeenCalledOnce();
    expect(ai.complete).toHaveBeenCalledOnce();
    expect(conversation.appendMessage).toHaveBeenLastCalledWith(CONVERSA, "assistant", result.reply, "agent");
  } finally {
    schemas.mockRestore();
    handler.mockRestore();
  }
});

describe("agente desligado", () => {
  it("marca a conversa sem agente e não chama a IA", async () => {
    db.agent.findFirst.mockResolvedValue(null);

    const r = await turno({ agentId: "agente-removido" });

    expect(r.status).toBe("no_agent");
    expect(db.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { needsHuman: true } }),
    );
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("cala o agente no caminho do cliente (WhatsApp, widget)", async () => {
    agente(false);

    const r = await turno();

    expect(r.status).toBe("agent_off");
    expect(r.reply).toBe("");
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("marca a conversa como 'precisa de você' ao calar o cliente", async () => {
    agente(false);

    await turno();

    // Sem essa marcação a mensagem recebida some no meio da lista, sem sinal
    // nenhum de que ninguém respondeu.
    expect(db.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { needsHuman: true } }),
    );
  });

  it("registra a mensagem do contato mesmo calado", async () => {
    agente(false);

    await turno();

    expect(conversation.appendMessage).toHaveBeenCalledWith(CONVERSA, "user", "oi");
  });

  it("responde no chat de teste (skipEnabledCheck)", async () => {
    agente(false);

    const r = await turno({ skipEnabledCheck: true, skipUsageCheck: true });

    expect(r.status).toBe("ok");
    expect(r.reply).toBe("oi, tudo bem?");
    expect(ai.complete).toHaveBeenCalled();
  });

  it("não marca 'precisa de você' quando quem falou foi o chat de teste", async () => {
    agente(false);

    await turno({ skipEnabledCheck: true, skipUsageCheck: true });

    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("o teste não passa por cima das outras pausas: humano no comando segue calando", async () => {
    agente(false);
    db.conversation.findUnique.mockResolvedValue({ agentPaused: true });

    const r = await turno({ skipEnabledCheck: true, skipUsageCheck: true });

    expect(r.status).toBe("human_handling");
    expect(ai.complete).not.toHaveBeenCalled();
  });
});
