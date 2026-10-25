import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LlmResult } from "@/modules/ai/types";

/**
 * Parte B do MCP: escopo `simulate`, `run_simulation` e `get_simulation`.
 *
 * Duas camadas no mesmo arquivo:
 * - o turno (`runAgentTurn`) é simulado, para provar o que a ferramenta passa a
 *   ele (travas, conversa de teste, máscara, limite, isolamento);
 * - o turno é o REAL, com LLM de mentira e a agenda, os espelhos e o WhatsApp
 *   vigiados, para provar que simular `schedule_meeting` não grava nem envia nada.
 */

const mocks = vi.hoisted(() => ({
  tokenFindUnique: vi.fn(),
  tokenUpdate: vi.fn(),
  agentFindFirst: vi.fn(),
  leadFindFirst: vi.fn(),
  leadCreate: vi.fn(),
  leadUpdate: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationFindUnique: vi.fn(),
  conversationUpdate: vi.fn(),
  conversationUpdateMany: vi.fn(),
  messageCreate: vi.fn(),
  messageFindMany: vi.fn(),
  tenantActionFindMany: vi.fn(),
  tenantActionFindFirst: vi.fn(),
  tenantActionFindUnique: vi.fn(),
  appointmentFindFirst: vi.fn(),
  appointmentFindMany: vi.fn(),
  appointmentCreate: vi.fn(),
  appointmentUpdate: vi.fn(),
  rate: vi.fn(),
  reserve: vi.fn(),
  runTurn: vi.fn(),
  complete: vi.fn(),
  createAppointment: vi.fn(),
  clinicorpSync: vi.fn(),
  googlePush: vi.fn(),
  icloudPush: vi.fn(),
  whatsappProvider: vi.fn(),
  sendMessage: vi.fn(),
  sendAudio: vi.fn(),
  notifyHandoffGroup: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpToken: { findUnique: mocks.tokenFindUnique, update: mocks.tokenUpdate },
    agent: { findFirst: mocks.agentFindFirst },
    lead: { findFirst: mocks.leadFindFirst, create: mocks.leadCreate, update: mocks.leadUpdate },
    conversation: {
      findFirst: mocks.conversationFindFirst,
      findUnique: mocks.conversationFindUnique,
      update: mocks.conversationUpdate,
      updateMany: mocks.conversationUpdateMany,
    },
    message: { create: mocks.messageCreate, findMany: mocks.messageFindMany },
    tenantAction: {
      findMany: mocks.tenantActionFindMany,
      findFirst: mocks.tenantActionFindFirst,
      findUnique: mocks.tenantActionFindUnique,
    },
    appointment: {
      findFirst: mocks.appointmentFindFirst,
      findMany: mocks.appointmentFindMany,
      create: mocks.appointmentCreate,
      update: mocks.appointmentUpdate,
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rate, rateLimitReserve: mocks.reserve }));
// A auditoria puxa a sessão (next-auth), que não é o assunto aqui.
vi.mock("@/modules/audit/log", () => ({ recordAudit: vi.fn(async () => {}), recordChange: vi.fn(async () => {}) }));
vi.mock("@/lib/app-url", () => ({ appBaseUrl: vi.fn(async () => "https://fechai.test") }));

// O turno: o real por padrão (camada 2), trocado por um controlável na camada 1.
vi.mock("@/modules/agent-engine/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/agent-engine/orchestrator")>();
  mocks.runTurn.mockImplementation(actual.runAgentTurn);
  return { ...actual, runAgentTurn: mocks.runTurn };
});

