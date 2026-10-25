import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/app-url";
import { composeSystemPrompt, type PersonaAnswers } from "@/modules/agent-engine/persona";
import {
  agentBaseHash,
  answersFromDraft,
  PERSONA_ANSWER_KEYS,
  personaChangesSchema,
} from "@/modules/agent-engine/persona-apply";
import { recordAudit } from "@/modules/audit/log";
import { McpToolError } from "./errors";

/**
 * Propostas de mudança do agente pelo MCP (escopo `propose`).
 *
 * **Nada aqui altera o agente.** `createProposal` só grava uma linha
 * `AgentChangeProposal` `pending`; quem aplica é a aprovação do superadmin
 * (`proposal-decision.ts`), depois de olhar o diff. Regras em `README.md`.
 */

export const PROPOSAL_TTL_DAYS = 7;
/** Propostas pendentes (não vencidas) por agente: o superadmin é quem revisa cada uma. */
export const MAX_PENDING_PROPOSALS_PER_AGENT = 10;
export const MAX_PROPOSAL_REASON_CHARS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PROPOSAL_STATUSES = ["pending", "applied", "rejected", "expired", "stale"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "pendente",
  applied: "aplicada",
  rejected: "recusada",
  expired: "vencida",
  stale: "desatualizada",
};

const AGENT_NOT_FOUND = "Agente não encontrado nesta conta.";
const PROPOSAL_NOT_FOUND = "Proposta não encontrada nesta conta.";

export const proposeChangeInputSchema = z
  .object({
    agentId: z.string().trim().min(1).max(64),
    changes: z.object({ persona: personaChangesSchema.optional() }).strict(),
    reason: z.string().trim().min(1).max(MAX_PROPOSAL_REASON_CHARS),
  })
  .strict();

// ───────────────────────────────────────────────────────────── diff

export type ProposalDiffItem = { field: keyof PersonaAnswers; before: string; after: string };
export type PromptDiffLine = { type: "same" | "add" | "remove"; text: string };

