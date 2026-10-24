import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Parte C do MCP: escopo `propose`, `propose_change`, `get_proposal`, as variantes
 * `proposal`/`both` de `run_simulation` e a aprovação do superadmin.
 *
 * O banco é um conjunto de listas em memória que respeita os filtros (`tenantId`,
 * `status`, `updatedAt`), para provar o que a regra grava — e, principalmente, o
 * que NÃO grava. A auditoria e a sessão são vigiadas.
 */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const state = vi.hoisted(() => ({
  agents: [] as Row[],
  proposals: [] as Row[],
  scopes: ["propose"] as string[],
  tokenTenant: "tenant-A",
  seq: 0,
}));

const mocks = vi.hoisted(() => ({
  tokenFindUnique: vi.fn(),
  tokenUpdate: vi.fn(),
  tokenFindFirst: vi.fn(),
  agentFindFirst: vi.fn(),
  agentUpdate: vi.fn(),
  agentUpdateMany: vi.fn(),
  proposalCreate: vi.fn(),
  proposalCount: vi.fn(),
  proposalFindFirst: vi.fn(),
  proposalFindUnique: vi.fn(),
  proposalUpdateMany: vi.fn(),
  rate: vi.fn(),
  reserve: vi.fn(),
  recordAudit: vi.fn(),
  recordChange: vi.fn(),
  requireSuperadmin: vi.fn(),
  requireTenant: vi.fn(),
  revalidatePath: vi.fn(),
  runTurn: vi.fn(),
  getOrCreateConversation: vi.fn(),
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("gt" in expected) return row[key] > expected.gt;
      return true;
    }
    if (expected instanceof Date) return row[key] instanceof Date && row[key].getTime() === expected.getTime();
    return row[key] === expected;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpToken: { findUnique: mocks.tokenFindUnique, update: mocks.tokenUpdate, findFirst: mocks.tokenFindFirst },
    agent: { findFirst: mocks.agentFindFirst, update: mocks.agentUpdate, updateMany: mocks.agentUpdateMany },
    agentChangeProposal: {
      create: mocks.proposalCreate,
      count: mocks.proposalCount,
      findFirst: mocks.proposalFindFirst,
      findUnique: mocks.proposalFindUnique,
      updateMany: mocks.proposalUpdateMany,
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rate,
  rateLimitReserve: mocks.reserve,
  payloadTooLarge: () => null,
}));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.recordAudit, recordChange: mocks.recordChange }));
vi.mock("@/lib/session", () => ({ requireSuperadmin: mocks.requireSuperadmin, requireTenant: mocks.requireTenant }));
vi.mock("@/lib/app-url", () => ({ appBaseUrl: vi.fn(async () => "https://fechai.test") }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/modules/agent-engine/orchestrator", () => ({ runAgentTurn: mocks.runTurn }));
vi.mock("@/modules/agent-engine/conversation", () => ({ getOrCreateConversation: mocks.getOrCreateConversation }));

import { POST } from "@/app/api/mcp/route";
import { composeSystemPrompt } from "@/modules/agent-engine/persona";
import { agentBaseHash, applyPersonaAnswers } from "@/modules/agent-engine/persona-apply";
import { approveProposal, rejectProposal } from "@/modules/agent-mcp/proposal-decision";
import { lineDiff } from "@/modules/agent-mcp/proposals";
import { approveProposalAction, rejectProposalAction } from "@/app/(admin)/admin/agentes/propostas/[id]/actions";
import { savePersona, saveRules } from "@/app/(dashboard)/agentes/actions";
import { AUDIT_EVENTS } from "@/modules/audit/events";

const ROOT = path.resolve(__dirname, "..");
const TOKEN = `fch_mcp_${"C".repeat(43)}`;
const FUTURE = new Date(Date.now() + 365 * 86_400_000);
const NOW = new Date("2026-10-24T12:00:00Z");
const DAY = 86_400_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcBody = Record<string, any>;

function call(body: unknown) {
  return POST(
    new Request("https://fechai.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    }),
  );
}
const toolCall = (name: string, args: unknown) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
async function json(response: Response): Promise<RpcBody> {
  return (await response.json()) as RpcBody;
}
function output(body: RpcBody): RpcBody {
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  expect(body.result.isError, JSON.stringify(body.result)).toBe(false);
  return JSON.parse(body.result.content[0].text) as RpcBody;
}
function toolError(body: RpcBody): string {
  expect(body.error).toBeUndefined();
  expect(body.result.isError).toBe(true);
  return body.result.content[0].text as string;
}

const DRAFT = {
  agentName: "Aurora",
  businessName: "Clínica Sol",
  sector: "odontologia",
  tone: "acolhedor",
  writingStyle: "frases curtas",
  offer: "avaliação gratuita",
  avoid: "Nunca prometer preço\nNunca dar diagnóstico",
  objective: "agendar avaliação",
};

function makeAgent(overrides: Row = {}): Row {
  return {
    id: "agent-A",
    tenantId: "tenant-A",
    archived: false,
    name: "Aurora",
    systemPrompt: composeSystemPrompt(DRAFT),
    objective: DRAFT.objective,
    personaDraft: { ...DRAFT },
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

const admin = { user: { id: "admin-1", email: "admin@fechai.test", role: "SUPERADMIN" } };

function agentOf(id: string): Row {
  const agent = state.agents.find((item) => item.id === id);
  if (!agent) throw new Error(`agente ${id} não existe no teste`);
  return agent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  state.agents = [makeAgent(), makeAgent({ id: "agent-B", tenantId: "tenant-B", name: "Bia" })];
  state.proposals = [];
  state.scopes = ["propose"];
  state.tokenTenant = "tenant-A";
  state.seq = 0;

  mocks.rate.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.reserve.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.recordChange.mockResolvedValue(undefined);
  mocks.requireSuperadmin.mockResolvedValue(admin);
  mocks.requireTenant.mockResolvedValue({ tenantId: "tenant-A" });

  mocks.tokenFindUnique.mockImplementation(async () => ({
    id: "tok-1",
    tenantId: state.tokenTenant,
    scopes: state.scopes,
    expiresAt: FUTURE,
    revokedAt: null,
    tenant: { status: "active" },
  }));
  mocks.tokenUpdate.mockResolvedValue({});
  mocks.tokenFindFirst.mockResolvedValue({ tokenPrefix: "ABCD1234" });

  mocks.agentFindFirst.mockImplementation(async ({ where }: { where: Row }) => {
    const found = state.agents.find((agent) => matches(agent, where));
    return found ? { ...found } : null;
  });
  mocks.agentUpdate.mockImplementation(async () => {
    throw new Error("agent.update não deve ser chamado");
  });
  mocks.agentUpdateMany.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    const found = state.agents.find((agent) => matches(agent, where));
    if (!found) return { count: 0 };
    Object.assign(found, data, { updatedAt: new Date(found.updatedAt.getTime() + 1000) });
    return { count: 1 };
  });

  mocks.proposalCreate.mockImplementation(async ({ data }: { data: Row }) => {
    const row = { id: `prop-${++state.seq}`, createdAt: new Date(), decidedById: null, decidedByEmail: null, decidedAt: null, appliedAt: null, rejectReason: null, ...data };
    state.proposals.push(row);
    return { id: row.id };
  });
  mocks.proposalCount.mockImplementation(async ({ where }: { where: Row }) => state.proposals.filter((row) => matches(row, where)).length);
  mocks.proposalFindFirst.mockImplementation(async ({ where }: { where: Row }) => {
    const found = state.proposals.find((row) => matches(row, where));
    return found ? { ...found } : null;
  });
  mocks.proposalFindUnique.mockImplementation(async ({ where }: { where: Row }) => {
    const found = state.proposals.find((row) => row.id === where.id);
    return found ? { ...found } : null;
  });
  mocks.proposalUpdateMany.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    const found = state.proposals.filter((row) => matches(row, where));
    for (const row of found) Object.assign(row, data);
    return { count: found.length };
  });

  mocks.getOrCreateConversation.mockImplementation(async (_tenant: string, phone: string) => ({
    lead: { id: `lead-${phone}` },
    conversation: { id: `conv-${phone}` },
  }));
  mocks.runTurn.mockImplementation(async (input: Row) => ({
    reply: input.systemPromptOverride ? "Resposta com a proposta" : "Resposta atual",
    toolsUsed: [],
    status: "ok",
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Propõe pelo MCP e devolve a saída da ferramenta. */
async function propose(changes: Row = { persona: { tone: "direto e objetivo" } }, extra: Row = {}) {
  return output(
    await json(await call(toolCall("propose_change", { agentId: "agent-A", changes, reason: "Soa formal demais", ...extra }))),
  );
}

describe("propose_change", () => {
  it("cria a proposta pendente e NÃO grava no agente", async () => {
    const before = JSON.stringify(state.agents);
    const out = await propose({ persona: { tone: "direto e objetivo", avoid: "Nunca prometer preço" } });

    expect(mocks.agentUpdate).not.toHaveBeenCalled();
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(state.agents)).toBe(before);

    expect(state.proposals).toHaveLength(1);
    const row = state.proposals[0];
    expect(row).toMatchObject({ tenantId: "tenant-A", agentId: "agent-A", tokenId: "tok-1", status: "pending", reason: "Soa formal demais" });
    expect(row.baseHash).toBe(agentBaseHash(state.agents[0] as never));
    expect(row.expiresAt.getTime() - NOW.getTime()).toBe(7 * DAY);
    expect(row.before.persona).toEqual({ tone: "acolhedor", avoid: DRAFT.avoid });
    expect(row.after.persona).toEqual({ tone: "direto e objetivo", avoid: "Nunca prometer preço" });

    expect(out).toMatchObject({ proposalId: row.id, status: "pending", expiresAt: row.expiresAt.toISOString() });
    expect(out.approveUrl).toBe(`https://fechai.test/admin/agentes/propostas/${row.id}`);
    expect(out.diff).toEqual([
      { field: "tone", before: "acolhedor", after: "direto e objetivo" },
      { field: "avoid", before: DRAFT.avoid, after: "Nunca prometer preço" },
    ]);
    // Diff por linha do prompt composto: o tom troca de linha e a regra removida some.
    const added = out.promptDiff.filter((line: Row) => line.type === "add").map((line: Row) => line.text);
    const removed = out.promptDiff.filter((line: Row) => line.type === "remove").map((line: Row) => line.text);
    expect(added).toContain("Tom de voz: direto e objetivo.");
    expect(removed).toContain("Tom de voz: acolhedor.");
    expect(removed).toContain("- Nunca dar diagnóstico");
  });

  it("audita 'propôs' com a conta explícita, o prefixo do token e sem o token nem o hash", async () => {
    await propose();
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    const entry = mocks.recordAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: "agent.change_proposed",
      tenantId: "tenant-A",
      meta: { via: "mcp", proposalId: "prop-1", tokenPrefix: "ABCD1234" },
    });
    const everything = JSON.stringify([entry, mocks.proposalCreate.mock.calls]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(createHash("sha256").update(TOKEN).digest("hex"));
    expect(AUDIT_EVENTS["agent.change_proposed"]).toBeDefined();
    expect(AUDIT_EVENTS["agent.change_rejected"]).toBeDefined();
  });

  it("valida com o zod do painel e recusa campo estranho, tenantId e proposta vazia", async () => {
    // Nome do negócio vazio: a mesma regra do formulário.
    const emptyBusiness = await json(await call(toolCall("propose_change", { agentId: "agent-A", changes: { persona: { businessName: "  " } }, reason: "x" })));
    expect(emptyBusiness.error?.code).toBe(-32602);
    // Campo que não existe na persona e o id da conta: nunca ignorados.
    for (const changes of [{ persona: { voz: "x" } }, { agent: { enabled: false } }]) {
      const body = await json(await call(toolCall("propose_change", { agentId: "agent-A", changes, reason: "x" })));
      expect(body.error?.code).toBe(-32602);
    }
    const withTenant = await json(await call(toolCall("propose_change", { agentId: "agent-A", changes: { persona: { tone: "x" } }, reason: "x", tenantId: "tenant-B" })));
    expect(withTenant.error?.code).toBe(-32602);

    expect(toolError(await json(await call(toolCall("propose_change", { agentId: "agent-A", changes: {}, reason: "x" }))))).toMatch(/ao menos um campo/);
    expect(toolError(await json(await call(toolCall("propose_change", { agentId: "agent-A", changes: { persona: { tone: "acolhedor" } }, reason: "x" }))))).toMatch(/não muda nada/);
    expect(mocks.proposalCreate).not.toHaveBeenCalled();
  });

  it("limita as propostas pendentes por agente", async () => {
    for (let index = 0; index < 10; index++) await propose({ persona: { tone: `tom ${index}` } });
    const text = toolError(await json(await call(toolCall("propose_change", { agentId: "agent-A", changes: { persona: { tone: "outro" } }, reason: "x" }))));
    expect(text).toMatch(/10 propostas aguardando/);
    expect(state.proposals).toHaveLength(10);
  });

  it("agente de outra conta responde como inexistente", async () => {
    const text = toolError(await json(await call(toolCall("propose_change", { agentId: "agent-B", changes: { persona: { tone: "x" } }, reason: "x" }))));
    expect(text).toBe("Agente não encontrado nesta conta.");
    expect(mocks.agentFindFirst.mock.calls[0][0].where).toMatchObject({ id: "agent-B", tenantId: "tenant-A" });
    expect(mocks.proposalCreate).not.toHaveBeenCalled();
  });
});

describe("escopo propose", () => {
  it.each([[["read"]], [["simulate"]], [["read", "simulate"]], [[]]])("token %j não vê nem chama propose_change/get_proposal (403)", async (scopes) => {
    state.scopes = scopes;
    const list = await json(await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const names = list.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain("propose_change");
    expect(names).not.toContain("get_proposal");

    const propose = await call(toolCall("propose_change", { agentId: "agent-A", changes: { persona: { tone: "x" } }, reason: "x" }));
    expect(propose.status).toBe(403);
    const get = await call(toolCall("get_proposal", { proposalId: "prop-1" }));
    expect(get.status).toBe(403);
    expect(mocks.proposalCreate).not.toHaveBeenCalled();
    expect(mocks.proposalFindFirst).not.toHaveBeenCalled();
  });

  it("com o escopo, as duas aparecem, nenhuma anuncia tenantId e propose_change não é leitura pura", async () => {
    const list = await json(await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const tools = list.result.tools as Row[];
    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_proposal", "propose_change"]);
    for (const tool of tools) expect(Object.keys(tool.inputSchema.properties)).not.toContain("tenantId");
    expect(tools.find((tool) => tool.name === "propose_change")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tools.find((tool) => tool.name === "get_proposal")?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("não existe ferramenta MCP que aplique ou aprove", async () => {
    state.scopes = ["read", "simulate", "propose"];
    const list = await json(await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const names = list.result.tools.map((tool: { name: string }) => tool.name);
    expect(names.sort()).toEqual(["get_agent_config", "get_proposal", "get_simulation", "list_agents", "propose_change", "run_simulation"]);
    for (const name of ["approve_proposal", "apply_proposal", "update_agent", "save_persona"]) {
      expect((await json(await call(toolCall(name, {})))).error?.code).toBe(-32602);
    }
    // E o módulo das ferramentas não importa o que aplica nem o que decide.
    for (const file of ["tools.ts", "proposals.ts", "simulate.ts"]) {
      const source = readFileSync(path.join(ROOT, "src/modules/agent-mcp", file), "utf8");
      expect(source, file).not.toMatch(/applyPersonaAnswers\(|from "[^"]*proposal-decision"|\.agent\.(update|updateMany|create|delete|upsert)\(/);
    }
  });
});

describe("get_proposal", () => {
  it("devolve a situação; pendente vencida aparece como expired", async () => {
    const { proposalId } = await propose();
    expect(output(await json(await call(toolCall("get_proposal", { proposalId }))))).toEqual({
      proposalId,
      status: "pending",
      decidedAt: null,
      decidedByRole: null,
      appliedAt: null,
      rejectReason: null,
    });

    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY));
    expect(output(await json(await call(toolCall("get_proposal", { proposalId })))).status).toBe("expired");
  });

  it("mostra quem decidiu só como papel, e o motivo da recusa", async () => {
    const { proposalId } = await propose();
    expect(await rejectProposal(proposalId, "Muito informal", { id: "admin-1", email: "admin@fechai.test" })).toMatchObject({ ok: true });
    const out = output(await json(await call(toolCall("get_proposal", { proposalId }))));
    expect(out).toMatchObject({ status: "rejected", decidedByRole: "superadmin", rejectReason: "Muito informal" });
    expect(JSON.stringify(out)).not.toContain("admin-1");
    expect(JSON.stringify(out)).not.toContain("admin@fechai.test");
  });

  it("token da conta A não lê proposta da conta B", async () => {
    state.proposals.push({
      id: "prop-B",
      tenantId: "tenant-B",
      agentId: "agent-B",
      tokenId: "tok-B",
      status: "pending",
      reason: "segredo da B",
      before: { persona: {}, systemPrompt: "" },
      after: { persona: {}, systemPrompt: "" },
      baseHash: "x",
      expiresAt: new Date(NOW.getTime() + DAY),
      createdAt: NOW,
      decidedById: null,
      decidedAt: null,
      appliedAt: null,
      rejectReason: null,
    });
    const text = toolError(await json(await call(toolCall("get_proposal", { proposalId: "prop-B" }))));
    expect(text).toBe("Proposta não encontrada nesta conta.");
    expect(mocks.proposalFindFirst.mock.calls[0][0].where).toEqual({ id: "prop-B", tenantId: "tenant-A" });
  });
});

describe("aprovação pelo superadmin", () => {
  it("as actions chamam requireSuperadmin antes de tudo; sem ser superadmin nada é lido nem gravado", async () => {
    const { proposalId } = await propose();
    vi.clearAllMocks();
    mocks.requireSuperadmin.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(approveProposalAction({ proposalId })).rejects.toThrow("NEXT_REDIRECT");
    await expect(rejectProposalAction({ proposalId, reason: "não" })).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.proposalFindUnique).not.toHaveBeenCalled();
    expect(mocks.proposalUpdateMany).not.toHaveBeenCalled();
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
    expect(state.proposals[0].status).toBe("pending");
  });

  it("a página e as actions exigem superadmin no código (esconder o botão não autoriza)", () => {
    const dir = "src/app/(admin)/admin/agentes/propostas/[id]";
    const page = readFileSync(path.join(ROOT, dir, "page.tsx"), "utf8");
    const actions = readFileSync(path.join(ROOT, dir, "actions.ts"), "utf8");
    // Página: antes de qualquer consulta ao banco.
    expect(page.indexOf("await requireSuperadmin()")).toBeGreaterThan(-1);
    expect(page.indexOf("await requireSuperadmin()")).toBeLessThan(page.indexOf("prisma.agentChangeProposal"));
    // Cada action: a primeira linha útil é a checagem.
    expect(actions.match(/await requireSuperadmin\(\)/g)).toHaveLength(2);
    for (const name of ["approveProposalAction", "rejectProposalAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const decide = body.search(/(approve|reject)Proposal\(/);
      expect(body.indexOf("requireSuperadmin()")).toBeGreaterThan(-1);
      expect(body.indexOf("requireSuperadmin()")).toBeLessThan(decide);
    }
  });

  it("aprovar aplica no agente e audita com o ator, a conta e via mcp", async () => {
    const { proposalId } = await propose({ persona: { tone: "direto e objetivo" } });
    const result = await approveProposalAction({ proposalId });
    expect(result).toEqual({ ok: true, info: "Proposta aplicada ao agente." });

    const agent = agentOf("agent-A");
    expect(agent.personaDraft.tone).toBe("direto e objetivo");
    expect(agent.systemPrompt).toContain("Tom de voz: direto e objetivo.");
    expect(agent.systemPrompt).toBe(composeSystemPrompt({ ...DRAFT, tone: "direto e objetivo" }));

    expect(state.proposals[0]).toMatchObject({
      status: "applied",
      decidedById: "admin-1",
      decidedByEmail: "admin@fechai.test",
      decidedAt: NOW,
      appliedAt: NOW,
    });

    expect(mocks.recordChange).toHaveBeenCalledTimes(1);
    const audit = mocks.recordChange.mock.calls[0][0];
    expect(audit).toMatchObject({
      event: "agent.persona_updated",
      tenantId: "tenant-A",
      target: { type: "Agent", id: "agent-A" },
      actor: { id: "admin-1", email: "admin@fechai.test", role: "SUPERADMIN" },
      meta: { via: "mcp", proposalId, tokenPrefix: "ABCD1234" },
    });
    expect(audit.before.personaDraft.tone).toBe("acolhedor");
    expect(audit.after.personaDraft.tone).toBe("direto e objetivo");
    const everything = JSON.stringify(audit);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(createHash("sha256").update(TOKEN).digest("hex"));
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/agentes/propostas/${proposalId}`);
  });

  it("proposta só de regras usa o evento agent.rules_updated e não mexe em nome nem objetivo", async () => {
    const { proposalId } = await propose({ persona: { avoid: "Nunca prometer preço" } });
    expect(await approveProposal(proposalId, { id: "admin-1", email: null })).toMatchObject({ ok: true });
    expect(mocks.recordChange.mock.calls[0][0].event).toBe("agent.rules_updated");
    const patch = mocks.agentUpdateMany.mock.calls[0][0].data;
    expect(Object.keys(patch).sort()).toEqual(["personaDraft", "systemPrompt"]);
  });

  it("proposta desatualizada (o agente mudou) é marcada stale e não grava nada", async () => {
    const { proposalId } = await propose();
    // Alguém salvou a persona no painel depois da proposta.
    const agent = agentOf("agent-A");
    agent.personaDraft = { ...agent.personaDraft, sector: "estética" };
    agent.systemPrompt = composeSystemPrompt(agent.personaDraft as never);

    const result = await approveProposal(proposalId, { id: "admin-1", email: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mudou depois desta proposta/);
    expect(state.proposals[0].status).toBe("stale");
    expect(state.proposals[0].appliedAt).toBeNull();
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
    expect(agent.personaDraft.tone).toBe("acolhedor");
    expect(mocks.recordChange).not.toHaveBeenCalled();
  });

  it("agente que muda ENTRE a conferência e a gravação também é recusado (updatedAt na condição)", async () => {
    const { proposalId } = await propose();
    mocks.agentUpdateMany.mockImplementationOnce(async () => ({ count: 0 }));
    const result = await approveProposal(proposalId, { id: "admin-1", email: null });
    expect(result.ok).toBe(false);
    expect(mocks.agentUpdateMany.mock.calls[0][0].where).toMatchObject({ id: "agent-A", tenantId: "tenant-A", updatedAt: expect.any(Date) });
    expect(state.proposals[0]).toMatchObject({ status: "stale", appliedAt: null });
    expect(mocks.recordChange).not.toHaveBeenCalled();
  });

  it("proposta vencida é marcada expired e recusada, sem gravar", async () => {
    const { proposalId } = await propose();
    vi.setSystemTime(new Date(NOW.getTime() + 7 * DAY + 1000));
    const result = await approveProposalAction({ proposalId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/venceu/);
    expect(state.proposals[0].status).toBe("expired");
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.recordChange).not.toHaveBeenCalled();
  });

  it("aprovar duas vezes é recusado: grava uma vez só", async () => {
    const { proposalId } = await propose();
    expect(await approveProposalAction({ proposalId })).toMatchObject({ ok: true });
    const second = await approveProposalAction({ proposalId });
    expect(second.ok).toBe(false);
    expect(mocks.agentUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.recordChange).toHaveBeenCalledTimes(1);
  });

  it("duas aprovações ao mesmo tempo: o updateMany condicional deixa passar uma", async () => {
    const { proposalId } = await propose();
    // Os dois passam pela leitura (ainda 'pending'); o claim decide.
    const [a, b] = await Promise.all([
      approveProposal(proposalId, { id: "admin-1", email: null }),
      approveProposal(proposalId, { id: "admin-2", email: null }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(mocks.agentUpdateMany).toHaveBeenCalledTimes(1);
    const claims = mocks.proposalUpdateMany.mock.calls.map((callArgs) => callArgs[0].where);
    for (const where of claims) expect(where).toMatchObject({ id: proposalId, tenantId: "tenant-A", status: expect.any(String) });
  });

  it("proposta já recusada ou aplicada não aplica", async () => {
    const first = await propose({ persona: { tone: "a" } });
    await rejectProposal(first.proposalId, "não", { id: "admin-1", email: null });
    const result = await approveProposal(first.proposalId, { id: "admin-1", email: null });
    expect(result.ok).toBe(false);
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
  });

  it("o claim e a gravação usam o tenant da proposta; proposta inexistente não faz nada", async () => {
    const { proposalId } = await propose();
    await approveProposal(proposalId, { id: "admin-1", email: null });
    expect(mocks.proposalUpdateMany.mock.calls[0][0].where).toEqual({ id: proposalId, tenantId: "tenant-A", status: "pending" });
    expect(mocks.agentUpdateMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-A" });
    // O agente da conta B nunca é tocado por uma proposta da A.
    expect(agentOf("agent-B").personaDraft.tone).toBe("acolhedor");

    const none = await approveProposal("nao-existe", { id: "admin-1", email: null });
    expect(none).toEqual({ ok: false, error: "Proposta não encontrada." });
  });

  it("falha ao gravar o agente devolve a proposta à fila (não fica 'aplicada' sem aplicar)", async () => {
    const { proposalId } = await propose();
    mocks.agentUpdateMany.mockRejectedValueOnce(new Error("banco fora do ar"));
    await expect(approveProposal(proposalId, { id: "admin-1", email: null })).rejects.toThrow("banco fora do ar");
    expect(state.proposals[0]).toMatchObject({ status: "pending", decidedById: null, appliedAt: null });
  });
});

describe("recusa", () => {
  it("exige motivo e não altera o agente nem a proposta sem ele", async () => {
    const { proposalId } = await propose();
    for (const reason of ["", "   ", "\n"]) {
      const result = await rejectProposalAction({ proposalId, reason });
      expect(result).toEqual({ ok: false, error: "Explique o motivo da recusa." });
    }
    expect(state.proposals[0].status).toBe("pending");
    expect(mocks.proposalUpdateMany).not.toHaveBeenCalled();
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
  });

  it("recusar grava motivo e decisor, audita e não toca no agente", async () => {
    const { proposalId } = await propose();
    const before = JSON.stringify(state.agents);
    expect(await rejectProposalAction({ proposalId, reason: "  Não combina com a marca  " })).toMatchObject({ ok: true });

    expect(state.proposals[0]).toMatchObject({
      status: "rejected",
      rejectReason: "Não combina com a marca",
      decidedById: "admin-1",
      decidedByEmail: "admin@fechai.test",
      decidedAt: NOW,
    });
    expect(state.proposals[0].appliedAt).toBeNull();
    expect(JSON.stringify(state.agents)).toBe(before);
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();

    expect(mocks.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: "agent.change_rejected",
        tenantId: "tenant-A",
        actor: { id: "admin-1", email: "admin@fechai.test", role: "SUPERADMIN" },
        meta: { via: "mcp", proposalId, tokenPrefix: "ABCD1234" },
      }),
    );
  });

  it("recusar duas vezes é recusado", async () => {
    const { proposalId } = await propose();
    expect(await rejectProposal(proposalId, "não", { id: "admin-1", email: null })).toMatchObject({ ok: true });
    const again = await rejectProposal(proposalId, "de novo", { id: "admin-1", email: null });
    expect(again.ok).toBe(false);
    expect(state.proposals[0].rejectReason).toBe("não");
  });
});

describe("run_simulation com proposta", () => {
  beforeEach(() => {
    state.scopes = ["simulate", "propose"];
  });

  const callSim = async (args: Row) => json(await call(toolCall("run_simulation", { agentId: "agent-A", messages: ["Oi", "Quanto custa?"], ...args })));

  it("proposal sem proposalId é recusado antes de qualquer custo", async () => {
    for (const variant of ["proposal", "both"]) {
      expect(toolError(await callSim({ variant }))).toMatch(/proposalId/);
    }
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
  });

  it("proposalId com a variante current também é recusado", async () => {
    const { proposalId } = await propose();
    expect(toolError(await callSim({ variant: "current", proposalId }))).toMatch(/só vale com variant/);
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it.each(["applied", "rejected", "expired", "stale"])("proposta %s não é simulada", async (status) => {
    const { proposalId } = await propose();
    state.proposals[0].status = status;
    expect(toolError(await callSim({ variant: "proposal", proposalId }))).toMatch(/Só dá para simular proposta pendente/);
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("proposta pendente que passou do prazo, ou de agente que mudou, não é simulada", async () => {
    const { proposalId } = await propose();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY));
    expect(toolError(await callSim({ variant: "proposal", proposalId }))).toMatch(/vencida/);
    vi.setSystemTime(NOW);
    agentOf("agent-A").personaDraft.sector = "outra coisa";
    expect(toolError(await callSim({ variant: "proposal", proposalId }))).toMatch(/mudou depois desta proposta/);
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it("proposal roda com o prompt da proposta (só no turno), rotulado, sem gravar no agente", async () => {
    const { proposalId } = await propose({ persona: { tone: "direto e objetivo" } });
    const out = output(await callSim({ variant: "proposal", proposalId }));

    expect(out.runs).toHaveLength(1);
    expect(out.runs[0].variant).toBe("proposal");
    expect(out.runs[0].turns.map((turn: Row) => turn.reply)).toEqual(["Resposta com a proposta", "Resposta com a proposta"]);
    for (const [input] of mocks.runTurn.mock.calls) {
      expect(input.systemPromptOverride).toBe(composeSystemPrompt({ ...DRAFT, tone: "direto e objetivo" }));
      expect(input).toMatchObject({ skipUsageCheck: true, skipEnabledCheck: true, dryRunScheduling: true, tenantId: "tenant-A" });
    }
    expect(mocks.agentUpdate).not.toHaveBeenCalled();
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
    expect(agentOf("agent-A").personaDraft.tone).toBe("acolhedor");
    expect(mocks.reserve.mock.calls[0][4]).toBe(2);
    expect(mocks.getOrCreateConversation.mock.calls[0][1]).toMatch(/^mcp:agent-A:[0-9a-f-]+:proposal$/);
    // A proposta continua pendente: simular não decide nada.
    expect(state.proposals[0].status).toBe("pending");
  });

  it("both roda as duas, cada saída rotulada, e reserva os turnos das duas", async () => {
    const { proposalId } = await propose();
    const out = output(await callSim({ variant: "both", proposalId }));
    expect(out.runs.map((run: Row) => run.variant)).toEqual(["current", "proposal"]);
    expect(out.runs[0].turns[0].reply).toBe("Resposta atual");
    expect(out.runs[1].turns[0].reply).toBe("Resposta com a proposta");
    expect(mocks.reserve.mock.calls[0][4]).toBe(4);
    // Só a rodada da proposta leva o override.
    expect(mocks.runTurn.mock.calls.filter(([input]) => input.systemPromptOverride).length).toBe(2);
    expect(mocks.runTurn.mock.calls.filter(([input]) => !("systemPromptOverride" in input)).length).toBe(2);
  });

  it("token só com simulate (sem propose) não simula proposta", async () => {
    const { proposalId } = await propose();
    state.scopes = ["simulate"];
    expect(toolError(await callSim({ variant: "proposal", proposalId }))).toMatch(/simulate e propose/);
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.proposalFindFirst).not.toHaveBeenCalled();
  });

  it("proposta de outra conta responde como inexistente", async () => {
    state.proposals.push({
      id: "prop-B",
      tenantId: "tenant-B",
      agentId: "agent-A",
      status: "pending",
      expiresAt: new Date(NOW.getTime() + DAY),
      baseHash: "x",
      after: { persona: { tone: "x" }, systemPrompt: "x" },
    });
    expect(toolError(await callSim({ variant: "proposal", proposalId: "prop-B" }))).toBe("Proposta não encontrada nesta conta.");
    expect(mocks.proposalFindFirst.mock.calls[0][0].where).toEqual({ id: "prop-B", tenantId: "tenant-A" });
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it("proposta de outro agente da mesma conta é recusada", async () => {
    state.agents.push(makeAgent({ id: "agent-A2", name: "Outra" }));
    const { proposalId } = await propose();
    const body = await json(await call(toolCall("run_simulation", { agentId: "agent-A2", messages: ["Oi"], variant: "proposal", proposalId })));
    expect(toolError(body)).toBe("Esta proposta é de outro agente.");
  });
});

describe("applyPersonaAnswers = o que o painel faz", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it("savePersona do painel e applyPersonaAnswers gravam o mesmo", async () => {
    const answers = { agentName: "Luna", businessName: "Clínica Lua", sector: "estética", tone: "leve", writingStyle: "curto", offer: "limpeza", objective: "agendar" };

    // Painel.
    expect(await savePersona(null, form({ agentId: "agent-A", ...answers }))).toEqual({ ok: true, info: "Persona salva." });
    const viaPanel = mocks.agentUpdateMany.mock.calls[0][0].data;
    const panelAudit = mocks.recordChange.mock.calls[0][0];

    // Mesmas respostas, pelo núcleo, em outro agente idêntico.
    vi.clearAllMocks();
    state.agents.push(makeAgent({ id: "agent-A3" }));
    const result = await applyPersonaAnswers("tenant-A", "agent-A3", answers, null);
    expect(result).toMatchObject({ ok: true, event: "agent.persona_updated" });
    expect(mocks.agentUpdateMany.mock.calls[0][0].data).toEqual(viaPanel);
    expect(mocks.recordChange.mock.calls[0][0]).toMatchObject({ event: panelAudit.event, before: panelAudit.before, after: panelAudit.after });

    // Efeito de persona: nome da lista, objetivo e prompt acompanham; as regras ficam.
    expect(viaPanel).toEqual({
      name: "Luna",
      systemPrompt: composeSystemPrompt({ ...answers, avoid: DRAFT.avoid }),
      objective: "agendar",
      personaDraft: { ...answers, avoid: DRAFT.avoid },
    });
  });

  it("saveRules do painel e applyPersonaAnswers({avoid}) gravam o mesmo e só mexem em prompt e rascunho", async () => {
    expect(await saveRules(null, form({ agentId: "agent-A", rules: "  Sempre confirmar o nome  " }))).toEqual({ ok: true, info: "Regras salvas." });
    const viaPanel = mocks.agentUpdateMany.mock.calls[0][0].data;
    const panelAudit = mocks.recordChange.mock.calls[0][0];
    expect(panelAudit.event).toBe("agent.rules_updated");

    vi.clearAllMocks();
    state.agents.push(makeAgent({ id: "agent-A3" }));
    await applyPersonaAnswers("tenant-A", "agent-A3", { avoid: "Sempre confirmar o nome" }, null);
    expect(mocks.agentUpdateMany.mock.calls[0][0].data).toEqual(viaPanel);
    expect(Object.keys(viaPanel).sort()).toEqual(["personaDraft", "systemPrompt"]);
    expect(viaPanel.personaDraft).toEqual({ ...DRAFT, avoid: "Sempre confirmar o nome" });
  });

  it("agente de outra conta ou inexistente: nada é gravado", async () => {
    expect(await applyPersonaAnswers("tenant-A", "agent-B", { tone: "x" }, null)).toEqual({ ok: false, reason: "not_found" });
    // O painel (sessão da conta A) também não alcança o agente da B.
    expect(await savePersona(null, form({ agentId: "agent-B", businessName: "X" }))).toEqual({ ok: false, error: "Agente não encontrado" });
    expect(mocks.agentUpdateMany).not.toHaveBeenCalled();
  });

  it("a action do painel passa o tenant da sessão e não manda ator explícito (a auditoria resolve pela sessão)", async () => {
    await saveRules(null, form({ agentId: "agent-A", rules: "Regra nova" }));
    const audit = mocks.recordChange.mock.calls[0][0];
    expect(audit.tenantId).toBe("tenant-A");
    expect(audit.actor).toBeUndefined();
    expect(audit.meta).toBeUndefined();
  });

  it("lineDiff marca o que entra, o que sai e o que fica", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "B" },
      { type: "same", text: "c" },
    ]);
    expect(lineDiff("a", "a").every((line) => line.type === "same")).toBe(true);
  });
});