// LLM de mentira (camada 2).
vi.mock("@/modules/billing/usage", () => ({ getUsageSummary: vi.fn(async () => ({ atLimit: true })) }));
vi.mock("@/modules/knowledge-base/embeddings", () => ({ embedQuery: vi.fn(async () => null) }));
vi.mock("@/modules/knowledge-base/repository", () => ({ searchSimilarChunks: vi.fn(async () => []) }));
vi.mock("@/modules/ai/usage", () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock("@/modules/ai", () => ({
  isAiError: () => false,
  createProvider: () => ({ provider: "fake", model: "fake-1", complete: mocks.complete }),
  getUsableChain: async () => [{ model: { provider: "fake", id: "fake-1" }, credentialId: null, credentialLabel: null }],
  resolveSecret: async () => "chave-de-teste",
  markCredentialOk: vi.fn(),
  markCredentialCooldown: vi.fn(),
  getCooldownMinutes: () => 5,
}));

// Tudo que grava na agenda ou fala com o mundo de fora é vigiado.
vi.mock("@/modules/scheduling/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/scheduling/repository")>()),
  createAppointment: mocks.createAppointment,
}));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({ syncAppointmentToClinicorp: mocks.clinicorpSync }));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: mocks.googlePush, deleteEventFromGoogle: vi.fn() }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: mocks.icloudPush,
  updateIcloudEvent: vi.fn(),
  deleteIcloudEvent: vi.fn(),
  listIcloudBusyBlocks: vi.fn(async () => []),
  hasIcloudConflict: vi.fn(async () => false),
}));
vi.mock("@/modules/scheduling/clinicorp", () => ({
  pushAppointmentToClinicorp: vi.fn(),
  cancelAppointmentInClinicorp: vi.fn(),
  hasClinicorpConflict: vi.fn(async () => false),
  listClinicorpBusyBlocks: vi.fn(async () => []),
  clinicorpConfirmationPending: vi.fn(async () => false),
}));
vi.mock("@/modules/whatsapp/meta-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/whatsapp/meta-config")>()),
  getWhatsAppProviderForInstance: mocks.whatsappProvider,
}));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: mocks.notifyHandoffGroup,
}));

import { POST } from "@/app/api/mcp/route";
import { MAX_SIMULATION_TURNS, SIMULATION_LIMIT, SIMULATION_PHONE_PREFIX } from "@/modules/agent-mcp/simulate";
import { EMITTABLE_MCP_SCOPES, validateIssueInput } from "@/modules/agent-mcp/tokens";

const ROOT = path.resolve(__dirname, "..");
const TOKEN = `fch_mcp_${"B".repeat(43)}`;
const FUTURE = new Date(Date.now() + 86_400_000);

// Corpo JSON-RPC cru: os testes navegam por ele livremente.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcBody = Record<string, any>;

function tokenRow(scopes: string[], tenantId = "tenant-A") {
  return { id: "tok-sim", tenantId, scopes, expiresAt: FUTURE, revokedAt: null, tenant: { status: "active" } };
}
function call(body: unknown) {
  return POST(
    new Request("https://fechai.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    }),
  );
}
const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, params });
const toolCall = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
async function json(response: Response): Promise<RpcBody> {
  return (await response.json()) as RpcBody;
}
/** Resultado de uma ferramenta que respondeu com sucesso. */
function output(body: RpcBody): RpcBody {
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  expect(body.result.isError).toBe(false);
  return JSON.parse(body.result.content[0].text) as RpcBody;
}

const AGENT_A = "agent-A";
const AGENT_B = "agent-B"; // da conta B

