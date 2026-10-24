import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Tokens de acesso da rota MCP (`/api/mcp`).
 *
 * O token em claro existe em UM lugar: o retorno de `issueMcpToken`, mostrado
 * uma vez ao superadmin. O banco guarda só o sha256 e um prefixo para a pessoa
 * reconhecer o token na lista. Nada aqui grava nem loga o token em claro — um
 * `console.log(token)` "só para depurar" é um vazamento de credencial.
 *
 * Sha256 puro (sem sal/KDF) é de propósito: o token tem 256 bits de entropia, não
 * é senha digitada, então não há dicionário a atacar — e a busca por hash
 * precisa ser determinística para achar a linha sem varrer a tabela.
 */

export const MCP_SCOPES = ["read", "simulate", "propose"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * Escopos que a EMISSÃO aceita hoje. `MCP_SCOPES` continua com os três porque o
 * schema e a autenticação já os conhecem (parte C), mas na parte A só `read`
 * tem ferramenta: emitir `simulate`/`propose` entregaria um token com permissão
 * que nada usa e que passaria a valer sozinha quando a ferramenta chegasse.
 * Ampliar esta lista é a decisão de liberar o escopo.
 */
export const EMITTABLE_MCP_SCOPES = ["read"] as const satisfies readonly McpScope[];

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  read: "Ler a configuração do agente",
  simulate: "Simular conversas (sem enviar nada)",
  propose: "Propor mudanças (nada é aplicado sozinho)",
};

export const MCP_TOKEN_PREFIX = "fch_mcp_";
/** 32 bytes em base64url, sem preenchimento, são sempre 43 caracteres. */
export const MCP_TOKEN_RANDOM_LENGTH = 43;
export const MCP_TOKEN_PATTERN = new RegExp(`^${MCP_TOKEN_PREFIX}[A-Za-z0-9_-]{${MCP_TOKEN_RANDOM_LENGTH}}$`);

export const MCP_DEFAULT_TTL_DAYS = 30;
export const MCP_MAX_TTL_DAYS = 365;
export const MCP_MAX_LABEL = 80;
/** Caracteres do trecho aleatório que ficam visíveis na lista. */
const DISPLAY_PREFIX_LENGTH = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isMcpScope(value: unknown): value is McpScope {
  return typeof value === "string" && (MCP_SCOPES as readonly string[]).includes(value);
}

export function isEmittableMcpScope(value: unknown): value is McpScope {
  return typeof value === "string" && (EMITTABLE_MCP_SCOPES as readonly string[]).includes(value);
}

export type IssueMcpTokenInput = {
  tenantId: string;
  label: string;
  scopes: readonly string[];
  createdById?: string | null;
  createdByEmail?: string | null;
  /** Padrão: 30 dias. */
  ttlDays?: number;
  now?: Date;
};

export type IssuedMcpToken = {
  id: string;
  /** Em claro, UMA vez. Quem recebe não pode gravar nem logar. */
  token: string;
  tokenPrefix: string;
  scopes: McpScope[];
  expiresAt: Date;
};

export type IssueMcpTokenResult =
  | { ok: true; issued: IssuedMcpToken }
  | { ok: false; error: string };

/** Valida a entrada sem tocar no banco. Devolve a mensagem ou os valores limpos. */
export function validateIssueInput(input: Pick<IssueMcpTokenInput, "label" | "scopes" | "ttlDays">):
  | { ok: true; label: string; scopes: McpScope[]; ttlDays: number }
  | { ok: false; error: string } {
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Dê um nome ao token para reconhecê-lo depois." };
  if (label.length > MCP_MAX_LABEL) return { ok: false, error: `Use até ${MCP_MAX_LABEL} caracteres no nome.` };

  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0) return { ok: false, error: "Escolha pelo menos uma permissão." };
  if (!scopes.every(isMcpScope)) return { ok: false, error: "Permissão desconhecida." };
  if (!scopes.every(isEmittableMcpScope)) {
    return { ok: false, error: "Esta permissão ainda não pode ser emitida. Por enquanto só a leitura da configuração do agente." };
  }

  const ttlDays = input.ttlDays ?? MCP_DEFAULT_TTL_DAYS;
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > MCP_MAX_TTL_DAYS) {
    return { ok: false, error: `A validade vai de 1 a ${MCP_MAX_TTL_DAYS} dias.` };
  }
  return { ok: true, label, scopes, ttlDays };
}

