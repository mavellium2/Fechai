import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { rateLimitReserve } from "@/lib/rate-limit";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { runAgentTurn, type TurnStatus } from "@/modules/agent-engine/orchestrator";
import { maskText } from "@/modules/knowledge-gaps/mask";
import { McpRateLimitedError, McpToolError } from "./errors";
import { proposalPromptOverride } from "./proposals";

/**
 * Simulação de conversa pelo MCP (escopo `simulate`).
 *
 * Roda o MESMO motor do chat de teste (`runAgentTurn`), com as três travas do
 * teste ligadas: sem cota, com o agente desligado e com a agenda em simulação.
 * Nada aqui toca em provedor de WhatsApp — quem envia é o webhook/worker, que a
 * simulação não alcança — e a conversa nasce `isTest: true`, o que a deixa fora de
 * cota, relatórios, lembretes, follow-up e pesquisa de satisfação (todos filtram
 * por `isTest`). Regras em `README.md`.
 *
 * Variante `proposal`: o mesmo turno, com o prompt do agente trocado pelo da
 * proposta pendente (`systemPromptOverride`, só naquele turno). Nada é gravado
 * no agente.
 */

export const SIMULATION_PHONE_PREFIX = "mcp:";
export const MAX_SIMULATION_TURNS = 10;
export const MAX_SIMULATION_MESSAGE_CHARS = 1000;
/** Turnos de simulação por token. Cada turno custa uma chamada de LLM. */
export const SIMULATION_LIMIT = { max: 30, windowSeconds: 10 * 60 } as const;
export const SIMULATION_VARIANTS = ["current", "proposal", "both"] as const;
export type SimulationVariant = (typeof SIMULATION_VARIANTS)[number];
type RunVariant = "current" | "proposal";

const PROPOSAL_ID_REQUIRED = "Informe proposalId (devolvido por propose_change) para simular a proposta.";
const PROPOSAL_ID_UNUSED = 'proposalId só vale com variant "proposal" ou "both".';
const PROPOSAL_NEEDS_PROPOSE = "Simular uma proposta exige as permissões simulate e propose no token.";
const AGENT_NOT_FOUND = "Agente não encontrado nesta conta.";
const SIMULATION_NOT_FOUND = "Simulação não encontrada nesta conta.";
/** `mcp:<agente>:<simulação>`; a rodada da proposta leva `:proposal` no fim. */
const PHONE_PATTERN = /^mcp:([^:]+):([^:]+)$/;
const PROPOSAL_PHONE_SUFFIX = ":proposal";
const PROPOSAL_PHONE_PATTERN = /^mcp:([^:]+):([^:]+):proposal$/;

export type SimulationTurn = {
  user: string;
  reply: string;
  /** Só os nomes das ferramentas — nunca argumentos nem resultados. */
  toolsUsed: string[];
  /** `error` = o turno falhou por dentro; a simulação para aí. */
  status: TurnStatus | "error";
};

export type SimulationResult = {
  simulationId: string;
  /** Cada rodada vem rotulada pela variante: `current` (como está) e/ou `proposal` (com a proposta). */
  runs: { variant: RunVariant; turns: SimulationTurn[] }[];
  dryRun: true;
};

/** O que sai de uma conversa passa pela máscara (e-mail, telefone e documento). */
function safe(text: string): string {
  return maskText(text);
}

/**
 * Reserva o saldo do pedido inteiro ANTES de rodar qualquer coisa, numa operação
 * só (`INCRBY n`). Se não cabe, as `n` voltam (`DECRBY n`) e responde 429: o
 * saldo parcial segue disponível para um pedido menor.
 */
async function reserveTurns(tokenId: string, turns: number): Promise<void> {
  const limited = await rateLimitReserve("mcp:simulate", tokenId, SIMULATION_LIMIT.max, SIMULATION_LIMIT.windowSeconds, turns);
  if (!limited.allowed) {
    throw new McpRateLimitedError(
      `Limite de ${SIMULATION_LIMIT.max} turnos de simulação a cada ${SIMULATION_LIMIT.windowSeconds / 60} minutos atingido.`,
      limited.retryAfterSeconds,
    );
  }
}

export async function runSimulation(
  ctx: { tenantId: string; tokenId: string; scopes?: readonly string[] },
  input: { agentId: string; messages: string[]; variant: SimulationVariant; proposalId?: string },
): Promise<SimulationResult> {
  const variants: RunVariant[] = input.variant === "both" ? ["current", "proposal"] : [input.variant];
  const wantsProposal = variants.includes("proposal");
  if (wantsProposal && !input.proposalId) throw new McpToolError(PROPOSAL_ID_REQUIRED);
  if (!wantsProposal && input.proposalId) throw new McpToolError(PROPOSAL_ID_UNUSED);
  // O conteúdo da proposta é do escopo `propose`: quem só simula não o alcança.
  if (wantsProposal && !ctx.scopes?.includes("propose")) throw new McpToolError(PROPOSAL_NEEDS_PROPOSE);

  // `tenantId` do token na consulta: id de outra conta responde igual a inexistente.
  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, tenantId: ctx.tenantId, archived: false },
    select: { id: true },
  });
  if (!agent) throw new McpToolError(AGENT_NOT_FOUND);

  // Pendente, no prazo e em cima do mesmo estado do agente — antes de qualquer custo.
  const proposalPrompt =
    wantsProposal && input.proposalId
      ? await proposalPromptOverride(ctx.tenantId, input.proposalId, agent.id)
      : undefined;

  // Cada variante é uma rodada inteira de LLM: o saldo reservado é o do pedido todo.
  await reserveTurns(ctx.tokenId, input.messages.length * variants.length);

  const simulationId = randomUUID();
  const runs: SimulationResult["runs"] = [];
  for (const variant of variants) {
    const suffix = variant === "proposal" ? PROPOSAL_PHONE_SUFFIX : "";
    const { lead, conversation } = await getOrCreateConversation(
      ctx.tenantId,
      `${SIMULATION_PHONE_PREFIX}${agent.id}:${simulationId}${suffix}`,
      variant === "proposal" ? "Simulação MCP (proposta)" : "Simulação MCP",
      { isTest: true },
    );
    runs.push({
      variant,
      turns: await runTurns({
        tenantId: ctx.tenantId,
        agentId: agent.id,
        conversationId: conversation.id,
        leadId: lead.id,
        messages: input.messages,
        systemPromptOverride: variant === "proposal" ? proposalPrompt : undefined,
      }),
    });
  }

  return { simulationId, runs, dryRun: true };
}