let tenantRows: Record<string, { agents: string[] }>;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));

  tenantRows = { "tenant-A": { agents: [AGENT_A] }, "tenant-B": { agents: [AGENT_B] } };
  mocks.rate.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.reserve.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.tokenFindUnique.mockResolvedValue(tokenRow(["simulate"]));
  mocks.tokenUpdate.mockResolvedValue({});

  // O banco de mentira só devolve o agente se o filtro bater com o dono dele.
  mocks.agentFindFirst.mockImplementation(async ({ where }: { where: { id: string; tenantId: string } }) =>
    tenantRows[where.tenantId]?.agents.includes(where.id)
      ? {
          id: where.id,
          systemPrompt: "Você atende a clínica Sol.",
          enabled: false, // desligado de propósito: a simulação responde mesmo assim
          listenAudio: false,
          stopOnEmoji: false,
          speakReplies: false,
          voiceId: null,
          voiceStyle: "neutra",
          voicePrompt: "",
          speechBlocklist: "",
          variableDefinitions: [],
        }
      : null,
  );

  // Conversa nova a cada simulação.
  mocks.leadFindFirst.mockResolvedValue(null);
  mocks.leadCreate.mockImplementation(async ({ data }: { data: { tenantId: string; phone: string; isTest: boolean } }) => ({
    id: "lead-sim",
    ...data,
    name: "Simulação MCP",
    conversation: { id: "conv-sim", tenantId: data.tenantId, isTest: data.isTest },
  }));
  mocks.leadUpdate.mockResolvedValue({});
  mocks.conversationFindFirst.mockResolvedValue({ variables: {}, lead: { name: null, phone: "mcp:agent-A:x" } });
  mocks.conversationFindUnique.mockResolvedValue({ agentPaused: false });
  mocks.conversationUpdate.mockResolvedValue({});
  mocks.conversationUpdateMany.mockResolvedValue({ count: 1 });
  mocks.messageCreate.mockResolvedValue({ id: "msg-1" });
  mocks.messageFindMany.mockResolvedValue([]);
  mocks.tenantActionFindMany.mockResolvedValue([]);
  mocks.tenantActionFindFirst.mockResolvedValue(null);
  mocks.tenantActionFindUnique.mockResolvedValue(null);
  mocks.appointmentFindFirst.mockResolvedValue(null);
  mocks.appointmentFindMany.mockResolvedValue([]);

  mocks.whatsappProvider.mockReturnValue({ sendMessage: mocks.sendMessage, sendAudio: mocks.sendAudio });
  mocks.createAppointment.mockResolvedValue({ id: "nao-deveria", clinicorpSync: { status: "synced" } });
  // A camada 1 troca isto; a camada 2 usa o turno real.
  mocks.runTurn.mockImplementation(realTurn);

  // Qualquer HTTP de saída (provedor de WhatsApp incluso) é falha do teste.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("rede não deveria ser usada"));
});

afterEach(() => {
  vi.useRealTimers();
  fetchSpy.mockRestore();
});

/** O `runAgentTurn` verdadeiro, guardado antes de qualquer `mockImplementation`. */
let realTurn: (...args: unknown[]) => unknown;
beforeEach(async () => {
  const actual = await vi.importActual<typeof import("@/modules/agent-engine/orchestrator")>(
    "@/modules/agent-engine/orchestrator",
  );
  realTurn = actual.runAgentTurn as (...args: unknown[]) => unknown;
  mocks.runTurn.mockImplementation(realTurn);
});

describe("escopo simulate", () => {
  it("é emitível, junto de read (e de propose, liberado na parte C)", () => {
    expect([...EMITTABLE_MCP_SCOPES]).toEqual(["read", "simulate", "propose"]);
    expect(validateIssueInput({ label: "x", scopes: ["simulate"] })).toMatchObject({ ok: true, scopes: ["simulate"] });
    expect(validateIssueInput({ label: "x", scopes: ["read", "simulate"] })).toMatchObject({ ok: true });
    expect(validateIssueInput({ label: "x", scopes: ["simulate", "propose"] })).toMatchObject({ ok: true });
  });

  it("a tela de admin habilita os checkboxes de simulação e de proposta", () => {
    const source = readFileSync(path.join(ROOT, "src/app/(admin)/admin/agentes/mcp/McpTokenIssuer.tsx"), "utf8");
    expect(source).toMatch(/value: "simulate"[^}]*available: true/);
    expect(source).toMatch(/value: "propose"[^}]*available: true/);
    expect(source).toMatch(/value: "read"[^}]*available: true/);
  });

  it("tools/list mostra as duas ferramentas só com o escopo simulate", async () => {
    const withScope = await json(await call(rpc("tools/list")));
    expect(withScope.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["get_simulation", "run_simulation"]);
    const run = withScope.result.tools.find((t: { name: string }) => t.name === "run_simulation");
    // Grava uma conversa de teste: não pode se anunciar como leitura pura.
    expect(run.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    // Nenhum esquema anuncia tenantId.
    for (const tool of withScope.result.tools) expect(Object.keys(tool.inputSchema.properties)).not.toContain("tenantId");

    for (const scopes of [["read"], ["propose"], []]) {
      mocks.tokenFindUnique.mockResolvedValue(tokenRow(scopes));
      const body = await json(await call(rpc("tools/list")));
      const names = body.result.tools.map((t: { name: string }) => t.name);
      expect(names).not.toContain("run_simulation");
      expect(names).not.toContain("get_simulation");
    }
  });

  it("sem simulate, as duas ferramentas respondem 403 e nada é consultado", async () => {
    mocks.tokenFindUnique.mockResolvedValue(tokenRow(["read"]));
    const run = await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["oi"] }));
    const get = await call(toolCall("get_simulation", { simulationId: "abc" }));
    expect(run.status).toBe(403);
    expect(get.status).toBe(403);
    expect(mocks.agentFindFirst).not.toHaveBeenCalled();
    expect(mocks.conversationFindFirst).not.toHaveBeenCalled();
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("com simulate, as ferramentas de leitura passam a responder 403", async () => {
    const res = await call(toolCall("list_agents", {}));
    expect(res.status).toBe(403);
  });
});

