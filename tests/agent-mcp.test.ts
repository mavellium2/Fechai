import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  tokenFindUnique: vi.fn(),
  tokenUpdate: vi.fn(),
  tokenCreate: vi.fn(),
  tokenFindFirst: vi.fn(),
  tokenUpdateMany: vi.fn(),
  agentFindMany: vi.fn(),
  agentFindFirst: vi.fn(),
  actionFindMany: vi.fn(),
  queryRaw: vi.fn(),
  leadAny: vi.fn(),
  messageAny: vi.fn(),
  appointmentAny: vi.fn(),
  conversationAny: vi.fn(),
  tenantAny: vi.fn(),
  rate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpToken: {
      findUnique: mocks.tokenFindUnique,
      update: mocks.tokenUpdate,
      create: mocks.tokenCreate,
      findFirst: mocks.tokenFindFirst,
      updateMany: mocks.tokenUpdateMany,
    },
    agent: { findMany: mocks.agentFindMany, findFirst: mocks.agentFindFirst },
    tenantAction: { findMany: mocks.actionFindMany },
    $queryRaw: mocks.queryRaw,
    // Estes modelos NÃO podem ser tocados pela leitura da configuração.
    lead: { findMany: mocks.leadAny, findFirst: mocks.leadAny, count: mocks.leadAny },
    message: { findMany: mocks.messageAny, findFirst: mocks.messageAny, count: mocks.messageAny },
    appointment: { findMany: mocks.appointmentAny, findFirst: mocks.appointmentAny, count: mocks.appointmentAny },
    conversation: { findMany: mocks.conversationAny, findFirst: mocks.conversationAny },
    tenant: { findUnique: mocks.tenantAny, findMany: mocks.tenantAny },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rate }));

import { POST, GET } from "@/app/api/mcp/route";
import { issueMcpToken, revokeMcpToken, hashMcpToken, MCP_TOKEN_PATTERN } from "@/modules/agent-mcp/tokens";
import { AUDIT_EVENTS, isRevertibleEvent } from "@/modules/audit/events";

const ROOT = path.resolve(__dirname, "..");
const TOKEN = `fch_mcp_${"A".repeat(43)}`;
const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tok-1",
    tenantId: "tenant-A",
    scopes: ["read"],
    expiresAt: FUTURE,
    revokedAt: null,
    tenant: { status: "active" },
    ...overrides,
  };
}

function call(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }, url = "https://fechai.test/api/mcp") {
  return POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}
const rpc = (method: string, params?: unknown, id = 1) => ({ jsonrpc: "2.0", id, method, params });
const toolCall = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });

// Corpo JSON-RPC cru: os testes navegam por ele livremente.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcBody = Record<string, any>;
async function json(response: Response): Promise<RpcBody> {
  return (await response.json()) as RpcBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.tokenFindUnique.mockResolvedValue(tokenRow());
  mocks.tokenUpdate.mockResolvedValue({});
  mocks.actionFindMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([]);
});

