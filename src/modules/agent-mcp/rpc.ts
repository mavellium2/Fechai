import { rateLimit } from "@/lib/rate-limit";
import { authenticateMcp, missingScope, type McpAuth, type McpAuthResult } from "./auth";
import { findMcpTool, McpToolError, MCP_TOOLS } from "./tools";

/**
 * JSON-RPC 2.0 mínimo para o transporte "Streamable HTTP" do MCP, no modo sem
 * estado: cada POST é completo e autentica sozinho (nada de sessão guardada no
 * servidor, então funciona atrás de qualquer número de instâncias).
 *
 * Métodos: `initialize`, `ping`, `tools/list`, `tools/call`. Notificações (sem
 * `id`) respondem 202 sem corpo. Lote (array) não é aceito — a revisão atual do
 * protocolo o removeu.
 */

export const MCP_SERVER_INFO = { name: "fechai-agent-mcp", version: "1.0.0" } as const;
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MAX_MCP_BODY_BYTES = 64 * 1024;

/** Por token. Uma ferramenta de configuração não precisa de mais que isto. */
const TOKEN_LIMIT = { max: 120, windowSeconds: 60 };
/** Falhas de autenticação por IP, para não deixar a rota ser martelada. */
const FAILED_AUTH_LIMIT = { max: 30, windowSeconds: 300 };

const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32001,
  forbidden: -32003,
  rateLimited: -32029,
} as const;

type RpcId = string | number | null;

function rpcError(
  id: RpcId,
  code: number,
  message: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers });
}

function rpcResult(id: RpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "desconhecido";
}

/**
 * Lê o corpo sem passar do teto. `Content-Length` declarado acima do limite é
 * recusado sem ler nada; sem ele (chunked) ou com um valor mentiroso, o stream é
 * lido em pedaços e cancelado assim que a soma passa do teto — o corpo inteiro
 * nunca chega à memória. `null` = grande demais.
 */
export async function readBodyWithinLimit(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function handleMcpPost(request: Request): Promise<Response> {
  // 1. Autentica ANTES de ler o corpo: quem não tem token não gasta nossa memória.
  let auth: McpAuthResult;
  try {
    auth = await authenticateMcp(request);
  } catch (error) {
    console.error("[agent-mcp] falha ao autenticar", error);
    return rpcError(null, RPC.internal, "Erro interno.", 500);
  }
  if (!auth.ok) {
    if (auth.status === 401) {
      const limited = await rateLimit("mcp:auth-fail", clientIp(request), FAILED_AUTH_LIMIT.max, FAILED_AUTH_LIMIT.windowSeconds);
      if (!limited.allowed) {
        return rpcError(null, RPC.rateLimited, "Muitas tentativas. Aguarde antes de tentar de novo.", 429, {
          "Retry-After": String(limited.retryAfterSeconds),
        });
      }
      return rpcError(null, RPC.unauthorized, auth.message, 401, { "WWW-Authenticate": 'Bearer realm="fechai-mcp"' });
    }
    return rpcError(null, RPC.forbidden, auth.message, 403);
  }

  const limited = await rateLimit("mcp:token", auth.tokenId, TOKEN_LIMIT.max, TOKEN_LIMIT.windowSeconds);
  if (!limited.allowed) {
    return rpcError(null, RPC.rateLimited, "Limite de chamadas por minuto atingido.", 429, {
      "Retry-After": String(limited.retryAfterSeconds),
    });
  }

  // 2. Corpo.
  let raw: string | null;
  try {
    raw = await readBodyWithinLimit(request, MAX_MCP_BODY_BYTES);
  } catch {
    return rpcError(null, RPC.parse, "Não foi possível ler o corpo.", 400);
  }
  if (raw === null) {
    return rpcError(null, RPC.invalidRequest, "Corpo grande demais.", 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(null, RPC.parse, "JSON inválido.", 400);
  }
  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(null, RPC.invalidRequest, "Requisição JSON-RPC 2.0 inválida (lote não é aceito).", 400);
  }

  const hasId = "id" in body;
  const id: RpcId = typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
  if (hasId && body.id !== null && typeof body.id !== "string" && typeof body.id !== "number") {
    return rpcError(null, RPC.invalidRequest, "id inválido.", 400);
  }

  // Notificação: nada a responder além de "recebi".
  if (!hasId) return new Response(null, { status: 202 });

  try {
    switch (body.method) {
      case "initialize": {
        const asked = isRecord(body.params) ? body.params.protocolVersion : undefined;
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(asked)
          ? asked
          : MCP_PROTOCOL_VERSIONS[0];
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions:
            "Acesso à configuração dos agentes de UMA conta, definida pelo token. Nenhuma ferramenta aceita o id da conta como argumento.",
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, {
          tools: MCP_TOOLS.filter((tool) => !missingScope(auth, tool.scope)).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          })),
        });
      case "tools/call":
        return await callTool(id, body.params, auth);
      default:
        return rpcError(id, RPC.methodNotFound, `Método desconhecido: ${body.method}`, 200);
    }
  } catch (error) {
    // Detalhe técnico fica no log do servidor; o cliente recebe só a frase.
    console.error("[agent-mcp] erro inesperado", error);
    return rpcError(id, RPC.internal, "Erro interno.", 500);
  }
}

async function callTool(id: RpcId, params: unknown, auth: McpAuth): Promise<Response> {
  if (!isRecord(params) || typeof params.name !== "string") {
    return rpcError(id, RPC.invalidParams, "Informe o nome da ferramenta.", 200);
  }
  const tool = findMcpTool(params.name);
  if (!tool) return rpcError(id, RPC.invalidParams, `Ferramenta desconhecida: ${params.name}`, 200);

  const denied = missingScope(auth, tool.scope);
  if (denied) return rpcError(id, RPC.forbidden, denied.message, 403);

  const parsed = tool.input.safeParse(params.arguments ?? {});
  if (!parsed.success) {
    return rpcError(id, RPC.invalidParams, "Argumentos inválidos para a ferramenta.", 200);
  }

  try {
    const output = await tool.run({ tenantId: auth.tenantId, tokenId: auth.tokenId }, parsed.data);
    return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(output) }], isError: false });
  } catch (error) {
    if (error instanceof McpToolError) {
      return rpcResult(id, { content: [{ type: "text", text: error.message }], isError: true });
    }
    throw error;
  }
}