describe("run_simulation: o que o turno recebe", () => {
  beforeEach(() => {
    mocks.runTurn.mockResolvedValue({ reply: "Olá! Como posso ajudar?", toolsUsed: ["remember_variables"], status: "ok" });
  });

  it("cria conversa de teste e roda cada turno com as três travas, na mesma conversa", async () => {
    const body = await json(
      await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi", "Quero agendar"], variant: "current" })),
    );
    const out = output(body);

    // Conversa nova, de teste, com o telefone sintético mcp:<agente>:<simulação>.
    expect(mocks.leadFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.leadCreate).toHaveBeenCalledTimes(1);
    const created = mocks.leadCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({ tenantId: "tenant-A", isTest: true });
    expect(created.conversation.create).toMatchObject({ tenantId: "tenant-A", isTest: true });
    expect(created.phone).toBe(`${SIMULATION_PHONE_PREFIX}${AGENT_A}:${out.simulationId}`);
    expect(created.phone).toMatch(/^mcp:agent-A:[0-9a-f-]{36}$/);

    expect(mocks.runTurn).toHaveBeenCalledTimes(2);
    for (const [index, message] of ["Oi", "Quero agendar"].entries()) {
      expect(mocks.runTurn.mock.calls[index][0]).toMatchObject({
        tenantId: "tenant-A",
        conversationId: "conv-sim",
        leadId: "lead-sim",
        agentId: AGENT_A,
        userMessage: message,
        skipUsageCheck: true,
        skipEnabledCheck: true,
        dryRunScheduling: true,
      });
    }
    // Hoje nenhum chamador troca o prompt: a variante "atual" roda o agente como está.
    expect(mocks.runTurn.mock.calls[0][0]).not.toHaveProperty("systemPromptOverride");

    expect(out).toEqual({
      simulationId: out.simulationId,
      runs: [
        {
          variant: "current",
          turns: [
            { user: "Oi", reply: "Olá! Como posso ajudar?", toolsUsed: ["remember_variables"], status: "ok" },
            { user: "Quero agendar", reply: "Olá! Como posso ajudar?", toolsUsed: ["remember_variables"], status: "ok" },
          ],
        },
      ],
      dryRun: true,
    });
  });

  it("variant é opcional e vale current", async () => {
    const out = output(await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi"] }))));
    expect(out.runs[0].variant).toBe("current");
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
  });

  it("o agente é buscado com o tenantId do token, e tenantId no argumento é recusado", async () => {
    await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi"] }));
    expect(mocks.agentFindFirst.mock.calls[0][0].where).toMatchObject({ id: AGENT_A, tenantId: "tenant-A" });

    mocks.agentFindFirst.mockClear();
    const withTenant = await json(
      await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi"], tenantId: "tenant-B" })),
    );
    expect(withTenant.error?.code).toBe(-32602);
    const getWithTenant = await json(await call(toolCall("get_simulation", { simulationId: "abc", tenantId: "tenant-B" })));
    expect(getWithTenant.error?.code).toBe(-32602);
    expect(mocks.agentFindFirst).not.toHaveBeenCalled();
  });

  it("para no primeiro turno em que o agente não responde (status diferente de ok)", async () => {
    mocks.runTurn.mockResolvedValueOnce({ reply: "", toolsUsed: [], status: "human_handling" });
    const out = output(await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["a", "b", "c"] }))));
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    expect(out.runs[0].turns).toEqual([{ user: "a", reply: "", toolsUsed: [], status: "human_handling" }]);
  });

  it("turno que lança vira status error, sem detalhe técnico, e a simulação para", async () => {
    mocks.runTurn.mockRejectedValueOnce(new Error("PrismaClientKnownRequestError P2002 at x.ts:10"));
    const body = await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["a", "b"] })));
    const out = output(body);
    expect(out.runs[0].turns).toEqual([{ user: "a", reply: "", toolsUsed: [], status: "error" }]);
    expect(JSON.stringify(body)).not.toMatch(/Prisma|P2002/);
  });

  it("devolve só os nomes das ferramentas", async () => {
    mocks.runTurn.mockResolvedValue({
      reply: "ok",
      toolsUsed: ["schedule_meeting", "follow_up"],
      status: "ok",
      replyMessageId: "msg-9",
    });
    const out = output(await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi"] }))));
    expect(out.runs[0].turns[0]).toEqual({ user: "Oi", reply: "ok", toolsUsed: ["schedule_meeting", "follow_up"], status: "ok" });
  });
});