describe("Autenticação da rota MCP", () => {
  it("401 sem header Authorization", async () => {
    const res = await call(rpc("ping"), {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(mocks.tokenFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["esquema diferente de Bearer", `Basic ${TOKEN}`],
    ["Bearer sem token", "Bearer"],
    ["token fora do formato", "Bearer abc123"],
    ["token com o prefixo certo e tamanho errado", "Bearer fch_mcp_curto"],
    ["duas partes depois do Bearer", `Bearer ${TOKEN} extra`],
  ])("401 para header malformado: %s", async (_name, header) => {
    const res = await call(rpc("ping"), { authorization: header });
    expect(res.status).toBe(401);
    // Malformado nem chega ao banco.
    expect(mocks.tokenFindUnique).not.toHaveBeenCalled();
  });

  it("401 para token inexistente, buscando pelo hash e nunca pelo token", async () => {
    mocks.tokenFindUnique.mockResolvedValue(null);
    const res = await call(rpc("ping"));
    expect(res.status).toBe(401);
    const where = mocks.tokenFindUnique.mock.calls[0][0].where;
    expect(where).toEqual({ tokenHash: createHash("sha256").update(TOKEN).digest("hex") });
    expect(JSON.stringify(mocks.tokenFindUnique.mock.calls)).not.toContain(TOKEN);
  });

  it("401 para token revogado", async () => {
    mocks.tokenFindUnique.mockResolvedValue(tokenRow({ revokedAt: new Date() }));
    expect((await call(rpc("ping"))).status).toBe(401);
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
  });

  it("401 para token vencido", async () => {
    mocks.tokenFindUnique.mockResolvedValue(tokenRow({ expiresAt: PAST }));
    expect((await call(rpc("ping"))).status).toBe(401);
    expect(mocks.tokenUpdate).not.toHaveBeenCalled();
  });

  it("não aceita o token na query string", async () => {
    const res = await call(rpc("ping"), {}, `https://fechai.test/api/mcp?token=${TOKEN}&access_token=${TOKEN}`);
    expect(res.status).toBe(401);
    expect(mocks.tokenFindUnique).not.toHaveBeenCalled();
  });

  it("falha repetida de autenticação por IP vira 429", async () => {
    mocks.tokenFindUnique.mockResolvedValue(null);
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const res = await call(rpc("ping"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("120");
  });

  it("token válido passa, marca lastUsedAt e não pergunta o tenant ao cliente", async () => {
    const res = await call(rpc("ping"));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ jsonrpc: "2.0", id: 1, result: {} });
    expect(mocks.tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok-1" }, data: { lastUsedAt: expect.any(Date) } }),
    );
  });

  it("conta suspensa não usa o token", async () => {
    mocks.tokenFindUnique.mockResolvedValue(tokenRow({ tenant: { status: "suspended" } }));
    expect((await call(rpc("ping"))).status).toBe(403);
  });

  it("403 quando falta o escopo da ferramenta", async () => {
    mocks.tokenFindUnique.mockResolvedValue(tokenRow({ scopes: ["simulate"] }));
    const res = await call(toolCall("list_agents", {}));
    expect(res.status).toBe(403);
    expect(mocks.agentFindMany).not.toHaveBeenCalled();
  });

  it("tools/list só mostra o que o escopo permite", async () => {
    mocks.tokenFindUnique.mockResolvedValue(tokenRow({ scopes: ["simulate"] }));
    const body = await json(await call(rpc("tools/list")));
    expect(body.result.tools).toEqual([]);
  });
});

describe("Protocolo JSON-RPC", () => {
  it("initialize, tools/list e notificações", async () => {
    const init = await json(await call(rpc("initialize", { protocolVersion: "2025-03-26" })));
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBeTruthy();

    const list = await json(await call(rpc("tools/list")));
    expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["get_agent_config", "list_agents"]);

    const note = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
  });

  it("só aceita POST", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("recusa lote, JSON quebrado e método desconhecido", async () => {
    expect((await call([rpc("ping")])).status).toBe(400);
    const broken = await POST(
      new Request("https://fechai.test/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: "{nope",
      }),
    );
    expect(broken.status).toBe(400);
    const unknown = await json(await call(rpc("resources/list")));
    expect(unknown.error.code).toBe(-32601);
  });

  it("nenhuma ferramenta aceita tenantId como argumento", async () => {
    for (const tool of ["list_agents", "get_agent_config"]) {
      const body = await json(await call(toolCall(tool, { agentId: "ag-1", tenantId: "tenant-B" })));
      expect(body.error?.code).toBe(-32602);
    }
    expect(mocks.agentFindMany).not.toHaveBeenCalled();
    expect(mocks.agentFindFirst).not.toHaveBeenCalled();

    const list = await json(await call(rpc("tools/list")));
    for (const tool of list.result.tools) {
      expect(Object.keys(tool.inputSchema.properties)).not.toContain("tenantId");
    }
  });
});

describe("Isolamento entre contas", () => {
  it("list_agents consulta só a conta do token", async () => {
    mocks.agentFindMany.mockResolvedValue([{ id: "ag-1", name: "Aurora", isPrimary: true, enabled: true }]);
    const body = await json(await call(toolCall("list_agents", {})));
    expect(mocks.agentFindMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-A" });
    expect(JSON.parse(body.result.content[0].text).agents).toEqual([
      { id: "ag-1", name: "Aurora", isPrimary: true, enabled: true },
    ]);
  });

  it("token da conta A com agentId da conta B é recusado e a consulta leva tenantId A", async () => {
    // O banco de mentira só devolve o agente se o filtro bater com o dono dele.
    mocks.agentFindFirst.mockImplementation(async ({ where }: { where: { id: string; tenantId: string } }) =>
      where.id === "agent-of-B" && where.tenantId === "tenant-B" ? { id: "agent-of-B" } : null,
    );
    const body = await json(await call(toolCall("get_agent_config", { agentId: "agent-of-B" })));

    expect(mocks.agentFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.agentFindFirst.mock.calls[0][0].where).toMatchObject({ id: "agent-of-B", tenantId: "tenant-A" });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/não encontrado/i);
    // Sem agente, nada mais é consultado.
    expect(mocks.actionFindMany).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("as demais consultas da leitura também levam o tenantId do token", async () => {
    mocks.agentFindFirst.mockResolvedValue(agentRow());
    await call(toolCall("get_agent_config", { agentId: "ag-1" }));
    expect(mocks.actionFindMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-A", agentId: "ag-1" });
    // $queryRaw recebe o tenant como parâmetro (template tag): [strings, tenantId, agentId].
    expect(mocks.queryRaw.mock.calls[0].slice(1)).toEqual(["tenant-A", "ag-1"]);
  });
});

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ag-1",
    name: "Aurora",
    isPrimary: true,
    enabled: true,
    systemPrompt: "Você é a Aurora.",
    objective: "agendar",
    personaDraft: {
      agentName: "Aurora",
      businessName: "Clínica Sol",
      sector: "odontologia",
      tone: "acolhedor",
      writingStyle: "frases curtas",
      offer: "avaliação gratuita",
      avoid: "Nunca dar preço\nNunca prometer resultado",
      objective: "agendar avaliação",
    },
    variableDefinitions: [{ key: "convenio", description: "Convênio do contato" }],
    listenAudio: true,
    stopOnEmoji: true,
    speakReplies: true,
    voiceStyle: "calorosa",
    voiceId: "VOICE-ID-ISCA-123",
    ...overrides,
  };
}

describe("get_agent_config: o que sai e o que não sai", () => {
  const BAITS = [
    "VOICE-ID-ISCA-123",
    "120363ISCA999@g.us",
    "Grupo Interno Isca",
    "SENHA-ISCA-CLINICORP",
    "TOKEN-ISCA-GOOGLE",
    "ICLOUD-ISCA",
    "META-TEMPLATE-ISCA",
    "ISCA-CATEGORIA-777",
    "DONO-ISCA-SOCIO",
    "CONTEUDO-DOC-ISCA",
    "VALOR-VARIAVEL-ISCA",
    "Fulano Aceitou Isca",
  ];

  beforeEach(() => {
    mocks.agentFindFirst.mockResolvedValue(
      agentRow({
        // Isca fora do select: se alguém passar a selecionar, o campo apareceria aqui.
        ownerNames: ["DONO-ISCA-SOCIO"],
        voiceLabel: "VOICE-ID-ISCA-123",
        clinicorpPassword: "SENHA-ISCA-CLINICORP",
      }),
    );
    mocks.actionFindMany.mockResolvedValue([
      {
        key: "handoff_human",
        enabled: true,
        config: {
          notifyGroup: true,
          groupId: "120363999",
          groupName: "Grupo Interno Isca",
          groupReason: "pedir humano",
        },
      },
      {
        key: "schedule_meeting",
        enabled: true,
        config: {
          startTime: "09:00",
          endTime: "18:00",
          durationMinutes: 45,
          reminderEnabled: true,
          reminders: [{ minutesBefore: 1440, template: "Oi {{nome}}, é amanhã" }],
          clinicorpReminderCategoryIds: ["777"],
          clinicorpQrEnabled: true,
          clinicorpQrConsentAt: "2026-10-01T00:00:00.000Z",
          clinicorpQrRiskAcceptance: { actorName: "Fulano Aceitou Isca" },
          metaReminderTemplate: { name: "META-TEMPLATE-ISCA", language: "pt_BR" },
          clinicorpPassword: "SENHA-ISCA-CLINICORP",
          googleToken: "TOKEN-ISCA-GOOGLE",
          icloudAppPassword: "ICLOUD-ISCA",
          variables: { nome: "VALOR-VARIAVEL-ISCA" },
        },
      },
      {
        key: "follow_up",
        enabled: false,
        config: { apiKey: "TOKEN-ISCA-GOOGLE", noReply: { enabled: true, steps: [{ delayMinutes: 30, message: "Oi?", ai: false }] } },
      },
    ]);
    mocks.queryRaw.mockResolvedValue([
      { title: "Tabela de preços", size: 1200, status: "ready", content: "CONTEUDO-DOC-ISCA" },
    ]);
  });

  it("devolve persona, prompt, comportamento, variáveis e habilidades", async () => {
    const body = await json(await call(toolCall("get_agent_config", { agentId: "ag-1" })));
    expect(body.result.isError).toBe(false);
    const config = JSON.parse(body.result.content[0].text);

    expect(config.persona).toEqual({
      agentName: "Aurora",
      businessName: "Clínica Sol",
      sector: "odontologia",
      tone: "acolhedor",
      writingStyle: "frases curtas",
      offer: "avaliação gratuita",
      objective: "agendar avaliação",
      rules: "Nunca dar preço\nNunca prometer resultado",
    });
    expect(config.systemPrompt).toBe("Você é a Aurora.");
    expect(config.behavior).toEqual({
      listenAudio: true,
      stopOnEmoji: true,
      speakReplies: true,
      voiceStyle: "calorosa",
      hasVoice: true,
    });
    expect(config.variables).toContainEqual({ key: "convenio", description: "Convênio do contato" });
    expect(config.variables.map((v: { key: string }) => v.key)).toEqual(expect.arrayContaining(["nome", "numero", "endereco"]));

    const handoff = config.actions.find((a: { key: string }) => a.key === "handoff_human");
    expect(handoff.enabled).toBe(true);
    expect(handoff.config).toEqual({ notifyGroup: true, hasGroup: true, groupReason: "pedir humano" });

    const schedule = config.actions.find((a: { key: string }) => a.key === "schedule_meeting");
    expect(schedule.config.durationMinutes).toBe(45);
    expect(schedule.config.reminders).toEqual([{ minutesBefore: 1440, template: "Oi {{nome}}, é amanhã" }]);
    expect(schedule.summary).toEqual(expect.any(String));

    // Só título e tamanho dos documentos.
    expect(config.knowledge).toEqual([{ title: "Tabela de preços", characters: 1200, status: "ready" }]);
  });

  it("não expõe voiceId, grupo, credenciais, ownerNames, variáveis nem conteúdo de documento", async () => {
    const res = await call(toolCall("get_agent_config", { agentId: "ag-1" }));
    const text = JSON.stringify(await json(res));
    for (const bait of BAITS) expect(text, `vazou: ${bait}`).not.toContain(bait);
    for (const key of ["voiceId", "groupId", "ownerNames", "clinicorp", "metaReminderTemplate", "password", "apiKey"]) {
      expect(text, `chave: ${key}`).not.toMatch(new RegExp(key, "i"));
    }
  });

  it("não pede voiceId nem nada de integração ao banco além do necessário", async () => {
    await call(toolCall("get_agent_config", { agentId: "ag-1" }));
    const select = mocks.agentFindFirst.mock.calls[0][0].select as Record<string, boolean>;
    expect(select).not.toHaveProperty("ownerNames");
    expect(select).not.toHaveProperty("voiceLabel");
    expect(select).not.toHaveProperty("conversations");
    expect(select).not.toHaveProperty("appointments");
    // Só consulta o título e o tamanho do documento, nunca `content`.
    const sql = (mocks.queryRaw.mock.calls[0][0] as string[]).join(" ");
    expect(sql).toMatch(/length\(content\)/);
    expect(sql).not.toMatch(/SELECT[^;]*\bcontent\s*[,F]/i);
  });

  it("não consulta lead, message, appointment, conversation nem tenant", async () => {
    await call(toolCall("list_agents", {}));
    await call(toolCall("get_agent_config", { agentId: "ag-1" }));
    expect(mocks.leadAny).not.toHaveBeenCalled();
    expect(mocks.messageAny).not.toHaveBeenCalled();
    expect(mocks.appointmentAny).not.toHaveBeenCalled();
    expect(mocks.conversationAny).not.toHaveBeenCalled();
    expect(mocks.tenantAny).not.toHaveBeenCalled();

    const source = ["read.ts", "tools.ts", "rpc.ts", "auth.ts"]
      .map((file) => readFileSync(path.join(ROOT, "src/modules/agent-mcp", file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/prisma\.(lead|message|appointment|conversation|tenant)\b/);
  });
});

describe("Tokens: emissão, listagem e revogação", () => {
  it("grava só o hash e o prefixo; o token em claro nunca vai ao banco", async () => {
    mocks.tokenCreate.mockResolvedValue({ id: "tok-new" });
    const result = await issueMcpToken({
      tenantId: "tenant-A",
      label: "Claude Code",
      scopes: ["read"],
      createdById: "admin-1",
      createdByEmail: "admin@fechai.test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { token, tokenPrefix, expiresAt } = result.issued;
    expect(token).toMatch(MCP_TOKEN_PATTERN);
    expect(token.startsWith("fch_mcp_")).toBe(true);

    const data = mocks.tokenCreate.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashMcpToken(token));
    expect(data.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(data.tokenPrefix).toBe(tokenPrefix);
    expect(tokenPrefix).toHaveLength(8);
    expect(token).toContain(tokenPrefix);
    expect(data).toMatchObject({ tenantId: "tenant-A", label: "Claude Code", scopes: ["read"], createdById: "admin-1" });
    // Nenhum campo do create carrega o token, nem inteiro nem em parte além do prefixo.
    expect(JSON.stringify(mocks.tokenCreate.mock.calls)).not.toContain(token);
    expect(Object.keys(data)).not.toContain("token");

    // Padrão de 30 dias.
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("emite tokens diferentes a cada chamada", async () => {
    mocks.tokenCreate.mockResolvedValue({ id: "x" });
    const a = await issueMcpToken({ tenantId: "t", label: "a", scopes: ["read"] });
    const b = await issueMcpToken({ tenantId: "t", label: "b", scopes: ["read"] });
    expect(a.ok && b.ok && a.issued.token !== b.issued.token).toBe(true);
  });

  it("recusa nome vazio, escopo desconhecido, sem escopo e validade fora da faixa", async () => {
    for (const bad of [
      { label: "  ", scopes: ["read"] },
      { label: "x", scopes: [] },
      { label: "x", scopes: ["admin"] },
      { label: "x", scopes: ["read"], ttlDays: 0 },
      { label: "x", scopes: ["read"], ttlDays: 366 },
    ]) {
      const result = await issueMcpToken({ tenantId: "t", ...bad });
      expect(result.ok).toBe(false);
    }
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  it("revogar filtra por conta e por não revogado, e vale na hora", async () => {
    mocks.tokenFindFirst.mockResolvedValue({ label: "Claude Code", revokedAt: null });
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
    const result = await revokeMcpToken({ tenantId: "tenant-A", tokenId: "tok-1", revokedById: "admin-1" });
    expect(result).toEqual({ ok: true, label: "Claude Code" });
    expect(mocks.tokenFindFirst.mock.calls[0][0].where).toEqual({ id: "tok-1", tenantId: "tenant-A" });
    expect(mocks.tokenUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "tok-1", tenantId: "tenant-A", revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedById: "admin-1" },
    });

    // A autenticação seguinte lê revokedAt do banco, sem cache.
    mocks.tokenFindUnique.mockResolvedValue(tokenRow({ revokedAt: new Date() }));
    expect((await call(rpc("ping"))).status).toBe(401);
  });

  it("revogar token de outra conta ou já revogado devolve erro", async () => {
    mocks.tokenFindFirst.mockResolvedValue(null);
    expect((await revokeMcpToken({ tenantId: "tenant-A", tokenId: "tok-de-B" })).ok).toBe(false);
    mocks.tokenFindFirst.mockResolvedValue({ label: "x", revokedAt: new Date() });
    expect((await revokeMcpToken({ tenantId: "tenant-A", tokenId: "tok-1" })).ok).toBe(false);
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  });
});

describe("Auditoria e admin", () => {
  it("os dois eventos existem e não são revertíveis", () => {
    expect(AUDIT_EVENTS["mcp.token_issued"].label).toBeTruthy();
    expect(AUDIT_EVENTS["mcp.token_revoked"].label).toBeTruthy();
    expect(isRevertibleEvent("mcp.token_issued")).toBe(false);
    expect(isRevertibleEvent("mcp.token_revoked")).toBe(false);
  });

  it("as actions do admin exigem superadmin antes de qualquer coisa", () => {
    const actions = readFileSync(path.join(ROOT, "src/app/(admin)/admin/agentes/mcp/actions.ts"), "utf8");
    for (const name of ["issueMcpTokenAction", "revokeMcpTokenAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const firstAwait = body.indexOf("await ", body.indexOf("{"));
      expect(body.indexOf("await requireSuperadmin()")).toBe(firstAwait);
    }
    // O token em claro nunca vai para a auditoria.
    const auditCalls = actions.match(/recordAudit\(\{[\s\S]*?\n  \}\);/g) ?? [];
    expect(auditCalls.length).toBe(2);
    for (const block of auditCalls) expect(block).not.toMatch(/\btoken:|result\.token|issued\.token\b/);
  });

  it("a rota autentica antes de ler o corpo e aceita só POST", () => {
    const rpcSource = readFileSync(path.join(ROOT, "src/modules/agent-mcp/rpc.ts"), "utf8");
    expect(rpcSource.indexOf("authenticateMcp(request)")).toBeGreaterThan(-1);
    expect(rpcSource.indexOf("authenticateMcp(request)")).toBeLessThan(rpcSource.indexOf("request.text()"));
    const route = readFileSync(path.join(ROOT, "src/app/api/mcp/route.ts"), "utf8");
    expect(route).toContain('export const runtime = "nodejs"');
    expect(route).not.toMatch(/export async function (PUT|PATCH|DELETE)/);
    expect(route).not.toContain("searchParams");
  });

  it("a rota e o .mcp.json.example não carregam token", () => {
    const example = readFileSync(path.join(ROOT, ".mcp.json.example"), "utf8");
    expect(JSON.parse(example).mcpServers.fechai).toMatchObject({
      type: "http",
      headers: { Authorization: "Bearer ${FECHAI_MCP_TOKEN}" },
    });
    expect(example).not.toMatch(/fch_mcp_[A-Za-z0-9_-]{10,}/);
  });
});
