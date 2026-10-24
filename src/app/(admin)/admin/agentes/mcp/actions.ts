"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { requireSuperadmin } from "@/lib/session";
import { recordAudit } from "@/modules/audit/log";
import { issueMcpToken, revokeMcpToken, validateIssueInput } from "@/modules/agent-mcp/tokens";

/**
 * Emissão e revogação dos tokens da rota MCP. Só superadmin — e a checagem é
 * repetida a cada chamada: esconder a tela não autoriza a action.
 */

export type IssueMcpTokenActionResult =
  | {
      ok: true;
      /** Em claro, uma única vez. A tela mostra e esquece; nada disto é guardado. */
      token: string;
      label: string;
      tenantName: string;
      expiresAt: string;
    }
  | { ok: false; error: string };

export type RevokeMcpTokenActionResult = { ok: true } | { ok: false; error: string };

const issueSchema = z.object({
  tenantId: z.string().min(1).max(64),
  label: z.string().max(200),
  scopes: z.array(z.string().max(32)).max(10),
  ttlDays: z.number().int().optional(),
});

export async function issueMcpTokenAction(input: {
  tenantId: string;
  label: string;
  scopes: string[];
  ttlDays?: number;
}): Promise<IssueMcpTokenActionResult> {
  const session = await requireSuperadmin();
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Preencha a conta, o nome e as permissões." };

  const valid = validateIssueInput(parsed.data);
  if (!valid.ok) return valid;

  if (!(await rateLimit("mcp-token-issue", session.user.id, 10, 60)).allowed) {
    return { ok: false, error: "Aguarde um minuto antes de emitir outro token." };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: parsed.data.tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };

  const result = await issueMcpToken({
    tenantId: tenant.id,
    label: valid.label,
    scopes: valid.scopes,
    ttlDays: valid.ttlDays,
    createdById: session.user.id,
    createdByEmail: session.user.email,
  });
  if (!result.ok) return result;

  // O log guarda o que identifica o token (id, prefixo, permissões, validade),
  // nunca o token em claro nem o hash.
  await recordAudit({
    event: "mcp.token_issued",
    tenantId: tenant.id,
    target: { type: "McpToken", id: result.issued.id, label: valid.label },
    after: {
      label: valid.label,
      prefix: result.issued.tokenPrefix,
      scopes: result.issued.scopes,
      expiresAt: result.issued.expiresAt.toISOString(),
    },
  });

  revalidatePath("/admin/agentes/mcp");
  revalidatePath("/admin/logs");
  return {
    ok: true,
    token: result.issued.token,
    label: valid.label,
    tenantName: tenant.name,
    expiresAt: result.issued.expiresAt.toISOString(),
  };
}

export async function revokeMcpTokenAction(input: {
  tenantId: string;
  tokenId: string;
}): Promise<RevokeMcpTokenActionResult> {
  const session = await requireSuperadmin();
  const parsed = z
    .object({ tenantId: z.string().min(1).max(64), tokenId: z.string().min(1).max(64) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Token inválido." };

  const result = await revokeMcpToken({
    tenantId: parsed.data.tenantId,
    tokenId: parsed.data.tokenId,
    revokedById: session.user.id,
  });
  if (!result.ok) return result;

  await recordAudit({
    event: "mcp.token_revoked",
    tenantId: parsed.data.tenantId,
    target: { type: "McpToken", id: parsed.data.tokenId, label: result.label },
  });

  revalidatePath("/admin/agentes/mcp");
  revalidatePath("/admin/logs");
  return { ok: true };
}