describe("run_simulation: variantes e limites de entrada", () => {
  it.each(["proposal", "both"])("variant %s sem proposalId é recusada (a parte C detalha as demais regras)", async (variant) => {
    const body = await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi"], variant })));
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/proposalId/);
    // Recusada antes de qualquer custo.
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.leadCreate).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("variante fora do enum é argumento inválido", async () => {
    const body = await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi"], variant: "x" })));
    expect(body.error.code).toBe(-32602);
  });

  it("mais de 10 mensagens é recusado, e 10 passam", async () => {
    mocks.runTurn.mockResolvedValue({ reply: "ok", toolsUsed: [], status: "ok" });
    const eleven = Array.from({ length: MAX_SIMULATION_TURNS + 1 }, (_, i) => `mensagem ${i}`);
    const refused = await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: eleven })));
    expect(refused.error.code).toBe(-32602);
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.leadCreate).not.toHaveBeenCalled();

    const ten = eleven.slice(0, MAX_SIMULATION_TURNS);
    const ok = output(await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ten }))));
    expect(ok.runs[0].turns).toHaveLength(10);
  });

  it("lista vazia, mensagem vazia e mensagem grande demais são recusadas", async () => {
    for (const messages of [[], ["  "], ["x".repeat(1001)], [42]]) {
      const body = await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages })));
      expect(body.error?.code).toBe(-32602);
    }
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });
});

