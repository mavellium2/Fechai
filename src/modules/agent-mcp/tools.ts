import { z } from "zod";
import type { McpScope } from "./tokens";
import { McpToolError } from "./errors";
import { getAgentConfigForMcp, listAgentsForMcp } from "./read";
import {
  getSimulation,
  MAX_SIMULATION_MESSAGE_CHARS,
  MAX_SIMULATION_TURNS,
  runSimulation,
  SIMULATION_VARIANTS,
} from "./simulate";

/**
 * Ferramentas da rota MCP.
 *
 * **Nenhuma ferramenta recebe `tenantId`.** A conta vem do token e chega em
 * `ctx`; o esquema de entrada é `.strict()`, então um `tenantId` (ou qualquer
 * argumento que a ferramenta não declarou) volta como parâmetro inválido em vez
 * de ser ignorado em silêncio — ignorar esconderia o cliente tentando escolher
 * a conta.
 */

export type McpToolContext = { tenantId: string; tokenId: string };

export { McpToolError, McpRateLimitedError } from "./errors";

/** Dicas de comportamento anunciadas em `tools/list` (spec MCP). */
export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
};

/** Leitura pura: o padrão das ferramentas `read`. */
export const READ_ONLY_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export type McpTool = {
  name: string;
  description: string;
  scope: McpScope;
  /** Omitido = leitura pura (`READ_ONLY_ANNOTATIONS`). */
  annotations?: McpToolAnnotations;
  /** JSON Schema anunciado em `tools/list`. */
  inputSchema: Record<string, unknown>;
  input: z.ZodType<Record<string, unknown>>;
  run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

const listAgentsInput = z.object({}).strict();
const getAgentConfigInput = z.object({ agentId: z.string().trim().min(1).max(64) }).strict();
const runSimulationInput = z
  .object({
    agentId: z.string().trim().min(1).max(64),
    messages: z.array(z.string().trim().min(1).max(MAX_SIMULATION_MESSAGE_CHARS)).min(1).max(MAX_SIMULATION_TURNS),
    // O enum completo já está na API; "proposal" e "both" chegam na parte C.
    variant: z.enum(SIMULATION_VARIANTS).default("current"),
  })
  .strict();
const getSimulationInput = z
  .object({ simulationId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) })
  .strict();

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_agents",
    description:
      "Lista os agentes da conta do token: id, nome, se é o principal (o que atende o WhatsApp) e se está ligado.",
    scope: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    input: listAgentsInput,
    run: async (ctx) => ({ agents: await listAgentsForMcp(ctx.tenantId) }),
  },
  {
    name: "get_agent_config",
    description:
      "Lê a configuração de um agente: persona, prompt do sistema, comportamento, variáveis, habilidades (com a config de cada uma) e título/tamanho dos documentos da base. Não devolve conversas, contatos, credenciais nem o conteúdo dos documentos.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", description: "Id do agente, como devolvido por list_agents." } },
      required: ["agentId"],
      additionalProperties: false,
    },
    input: getAgentConfigInput,
    run: async (ctx, args) => {
      const config = await getAgentConfigForMcp(ctx.tenantId, args.agentId as string);
      // Id de outra conta e id inexistente respondem igual.
      if (!config) throw new McpToolError("Agente não encontrado nesta conta.");
      return config;
    },
  },
  {
    name: "run_simulation",
    description:
      "Simula uma conversa com um agente: cada item de `messages` é uma fala do contato, na ordem, na mesma conversa (de 1 a " +
      `${MAX_SIMULATION_TURNS}, até ${MAX_SIMULATION_MESSAGE_CHARS} caracteres cada). Devolve a resposta do agente e os nomes das ferramentas usadas em cada turno. ` +
      "É teste: nada é enviado por WhatsApp, a agenda real e os calendários conectados não são alterados, não conta na cota de mensagens nem nos relatórios. " +
      "O agente responde mesmo desligado. A conversa fica gravada como teste (aba Testes de /conversas). " +
      "Por ora só a variante `current` (o agente como está); `proposal` e `both` chegam com a aprovação de propostas. Limite de 30 turnos a cada 10 minutos por token.",
    scope: "simulate",
    // Grava uma conversa de teste e custa uma chamada de LLM por turno: não é leitura pura.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Id do agente, como devolvido por list_agents." },
        messages: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: MAX_SIMULATION_MESSAGE_CHARS },
          minItems: 1,
          maxItems: MAX_SIMULATION_TURNS,
          description: "Falas do contato, em ordem. Uma por turno.",
        },
        variant: {
          type: "string",
          enum: [...SIMULATION_VARIANTS],
          default: "current",
          description: "`current` roda o agente como está. `proposal` e `both` ainda não estão disponíveis.",
        },
      },
      required: ["agentId", "messages"],
      additionalProperties: false,
    },
    input: runSimulationInput,
    run: (ctx, args) =>
      runSimulation(ctx, args as { agentId: string; messages: string[]; variant: (typeof SIMULATION_VARIANTS)[number] }),
  },
  {
    name: "get_simulation",
    description:
      "Relê o transcript de uma simulação feita por run_simulation (falas do contato e respostas do agente). Só simulações desta conta. " +
      "Não traz as ferramentas usadas nem o status de cada turno: isso só vem no retorno de run_simulation.",
    scope: "simulate",
    inputSchema: {
      type: "object",
      properties: { simulationId: { type: "string", description: "Id devolvido por run_simulation." } },
      required: ["simulationId"],
      additionalProperties: false,
    },
    input: getSimulationInput,
    run: (ctx, args) => getSimulation(ctx.tenantId, args.simulationId as string),
  },
];

export function findMcpTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