/** Diff por linha (LCS). Prompts têm dezenas de linhas, então O(n·m) basta. */
export function lineDiff(before: string, after: string): PromptDiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: PromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "remove", text: a[i++] });
    } else {
      out.push({ type: "add", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ type: "remove", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

// ───────────────────────────────────────────────────── o que fica no banco

/** `before`/`after` da linha: só os campos de persona que mudam, mais o prompt composto. */
const storedSideSchema = z.object({
  persona: z.record(z.string(), z.string()),
  systemPrompt: z.string(),
});
export type StoredSide = { persona: Partial<PersonaAnswers>; systemPrompt: string };

export function parseStoredSide(value: unknown): StoredSide | null {
  const parsed = storedSideSchema.safeParse(value);
  if (!parsed.success) return null;
  const persona: Partial<PersonaAnswers> = {};
  for (const key of PERSONA_ANSWER_KEYS) {
    const field = parsed.data.persona[key];
    if (typeof field === "string") persona[key] = field;
  }
  return { persona, systemPrompt: parsed.data.systemPrompt };
}

export function diffFromStored(before: StoredSide, after: StoredSide): ProposalDiffItem[] {
  return PERSONA_ANSWER_KEYS.filter((key) => key in after.persona).map((key) => ({
    field: key,
    before: before.persona[key] ?? "",
    after: after.persona[key] ?? "",
  }));
}

/** Pendente que passou do prazo vale como vencida mesmo antes de alguém marcá-la. */
export function effectiveStatus(row: { status: string; expiresAt: Date }, now: Date = new Date()): ProposalStatus {
  const status = (PROPOSAL_STATUSES as readonly string[]).includes(row.status) ? (row.status as ProposalStatus) : "stale";
  if (status === "pending" && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return status;
}

export function proposalPath(proposalId: string): string {
  return `/admin/agentes/propostas/${proposalId}`;
}

async function approveUrl(proposalId: string): Promise<string> {
  try {
    return `${await appBaseUrl()}${proposalPath(proposalId)}`;
  } catch {
    return proposalPath(proposalId);
  }
}

// ──────────────────────────────────────────────────────────── propor

export type ProposeChangeResult = {
  proposalId: string;
  status: "pending";
  diff: ProposalDiffItem[];
  promptDiff: PromptDiffLine[];
  approveUrl: string;
  expiresAt: string;
};

/**
 * Registra a proposta. Não toca em `agent`: só LÊ o agente (com o `tenantId` do
 * token) para guardar o estado de partida e o `baseHash`.
 */
export async function createProposal(
  ctx: { tenantId: string; tokenId: string },
  input: z.infer<typeof proposeChangeInputSchema>,
  now: Date = new Date(),
): Promise<ProposeChangeResult> {
  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, tenantId: ctx.tenantId, archived: false },
    select: { id: true, name: true, systemPrompt: true, objective: true, personaDraft: true },
  });
  if (!agent) throw new McpToolError(AGENT_NOT_FOUND);

  const given = input.changes.persona ?? {};
  if (Object.keys(given).length === 0) {
    throw new McpToolError("Informe ao menos um campo em changes.persona.");
  }

  const base = answersFromDraft(agent.personaDraft);
  const changedKeys = PERSONA_ANSWER_KEYS.filter((key) => given[key] !== undefined && given[key] !== base[key]);
  if (changedKeys.length === 0) {
    throw new McpToolError("A proposta não muda nada: os valores já são os atuais do agente.");
  }

  const after: Partial<PersonaAnswers> = {};
  const before: Partial<PersonaAnswers> = {};
  for (const key of changedKeys) {
    before[key] = base[key];
    after[key] = given[key] as string;
  }
  const merged: PersonaAnswers = { ...base, ...after };
  // A persona de um agente antigo pode estar vazia (prompt escrito à mão):
  // recompor a partir do nada trocaria o prompt inteiro por um genérico.
  if (!merged.businessName) {
    throw new McpToolError(
      "O agente ainda não tem o nome do negócio na persona. Inclua businessName na proposta para o prompt ser recomposto.",
    );
  }

  const pending = await prisma.agentChangeProposal.count({
    where: { tenantId: ctx.tenantId, agentId: agent.id, status: "pending", expiresAt: { gt: now } },
  });
  if (pending >= MAX_PENDING_PROPOSALS_PER_AGENT) {
    throw new McpToolError(
      `Este agente já tem ${MAX_PENDING_PROPOSALS_PER_AGENT} propostas aguardando decisão. Espere a revisão antes de propor outra.`,
    );
  }

  const promptBefore = agent.systemPrompt;
  const promptAfter = composeSystemPrompt(merged);
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_DAYS * DAY_MS);

  const created = await prisma.agentChangeProposal.create({
    data: {
      tenantId: ctx.tenantId,
      agentId: agent.id,
      tokenId: ctx.tokenId,
      status: "pending",
      reason: input.reason,
      before: { persona: before, systemPrompt: promptBefore } satisfies StoredSide as Prisma.InputJsonObject,
      after: { persona: after, systemPrompt: promptAfter } satisfies StoredSide as Prisma.InputJsonObject,
      baseHash: agentBaseHash(agent),
      expiresAt,
    },
    select: { id: true },
  });

  const diff = diffFromStored({ persona: before, systemPrompt: promptBefore }, { persona: after, systemPrompt: promptAfter });

  // O registro identifica o token pelo prefixo; nunca guarda o token nem o hash.
  const token = await prisma.mcpToken
    .findFirst({ where: { id: ctx.tokenId, tenantId: ctx.tenantId }, select: { tokenPrefix: true } })
    .catch(() => null);
  await recordAudit({
    event: "agent.change_proposed",
    tenantId: ctx.tenantId,
    actor: { id: null, email: null, role: "MCP" },
    target: { type: "AgentChangeProposal", id: created.id, label: agent.name },
    after: { agentId: agent.id, reason: input.reason, fields: changedKeys },
    meta: { via: "mcp", proposalId: created.id, tokenPrefix: token?.tokenPrefix ?? null },
  });

  return {
    proposalId: created.id,
    status: "pending",
    diff,
    promptDiff: lineDiff(promptBefore, promptAfter),
    approveUrl: await approveUrl(created.id),
    expiresAt: expiresAt.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────── ler

export type ProposalStatusResult = {
  proposalId: string;
  status: ProposalStatus;
  decidedAt: string | null;
  decidedByRole: "superadmin" | null;
  appliedAt: string | null;
  rejectReason: string | null;
};

/** Só proposta DESTA conta; id de outra conta responde igual a inexistente. */
export async function getProposalStatus(tenantId: string, proposalId: string, now: Date = new Date()): Promise<ProposalStatusResult> {
  const row = await prisma.agentChangeProposal.findFirst({
    where: { id: proposalId, tenantId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      decidedAt: true,
      decidedById: true,
      appliedAt: true,
      rejectReason: true,
    },
  });
  if (!row) throw new McpToolError(PROPOSAL_NOT_FOUND);
  return {
    proposalId: row.id,
    status: effectiveStatus(row, now),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    // Só superadmin decide; o id/e-mail de quem foi não sai pelo MCP.
    decidedByRole: row.decidedById ? "superadmin" : null,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason ?? null,
  };
}

// ───────────────────────────────────────────────────────── simular

/**
 * Prompt do agente COM a proposta aplicada, para a variante `proposal` de
 * `run_simulation`. Recalculado a partir do agente de agora (não do prompt
 * guardado na proposta) e só vale se a proposta está `pending`, no prazo e
 * ainda em cima do mesmo estado do agente.
 */
export async function proposalPromptOverride(
  tenantId: string,
  proposalId: string,
  agentId: string,
  now: Date = new Date(),
): Promise<string> {
  const row = await prisma.agentChangeProposal.findFirst({
    where: { id: proposalId, tenantId },
    select: { id: true, agentId: true, status: true, expiresAt: true, baseHash: true, after: true },
  });
  if (!row) throw new McpToolError(PROPOSAL_NOT_FOUND);
  if (row.agentId !== agentId) throw new McpToolError("Esta proposta é de outro agente.");

  const status = effectiveStatus(row, now);
  if (status !== "pending") {
    throw new McpToolError(`Só dá para simular proposta pendente; esta está ${PROPOSAL_STATUS_LABELS[status]}.`);
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId, archived: false },
    select: { name: true, systemPrompt: true, objective: true, personaDraft: true },
  });
  if (!agent) throw new McpToolError(AGENT_NOT_FOUND);
  if (agentBaseHash(agent) !== row.baseHash) {
    throw new McpToolError("O agente mudou depois desta proposta; faça uma nova proposta a partir da versão atual.");
  }

  const after = parseStoredSide(row.after);
  if (!after) throw new McpToolError("Proposta ilegível; faça uma nova.");
  // Mesma conta que a aprovação faz (`applyPersonaAnswers`).
  return composeSystemPrompt({ ...answersFromDraft(agent.personaDraft), ...after.persona });
}