describe("isolamento entre contas", () => {
  it("run_simulation com agentId de outra conta: não encontrado, sem conversa e sem gastar saldo", async () => {
    const body = await json(await call(toolCall("run_simulation", { agentId: AGENT_B, messages: ["Oi"] })));
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/não encontrado/i);
    expect(mocks.agentFindFirst.mock.calls[0][0].where).toMatchObject({ id: AGENT_B, tenantId: "tenant-A" });
    expect(mocks.leadCreate).not.toHaveBeenCalled();
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  /** Banco de mentira: a simulação é da conta B; só responde se o filtro bater. */
  function seedSimulationOfTenantB() {
    mocks.conversationFindFirst.mockImplementation(
      async ({ where }: { where: { tenantId: string; isTest: boolean; lead: { tenantId: string; isTest: boolean; phone: { startsWith: string; endsWith: string } } } }) => {
        const matches =
          where.tenantId === "tenant-B" &&
          where.isTest === true &&
          where.lead.isTest === true &&
          where.lead.phone.startsWith === "mcp:" &&
          where.lead.phone.endsWith === ":sim-do-b";
        return matches
          ? {
              lead: { phone: "mcp:agent-B:sim-do-b" },
              messages: [
                { role: "user", content: "oi" },
                { role: "assistant", content: "olá" },
              ],
            }
          : null;
      },
    );
  }

  it("get_simulation do tenant A não lê simulação do tenant B", async () => {
    seedSimulationOfTenantB();
    const body = await json(await call(toolCall("get_simulation", { simulationId: "sim-do-b" })));
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/não encontrada/i);
    const where = mocks.conversationFindFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: "tenant-A", isTest: true });
    expect(where.lead).toMatchObject({ tenantId: "tenant-A", isTest: true, phone: { startsWith: "mcp:" } });

    // O dono lê a própria.
    mocks.tokenFindUnique.mockResolvedValue(tokenRow(["simulate"], "tenant-B"));
    const own = output(await json(await call(toolCall("get_simulation", { simulationId: "sim-do-b" }))));
    expect(own).toEqual({
      simulationId: "sim-do-b",
      agentId: "agent-B",
      runs: [{ variant: "current", turns: [{ user: "oi", reply: "olá" }] }],
      dryRun: true,
    });
  });

  it("get_simulation de conversa que não é simulação (real, ou chat de teste do painel) é não encontrado", async () => {
    // O filtro por prefixo mcp: e isTest é do banco; a ferramenta ainda confere o formato do telefone.
    for (const phone of ["5511999999999", "sandbox:agent-A", "sandbox:agent-A:archived:123", "mcp:agent-A:outra-coisa"]) {
      mocks.conversationFindFirst.mockResolvedValue({ lead: { phone }, messages: [{ role: "user", content: "oi" }] });
      const body = await json(await call(toolCall("get_simulation", { simulationId: "sim-1" })));
      expect(body.result.isError, phone).toBe(true);
    }
    const where = mocks.conversationFindFirst.mock.calls[0][0].where;
    expect(where.isTest).toBe(true);
    expect(where.lead.isTest).toBe(true);
    expect(where.lead.phone.startsWith).toBe("mcp:");
  });

  it("get_simulation recusa id com formato estranho", async () => {
    for (const simulationId of ["", "a:b", "x%", "../x", "a".repeat(65)]) {
      const body = await json(await call(toolCall("get_simulation", { simulationId })));
      expect(body.error?.code, simulationId).toBe(-32602);
    }
    expect(mocks.conversationFindFirst).not.toHaveBeenCalled();
  });
});

describe("limite de turnos por token", () => {
  it("reserva o pedido inteiro de uma vez, por token, com a janela de 10 minutos", async () => {
    mocks.runTurn.mockResolvedValue({ reply: "ok", toolsUsed: [], status: "ok" });
    await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["a", "b", "c"] }));
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledWith("mcp:simulate", "tok-sim", SIMULATION_LIMIT.max, 600, 3);
    expect(SIMULATION_LIMIT.max).toBe(30);
  });

  it("passou do limite: 429 com Retry-After, sem criar conversa nem rodar turno", async () => {
    mocks.reserve.mockResolvedValue({ allowed: false, retryAfterSeconds: 321 });
    const res = await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["a", "b"] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("321");
    const body = await json(res);
    expect(body.error.code).toBe(-32029);
    expect(mocks.leadCreate).not.toHaveBeenCalled();
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it("o pedido maior que o saldo é recusado inteiro: 429 e nenhum turno roda", async () => {
    let balance = 2;
    mocks.reserve.mockImplementation(async (_scope: string, _subject: string, _max: number, _window: number, n: number) => {
      if (n > balance) return { allowed: false, retryAfterSeconds: 60 };
      balance -= n;
      return { allowed: true, retryAfterSeconds: 0 };
    });
    const res = await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["a", "b", "c"] }));
    expect(res.status).toBe(429);
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(balance).toBe(2);
  });

  it("get_simulation não gasta o limite de turnos (não chama LLM)", async () => {
    await call(toolCall("get_simulation", { simulationId: "abc" }));
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});

