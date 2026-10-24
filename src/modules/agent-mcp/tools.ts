import { z } from "zod";
import type { McpScope } from "./tokens";
import { getAgentConfigForMcp, listAgentsForMcp } from "./read";

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

/** Falha esperada de uma ferramenta: vira `isError` no resultado, não erro de protocolo. */
export class McpToolError extends Error {}

export type McpTool = {
  name: string;
  description: string;
  scope: McpScope;
  /** JSON Schema anunciado em `tools/list`. */
  inputSchema: Record<string, unknown>;
  input: z.ZodType<Record<string, unknown>>;
  run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

const listAgentsInput = z.object({}).strict();
const getAgentConfigInput = z.object({ agentId: z.string().trim().min(1).max(64) }).strict();

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
];

export function findMcpTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
