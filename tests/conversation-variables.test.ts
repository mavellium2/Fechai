import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { findFirst: vi.fn() },
  conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
  lead: { updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  DEFAULT_VARIABLES,
  loadConversationVariables,
  parseConversationVariables,
  parseVariableDefinitions,
  rememberConversationVariables,
  validateVariableDefinitions,
  variablesSystemContext,
  withContactDefaults,
} from "@/modules/agent-engine/variables";
import { getToolSchemas, runToolHandler } from "@/modules/agent-engine/tools";

const custom = [{ key: "convenio", description: "Convênio informado pelo contato" }];

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findFirst.mockResolvedValue({
    variables: null,
    lead: { name: "Alcides", phone: "5514999999999" },
  });
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  db.lead.updateMany.mockResolvedValue({ count: 1 });
  db.agent.findFirst.mockResolvedValue({ variableDefinitions: custom });
});

describe("definições do agente", () => {
  it("mantém padrões e valida nomes, duplicações e definições", () => {
    expect(DEFAULT_VARIABLES.map((item) => item.key)).toEqual(["nome", "numero", "endereco"]);
    expect(validateVariableDefinitions(custom)).toBeNull();
    expect(validateVariableDefinitions([{ key: "nome", description: "Outro" }])).toContain("padrão");
    expect(validateVariableDefinitions([...custom, ...custom])).toContain("mais de uma vez");
    expect(validateVariableDefinitions([{ key: "sem_uso", description: "" }])).toContain("Descreva");
    expect(parseVariableDefinitions([{ key: "CONVENIO", description: " Convênio " }, { key: "nome", description: "inválido" }]))
      .toEqual([{ key: "convenio", description: "Convênio" }]);
  });

  it("nunca trata não informado como valor", () => {
    expect(parseConversationVariables({ nome: " Alcides ", endereco: "", convenio: 12 }))
      .toEqual({ nome: "Alcides" });
    const context = variablesSystemContext(custom, { nome: "Alcides" });
    expect(context).toContain('{{endereco}}: Endereço informado');
    expect(context).toContain('"não informado"');
    expect(context).toContain("Nunca envie tokens");
  });
});

describe("valores por conversa", () => {
  it("o agente recebe a ferramenta com as definições e consegue guardar a variável", async () => {
    const schema = getToolSchemas([], undefined, custom).find((tool) => tool.name === "remember_variables");
    expect(schema).toBeDefined();
    const values = (schema?.parameters.properties as Record<string, { properties: Record<string, unknown> }>).values.properties;
    expect(values).toHaveProperty("convenio");
    expect(values).not.toHaveProperty("numero");

    const result = await runToolHandler("remember_variables", {
      tenantId: "tenant-1", conversationId: "conv-1", leadId: "lead-1", agentId: "agent-1",
    }, { values: { convenio: "Plano Azul" } });
    expect(result).toContain("{{convenio}}");
    expect(db.agent.findFirst).toHaveBeenCalledWith({
      where: { id: "agent-1", tenantId: "tenant-1" }, select: { variableDefinitions: true },
    });
  });

  it("inicializa só o número do contato; nome e endereço nascem não informados", async () => {
    const values = await loadConversationVariables("tenant-1", "conv-1");
    // O nome do perfil do WhatsApp não é um dado que o contato informou.
    expect(values).toEqual({ numero: "5514999999999" });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", tenantId: "tenant-1" }, data: { variables: values },
    });
  });

  it("no chat de teste nenhuma variável nasce preenchida", async () => {
    db.conversation.findFirst.mockResolvedValue({
      variables: null, lead: { name: "Chat de teste", phone: "sandbox:agent-1" },
    });
    expect(await loadConversationVariables("tenant-1", "conv-1")).toEqual({});
  });

  it("descarta o número sintético gravado por conversas de teste antigas", async () => {
    db.conversation.findFirst.mockResolvedValue({
      variables: { nome: "Chat de teste", numero: "sandbox" },
      lead: { name: "Chat de teste", phone: "sandbox:agent-1" },
    });
    const values = await loadConversationVariables("tenant-1", "conv-1");
    expect(values).not.toHaveProperty("numero");
  });

  it("mantém o nome que o contato informou, mesmo igual ao do contato", async () => {
    // `remember_variables` grava {{nome}} e atualiza `Lead.name` junto; os dois
    // serem iguais é o normal depois que a pessoa diz o nome, não um resíduo.
    db.conversation.findFirst.mockResolvedValue({
      variables: { nome: "Tangerina" }, lead: { name: "Tangerina", phone: "5514999999999" },
    });
    expect(await loadConversationVariables("tenant-1", "conv-1"))
      .toEqual({ nome: "Tangerina", numero: "5514999999999" });
  });

  it("guarda apenas chaves configuradas e preserva dados anteriores", async () => {
    db.conversation.findFirst.mockResolvedValue({
      variables: { endereco: "Rua A" }, lead: { name: "Alcides", phone: "5514999999999" },
    });
    const result = await rememberConversationVariables({
      tenantId: "tenant-1", conversationId: "conv-1", definitions: custom,
      values: { convenio: "Plano Azul" },
    });
    expect(result).toContain("{{convenio}}");
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", tenantId: "tenant-1" },
      data: { variables: { numero: "5514999999999", endereco: "Rua A", convenio: "Plano Azul" } },
    });
  });

  it("recusa campo não definido ou vazio sem sobrescrever valor conhecido", async () => {
    expect(await rememberConversationVariables({ tenantId: "tenant-1", conversationId: "conv-1", definitions: custom, values: { segredo: "x" } }))
      .toContain("não está configurada");
    expect(await rememberConversationVariables({ tenantId: "tenant-1", conversationId: "conv-1", definitions: custom, values: { endereco: "" } }))
      .toContain("Informe um valor");
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("corrige o nome da conversa e do contato", async () => {
    await rememberConversationVariables({ tenantId: "tenant-1", conversationId: "conv-1", definitions: [], values: { nome: "Maria" } });
    expect(db.lead.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", conversation: { id: "conv-1" } }, data: { name: "Maria" },
    });
  });
});

describe("{{numero}} e telefone sintético", () => {
  const saved = { nome: "Alcides", numero: "lixo" };

  it("telefone real vira {{numero}}", () => {
    expect(withContactDefaults({ nome: "Alcides" }, { name: null, phone: "5514999999999" }))
      .toEqual({ nome: "Alcides", numero: "5514999999999" });
  });

  it("simulação do MCP (mcp:) não grava numero e apaga o que já estava lá", () => {
    const phone = "mcp:agent-1:0b6f6c1e-3a4d-4a52-9c9e-2f2c3a1b7d10";
    expect(withContactDefaults({ nome: "Alcides" }, { name: null, phone })).toEqual({ nome: "Alcides" });
    expect(withContactDefaults(saved, { name: null, phone })).toEqual({ nome: "Alcides" });
  });

  it("chat de teste (sandbox) segue igual: sem numero", () => {
    expect(withContactDefaults(saved, { name: null, phone: "sandbox" })).toEqual({ nome: "Alcides" });
    expect(withContactDefaults(saved, { name: null, phone: "sandbox:agent-1" })).toEqual({ nome: "Alcides" });
  });

  it("loadConversationVariables devolve ao prompt sem o numero sintético já gravado", async () => {
    db.conversation.findFirst.mockResolvedValue({
      variables: { nome: "Alcides", numero: "mcp:agent-1:abc" },
      lead: { name: null, phone: "mcp:agent-1:abc" },
    });
    expect(await loadConversationVariables("tenant-1", "conv-1")).toEqual({ nome: "Alcides" });
  });
});