describe("máscara da saída", () => {
  it("telefone e e-mail gerados na resposta (e ecoados na fala) não aparecem", async () => {
    mocks.runTurn.mockResolvedValue({
      reply: "Anotei! Ligue para (14) 99763-1563 ou escreva para isca.paciente@exemplo.com.br. CPF 123.456.789-00.",
      toolsUsed: [],
      status: "ok",
    });
    const body = await json(
      await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Meu e-mail é isca.paciente@exemplo.com.br e meu zap 14997631563"] })),
    );
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/99763|isca\.paciente|exemplo\.com|123\.456\.789|14997631563/);
    expect(text).toContain("[número oculto]");
    expect(text).toContain("[e-mail oculto]");
  });

  it("get_simulation também mascara o transcript guardado", async () => {
    mocks.conversationFindFirst.mockResolvedValue({
      lead: { phone: "mcp:agent-A:sim-1" },
      messages: [
        { role: "user", content: "meu número é 11 98877-6655" },
        { role: "assistant", content: "Retorno em isca@exemplo.com" },
      ],
    });
    const text = JSON.stringify(await json(await call(toolCall("get_simulation", { simulationId: "sim-1" }))));
    expect(text).not.toMatch(/98877|6655|isca@exemplo/);
    expect(text).toContain("[número oculto]");
    expect(text).toContain("[e-mail oculto]");
  });

  it("a máscara fica no caminho de saída do código", () => {
    const source = readFileSync(path.join(ROOT, "src/modules/agent-mcp/simulate.ts"), "utf8");
    expect(source).toContain('from "@/modules/knowledge-gaps/mask"');
    expect(source).toMatch(/reply: safe\(turn\.reply\)/);
  });
});