/**
 * Emite um token para UMA conta. `tenantId` vem de quem chama (a action do
 * superadmin, depois de conferir que a conta existe) e fica gravado: é a única
 * origem do tenant nas chamadas MCP seguintes.
 */
export async function issueMcpToken(input: IssueMcpTokenInput): Promise<IssueMcpTokenResult> {
  const valid = validateIssueInput(input);
  if (!valid.ok) return valid;

  const random = randomBytes(32).toString("base64url");
  const token = `${MCP_TOKEN_PREFIX}${random}`;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + valid.ttlDays * DAY_MS);
  const tokenPrefix = random.slice(0, DISPLAY_PREFIX_LENGTH);

  const row = await prisma.mcpToken.create({
    data: {
      tenantId: input.tenantId,
      label: valid.label,
      tokenHash: hashMcpToken(token),
      tokenPrefix,
      scopes: valid.scopes,
      createdById: input.createdById ?? null,
      createdByEmail: input.createdByEmail ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  return { ok: true, issued: { id: row.id, token, tokenPrefix, scopes: valid.scopes, expiresAt } };
}

export type McpTokenSummary = {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  createdByEmail: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

/** Situação para a lista. Revogado vence vencido: é a informação mais forte. */
export function mcpTokenState(
  token: Pick<McpTokenSummary, "revokedAt" | "expiresAt">,
  now = new Date(),
): "active" | "revoked" | "expired" {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

/** Nunca devolve o hash: a tela não precisa dele. */
export async function listMcpTokens(tenantId: string): Promise<McpTokenSummary[]> {
  return prisma.mcpToken.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      tokenPrefix: true,
      scopes: true,
      createdByEmail: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });
}

export type McpTokenAdminRow = McpTokenSummary & { tenantId: string; tenantName: string };

/**
 * Todos os tokens, com o nome da conta — só para a tela do superadmin. As
 * chamadas MCP nunca passam por aqui: elas só enxergam a conta do próprio token.
 */
export async function listAllMcpTokens(): Promise<McpTokenAdminRow[]> {
  const rows = await prisma.mcpToken.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tenantId: true,
      label: true,
      tokenPrefix: true,
      scopes: true,
      createdByEmail: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      tenant: { select: { name: true } },
    },
  });
  return rows.map(({ tenant, ...row }) => ({ ...row, tenantName: tenant.name }));
}

/**
 * Revoga na hora: a autenticação lê `revokedAt` a cada chamada, sem cache.
 * `updateMany` com `tenantId` e `revokedAt: null` no filtro — id de outra conta
 * não atravessa, e revogar de novo não sobrescreve quem revogou primeiro.
 */
export async function revokeMcpToken(input: {
  tenantId: string;
  tokenId: string;
  revokedById?: string | null;
  now?: Date;
}): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const row = await prisma.mcpToken.findFirst({
    where: { id: input.tokenId, tenantId: input.tenantId },
    select: { label: true, revokedAt: true },
  });
  if (!row) return { ok: false, error: "Token não encontrado." };
  if (row.revokedAt) return { ok: false, error: "Este token já foi revogado." };

  const { count } = await prisma.mcpToken.updateMany({
    where: { id: input.tokenId, tenantId: input.tenantId, revokedAt: null },
    data: { revokedAt: input.now ?? new Date(), revokedById: input.revokedById ?? null },
  });
  if (count === 0) return { ok: false, error: "Este token já foi revogado." };
  return { ok: true, label: row.label };
}
