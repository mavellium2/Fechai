import { prisma } from "@/lib/prisma";
import { hashMcpToken, isMcpScope, MCP_TOKEN_PATTERN, type McpScope } from "./tokens";

/**
 * Autenticação da rota MCP.
 *
 * O token vem SÓ do header `Authorization: Bearer <token>`. Query string fica
 * de fora: URL vai para log de proxy, histórico e Referer, e um token ali
 * vazaria sem ninguém ter feito nada de errado.
 *
 * Esta função devolve o tenant — e ele só sai do registro do token. Nada que o
 * chamador mande no corpo (nem `tenantId`, nem `agentId`) escolhe a conta.
 */

export type McpAuth = {
  tenantId: string;
  tokenId: string;
  scopes: McpScope[];
};

export type McpAuthFailure = {
  ok: false;
  /** 401 = não autenticado (token ausente/ruim/vencido/revogado); 403 = sem permissão. */
  status: 401 | 403;
  /** Mensagem curta e genérica: não diz se o token existe, venceu ou foi revogado. */
  message: string;
};

export type McpAuthResult = ({ ok: true } & McpAuth) | McpAuthFailure;

const UNAUTHORIZED: McpAuthFailure = {
  ok: false,
  status: 401,
  message: "Token ausente, inválido, vencido ou revogado.",
};

const BEARER = /^Bearer[ \t]+(\S+)$/i;

/** Extrai o token do header. `null` = sem header ou fora do formato. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  if (!match) return null;
  return MCP_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

export async function authenticateMcp(
  request: Request,
  options: { now?: Date } = {},
): Promise<McpAuthResult> {
  const token = bearerToken(request);
  if (!token) return UNAUTHORIZED;

  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    select: {
      id: true,
      tenantId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      tenant: { select: { status: true } },
    },
  });
  if (!row) return UNAUTHORIZED;

  const now = options.now ?? new Date();
  if (row.revokedAt) return UNAUTHORIZED;
  if (row.expiresAt.getTime() <= now.getTime()) return UNAUTHORIZED;

  // Conta suspensa pelo admin não atende nem por esta porta.
  if (row.tenant?.status !== "active") {
    return { ok: false, status: 403, message: "A conta está suspensa." };
  }

  // Marcar o uso é observação: se falhar, a chamada segue.
  try {
    await prisma.mcpToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  } catch (error) {
    console.error("[agent-mcp] não foi possível registrar lastUsedAt", error);
  }

  return {
    ok: true,
    tenantId: row.tenantId,
    tokenId: row.id,
    scopes: row.scopes.filter(isMcpScope),
  };
}

/** `null` = tem o escopo; senão, a falha 403 pronta para responder. */
export function missingScope(auth: Pick<McpAuth, "scopes">, scope: McpScope): McpAuthFailure | null {
  if (auth.scopes.includes(scope)) return null;
  return { ok: false, status: 403, message: `Este token não tem a permissão "${scope}".` };
}