describe("a simulação não faz nada fora da simulação (turno real)", () => {
  const SCHEDULE_CONFIG = { allowCancellation: true, allowRescheduling: true };

  beforeEach(() => {
    mocks.tenantActionFindMany.mockResolvedValue([{ key: "schedule_meeting", config: SCHEDULE_CONFIG }]);
    mocks.tenantActionFindUnique.mockResolvedValue({ config: SCHEDULE_CONFIG });
    mocks.tenantActionFindFirst.mockResolvedValue({ config: SCHEDULE_CONFIG });
    mocks.complete
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "schedule_meeting",
            arguments: { date: "2026-09-18", time: "14:00", patientName: "Paciente Teste" },
          },
        ],
      } satisfies LlmResult)
      .mockResolvedValueOnce({
        content: "Marcado para sexta às 14h. Qualquer dúvida: (14) 99763-1563 ou isca@exemplo.com",
        toolCalls: [],
      } satisfies LlmResult);
  });

  it("schedule_meeting simulado não chama createAppointment, espelhos nem WhatsApp", async () => {
    const body = await json(await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Quero marcar sexta às 14h, Paciente Teste"] })));
    const out = output(body);

    // O turno aconteceu de verdade, com as travas.
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    const turn = out.runs[0].turns[0];
    expect(turn.status).toBe("ok");
    expect(turn.toolsUsed).toEqual(["schedule_meeting"]);
    expect(turn.reply).toContain("Marcado para sexta");
    // A ferramenta chegou ao ramo simulado (e não a uma recusa qualquer).
    const toolMessage = mocks.complete.mock.calls[1][0].find((m: { role: string }) => m.role === "tool");
    expect(toolMessage.content).toContain("Simulação");
    expect(toolMessage.content).toContain("seria marcado");
    // Máscara na resposta sintética.
    expect(JSON.stringify(out)).not.toMatch(/99763|isca@exemplo/);

    // Nada gravado na agenda nem espelhado.
    expect(mocks.createAppointment).not.toHaveBeenCalled();
    expect(mocks.appointmentCreate).not.toHaveBeenCalled();
    expect(mocks.appointmentUpdate).not.toHaveBeenCalled();
    expect(mocks.clinicorpSync).not.toHaveBeenCalled();
    expect(mocks.googlePush).not.toHaveBeenCalled();
    expect(mocks.icloudPush).not.toHaveBeenCalled();

    // Nada para o WhatsApp: nem provedor, nem envio, nem aviso de grupo, nem HTTP.
    expect(mocks.whatsappProvider).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.sendAudio).not.toHaveBeenCalled();
    expect(mocks.notifyHandoffGroup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("o turno real foi chamado com as três travas e a conversa é de teste", async () => {
    await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Quero marcar sexta às 14h"] }));
    expect(mocks.runTurn.mock.calls[0][0]).toMatchObject({
      skipUsageCheck: true,
      skipEnabledCheck: true,
      dryRunScheduling: true,
    });
    expect(mocks.leadCreate.mock.calls[0][0].data).toMatchObject({ isTest: true });
    // Só a mensagem do contato e a resposta do agente entram no histórico — e como conversa de teste.
    const roles = mocks.messageCreate.mock.calls.map(([arg]) => arg.data.role);
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("systemPromptOverride troca só a persona do turno; vazio ou ausente mantém o prompt salvo", async () => {
    const turn = (override?: string) =>
      realTurn({
        tenantId: "tenant-A",
        conversationId: "conv-sim",
        leadId: "lead-sim",
        userMessage: "Oi",
        agentId: AGENT_A,
        skipUsageCheck: true,
        skipEnabledCheck: true,
        dryRunScheduling: true,
        ...(override === undefined ? {} : { systemPromptOverride: override }),
      });
    const systemOf = (call: number) =>
      (mocks.complete.mock.calls[call][0] as { role: string; content: string }[]).find((m) => m.role === "system")!.content;

    mocks.complete.mockReset();
    mocks.complete.mockResolvedValue({ content: "ok", toolCalls: [] } satisfies LlmResult);

    await turn();
    expect(systemOf(0)).toContain("Você atende a clínica Sol.");

    await turn("Persona proposta: você atende a clínica Lua.");
    expect(systemOf(1)).toContain("Persona proposta: você atende a clínica Lua.");
    expect(systemOf(1)).not.toContain("Você atende a clínica Sol.");

    await turn("   ");
    expect(systemOf(2)).toContain("Você atende a clínica Sol.");
    // Nada é gravado no agente.
    expect(mocks.agentFindFirst.mock.calls.every(([arg]) => !("data" in arg))).toBe(true);
  });

  it("o caminho da simulação não importa nem chama provedor de WhatsApp, webhook ou envio", () => {
    // Só o código: os comentários explicam justamente que o envio fica de fora.
    const code = (file: string) =>
      readFileSync(path.join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    expect(code("src/modules/agent-mcp/simulate.ts")).not.toMatch(
      /whatsapp|webhook|sendMessage|sendAudio|speakReply|sendManualReply|broadcast/i,
    );
    // O envio (voz e texto) mora no webhook e no worker, que a simulação não alcança.
    expect(code("src/modules/agent-engine/orchestrator.ts")).not.toMatch(/sendMessage|sendAudio|getWhatsAppProvider/);
  });
});

describe("conversa mcp: fora de cota, métrica, lembrete, follow-up e satisfação", () => {
  it("nasce isTest no lead e na conversa, a marca que cada consumidor filtra", async () => {
    mocks.runTurn.mockResolvedValue({ reply: "ok", toolsUsed: [], status: "ok" });
    await call(toolCall("run_simulation", { agentId: AGENT_A, messages: ["Oi"] }));
    const data = mocks.leadCreate.mock.calls[0][0].data;
    expect(data.isTest).toBe(true);
    expect(data.conversation.create.isTest).toBe(true);

    const filters: [string, RegExp][] = [
      ["src/modules/billing/usage.ts", /isTest:\s*false/],
      ["src/modules/reports/events.ts", /isTest:\s*false/],
      ["workers/follow-up-worker/reminders.ts", /isTest:\s*false/],
      ["workers/follow-up-worker/scan.ts", /isTest:\s*false/],
      ["workers/follow-up-worker/satisfaction.ts", /isTest:\s*false/],
      ["src/modules/knowledge-gaps/register.ts", /isTest/],
      ["src/modules/lead-insights/record.ts", /isTest/],
      ["src/modules/agent-engine/handoff.ts", /isTest/],
    ];
    for (const [file, pattern] of filters) {
      expect(readFileSync(path.join(ROOT, file), "utf8"), file).toMatch(pattern);
    }
  });
});
