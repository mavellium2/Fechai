import { prisma } from "@/lib/prisma";
import { agentBaseHash, applyPersonaAnswers } from "@/modules/agent-engine/persona-apply";
import { recordAudit } from "@/modules/audit/log";
import { effectiveStatus, parseStoredSide, PROPOSAL_STATUS_LABELS } from "./proposals";

/**
 * Decisão do superadmin sobre uma proposta: aprovar (aplica) ou recusar.
 *
 * É AQUI, e só aqui, que uma proposta do MCP vira mudança no agente — e só
 * chamada por actions que passaram por `requireSuperadmin`. O módulo não checa
 * sessão: o ator chega pronto e a checagem fica na borda (as actions).
 *
 * A proposta é "reivindicada" por um `updateMany` condicional (`status:
 * "pending"`), então duas aprovações simultâneas, ou aprovar duas vezes, só
 * deixam uma passar. O claim e a gravação do agente rodam na mesma transação. Antes disso, três recusas sem gravar nada no agente:
 * vencida (`expired`), agente mudou desde a proposta (`stale`) e já decidida.
 */

export type DecisionActor = { id: string; email: string | null };
export type DecisionResult = { ok: true; info: string } | { ok: false; error: string };

export const MAX_REJECT_REASON_CHARS = 1000;

const NOT_FOUND = "Proposta não encontrada.";

/** Proposta desatualizada: ninguém a aplicou, então não tem decisor nem data de aplicação. */
const STALE_DATA = { status: "stale", decidedById: null, decidedByEmail: null, decidedAt: null, appliedAt: null } as const;

async function tokenPrefixOf(tenantId: string, tokenId: string): Promise<string | null> {
  try {
    const token = await prisma.mcpToken.findFirst({ where: { id: tokenId, tenantId }, select: { tokenPrefix: true } });
    return token?.tokenPrefix ?? null;
  } catch {
    return null;
  }
}

function alreadyDecided(status: keyof typeof PROPOSAL_STATUS_LABELS): DecisionResult {
  return { ok: false, error: `Esta proposta já está ${PROPOSAL_STATUS_LABELS[status]}; nada foi gravado.` };
}

export async function approveProposal(proposalId: string, actor: DecisionActor, now: Date = new Date()): Promise<DecisionResult> {
  const proposal = await prisma.agentChangeProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, error: NOT_FOUND };
  const { tenantId, agentId } = proposal;

  const status = effectiveStatus(proposal, now);
  if (status === "expired" && proposal.status === "pending") {
    await prisma.agentChangeProposal.updateMany({ where: { id: proposal.id, tenantId, status: "pending" }, data: { status: "expired" } });
    return { ok: false, error: "A proposta venceu sem decisão; nada foi gravado. Peça uma nova." };
  }
  if (status !== "pending") return alreadyDecided(status);

  const after = parseStoredSide(proposal.after);
  if (!after) return { ok: false, error: "Proposta ilegível; nada foi gravado." };

  // O agente precisa estar como estava quando a proposta foi feita.
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
    select: { name: true, systemPrompt: true, objective: true, personaDraft: true, archived: true },
  });
  if (!agent || agent.archived || agentBaseHash(agent) !== proposal.baseHash) {
    await prisma.agentChangeProposal.updateMany({ where: { id: proposal.id, tenantId, status: "pending" }, data: STALE_DATA });
    return {
      ok: false,
      error: "O agente mudou depois desta proposta (ou não existe mais). Nada foi gravado; peça uma nova proposta a partir da versão atual.",
    };
  }

  const decidedAt = now;
  const tokenPrefix = await tokenPrefixOf(tenantId, proposal.tokenId);

  // Reivindicar a proposta e gravar o agente é UMA transação: se o processo cai ou a
  // gravação lança, o claim desfaz junto e a proposta continua `pending` (nunca fica
  // "aplicada" sem ter aplicado). Duas aprovações concorrentes: a segunda espera o
  // lock da linha da proposta, vê `applied` e perde o claim (count 0).
  const outcome = await prisma.$transaction(async (tx) => {
    const claim = await tx.agentChangeProposal.updateMany({
      where: { id: proposal.id, tenantId, status: "pending" },
      data: { status: "applied", decidedById: actor.id, decidedByEmail: actor.email, decidedAt, appliedAt: decidedAt },
    });
    if (claim.count === 0) return { kind: "lost" } as const;

    const applied = await applyPersonaAnswers(
      tenantId,
      agentId,
      after.persona,
      { id: actor.id, email: actor.email, role: "SUPERADMIN" },
      { expectedBaseHash: proposal.baseHash, meta: { via: "mcp", proposalId: proposal.id, tokenPrefix }, tx },
    );
    if (!applied.ok) {
      // O agente mudou entre a conferência e a gravação (ou sumiu): nada foi gravado.
      // Ninguém aplicou, então a proposta não guarda decisor.
      await tx.agentChangeProposal.updateMany({
        where: { id: proposal.id, tenantId, status: "applied" },
        data: STALE_DATA,
      });
      return { kind: "stale" } as const;
    }
    return { kind: "applied", audit: applied.audit } as const;
  });

  if (outcome.kind === "lost") return { ok: false, error: "Esta proposta já foi decidida por outra pessoa; nada foi gravado." };
  if (outcome.kind === "stale") {
    return { ok: false, error: "O agente mudou enquanto a proposta era aplicada. Nada foi gravado; peça uma nova proposta." };
  }

  // Auditoria só depois do commit (nunca lança).
  await outcome.audit();
  return { ok: true, info: "Proposta aplicada ao agente." };
}

export async function rejectProposal(
  proposalId: string,
  reason: string,
  actor: DecisionActor,
  now: Date = new Date(),
): Promise<DecisionResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "Explique o motivo da recusa." };
  if (trimmed.length > MAX_REJECT_REASON_CHARS) {
    return { ok: false, error: `O motivo pode ter até ${MAX_REJECT_REASON_CHARS} caracteres.` };
  }

  const proposal = await prisma.agentChangeProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, tenantId: true, agentId: true, tokenId: true, status: true, expiresAt: true },
  });
  if (!proposal) return { ok: false, error: NOT_FOUND };

  const status = effectiveStatus(proposal, now);
  if (status !== "pending") return alreadyDecided(status);

  const claim = await prisma.agentChangeProposal.updateMany({
    where: { id: proposal.id, tenantId: proposal.tenantId, status: "pending" },
    data: { status: "rejected", rejectReason: trimmed, decidedById: actor.id, decidedByEmail: actor.email, decidedAt: now },
  });
  if (claim.count === 0) return { ok: false, error: "Esta proposta já foi decidida por outra pessoa." };

  const tokenPrefix = await tokenPrefixOf(proposal.tenantId, proposal.tokenId);
  await recordAudit({
    event: "agent.change_rejected",
    tenantId: proposal.tenantId,
    actor: { id: actor.id, email: actor.email, role: "SUPERADMIN" },
    target: { type: "AgentChangeProposal", id: proposal.id },
    after: { status: "rejected", rejectReason: trimmed },
    meta: { via: "mcp", proposalId: proposal.id, tokenPrefix },
  });

  return { ok: true, info: "Proposta recusada. O agente não foi alterado." };
}
