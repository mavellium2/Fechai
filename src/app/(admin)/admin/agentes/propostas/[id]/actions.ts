"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/session";
import { approveProposal, rejectProposal, type DecisionResult } from "@/modules/agent-mcp/proposal-decision";

/**
 * Decisão sobre uma proposta de mudança do agente (MCP). Só superadmin, e a
 * checagem é repetida a cada chamada: esconder o botão não autoriza a action.
 * A regra (vencida, desatualizada, decidida duas vezes) mora em
 * `proposal-decision.ts`; aqui ficam a sessão e a revalidação.
 */

const idSchema = z.string().min(1).max(64);

function revalidate(proposalId: string) {
  revalidatePath(`/admin/agentes/propostas/${proposalId}`);
  revalidatePath("/admin/logs");
  revalidatePath("/agentes");
}

export async function approveProposalAction(input: { proposalId: string }): Promise<DecisionResult> {
  const session = await requireSuperadmin();
  const id = idSchema.safeParse(input?.proposalId);
  if (!id.success) return { ok: false, error: "Proposta inválida." };

  const result = await approveProposal(id.data, { id: session.user.id, email: session.user.email ?? null });
  revalidate(id.data);
  return result;
}

export async function rejectProposalAction(input: { proposalId: string; reason: string }): Promise<DecisionResult> {
  const session = await requireSuperadmin();
  const id = idSchema.safeParse(input?.proposalId);
  if (!id.success) return { ok: false, error: "Proposta inválida." };
  if (typeof input.reason !== "string") return { ok: false, error: "Explique o motivo da recusa." };

  const result = await rejectProposal(id.data, input.reason, { id: session.user.id, email: session.user.email ?? null });
  revalidate(id.data);
  return result;
}