async function runTurns(params: {
  tenantId: string;
  agentId: string;
  conversationId: string;
  leadId: string;
  messages: string[];
  systemPromptOverride?: string;
}): Promise<SimulationTurn[]> {
  const turns: SimulationTurn[] = [];
  for (const message of params.messages) {
    try {
      const turn = await runAgentTurn({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        leadId: params.leadId,
        userMessage: message,
        agentId: params.agentId,
        // Mesmas três travas do chat de teste (`/api/sandbox`).
        skipUsageCheck: true,
        skipEnabledCheck: true,
        dryRunScheduling: true,
        // Só a variante `proposal`: o prompt da proposta vale neste turno e nada é gravado no agente.
        ...(params.systemPromptOverride ? { systemPromptOverride: params.systemPromptOverride } : {}),
      });
      turns.push({
        user: safe(message),
        reply: safe(turn.reply),
        toolsUsed: turn.toolsUsed.filter((name): name is string => typeof name === "string"),
        status: turn.status,
      });
      // Calado (agente sem resposta, IA fora do ar): os próximos turnos não
      // teriam o que o primeiro não teve.
      if (turn.status !== "ok") break;
    } catch (error) {
      // Detalhe técnico só no log; o cliente recebe o status.
      console.error("[agent-mcp] turno de simulação falhou", error);
      turns.push({ user: safe(message), reply: "", toolsUsed: [], status: "error" });
      break;
    }
  }
  return turns;
}

export type StoredSimulation = {
  simulationId: string;
  agentId: string;
  runs: { variant: RunVariant; turns: { user: string; reply: string | null }[] }[];
  dryRun: true;
};

type StoredConversation = {
  lead: { phone: string } | null;
  messages: { role: string; content: string }[];
};

async function readConversation(
  tenantId: string,
  phone: { startsWith: string; endsWith: string },
): Promise<StoredConversation | null> {
  return prisma.conversation.findFirst({
    where: { tenantId, isTest: true, lead: { tenantId, isTest: true, phone } },
    select: {
      lead: { select: { phone: true } },
      messages: {
        where: { role: { in: ["user", "assistant"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_SIMULATION_TURNS * 4,
        select: { role: true, content: true },
      },
    },
  });
}

function transcript(messages: { role: string; content: string }[]): { user: string; reply: string | null }[] {
  const turns: { user: string; reply: string | null }[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ user: safe(message.content), reply: null });
    } else {
      const last = turns[turns.length - 1];
      if (last && last.reply === null) last.reply = safe(message.content);
    }
  }
  return turns;
}

/**
 * Relê o transcript de uma simulação. Só conversas de teste com telefone `mcp:` da
 * conta do token; id de outra conta, de conversa real ou do chat de teste do
 * painel respondem igual a inexistente. O banco guarda as falas, não as
 * ferramentas nem o status de cada turno — esses só vêm no retorno de
 * `run_simulation`. A rodada da proposta (`:proposal`) só sai para token com o
 * escopo `propose` (`includeProposal`).
 */
export async function getSimulation(
  tenantId: string,
  simulationId: string,
  options: { includeProposal?: boolean } = {},
): Promise<StoredSimulation> {
  const current = await readConversation(tenantId, {
    startsWith: SIMULATION_PHONE_PREFIX,
    endsWith: `:${simulationId}`,
  });
  const proposal = options.includeProposal
    ? await readConversation(tenantId, {
        startsWith: SIMULATION_PHONE_PREFIX,
        endsWith: `:${simulationId}${PROPOSAL_PHONE_SUFFIX}`,
      })
    : null;

  // Confere de novo o formato exato: o filtro acima é só o caminho do índice.
  const currentMatch = PHONE_PATTERN.exec(current?.lead?.phone ?? "");
  const proposalMatch = PROPOSAL_PHONE_PATTERN.exec(proposal?.lead?.phone ?? "");

  const runs: StoredSimulation["runs"] = [];
  let agentId = "";
  if (current && currentMatch && currentMatch[2] === simulationId) {
    agentId = currentMatch[1];
    runs.push({ variant: "current", turns: transcript(current.messages) });
  }
  if (proposal && proposalMatch && proposalMatch[2] === simulationId) {
    agentId = agentId || proposalMatch[1];
    runs.push({ variant: "proposal", turns: transcript(proposal.messages) });
  }
  if (runs.length === 0) throw new McpToolError(SIMULATION_NOT_FOUND);
  return { simulationId, agentId, runs, dryRun: true };
}
