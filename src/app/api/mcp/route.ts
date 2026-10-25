import { handleMcpPost } from "@/modules/agent-mcp/rpc";

// A rota lê o banco e o Redis a cada chamada: nada de cache nem Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Servidor MCP do agente (JSON-RPC sobre HTTP, sem estado). Autenticação por
 * `Authorization: Bearer <token>`; a conta sai do token, nunca da requisição.
 * Regras em `src/modules/agent-mcp/README.md`.
 */
export async function POST(request: Request): Promise<Response> {
  return handleMcpPost(request);
}

/** Sem stream de servidor (SSE): o cliente que sondar com GET recebe 405. */
export async function GET(): Promise<Response> {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
