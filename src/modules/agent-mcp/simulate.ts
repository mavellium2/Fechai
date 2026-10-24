import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { runAgentTurn, type TurnStatus } from "@/modules/agent-engine/orchestrator";
import { maskText } from "@/modules/knowledge-gaps/mask";
import { McpRateLimitedError, McpToolError } from "./errors";

/**
 * Simulação de conversa pelo MCP (escopo `simulate`).
 *
 * Roda o MESMO motor do chat de teste (`runAgentTurn`), com as três travas do
 * teste ligadas: sem cota, com o agente desligado e com a agenda em simulação.
 * Nada aqui toca em provedor de WhatsApp — quem envia é o webhook/worker, que a
 * simulação não alcança — e a conversa nasce `isTest: true`, o que a deixa fora de
 * cota, relatórios, lembretes, follow-up e pesquisa de satisfação (todos filtram
 * por `isTest`). Regras em `README.md`.
 */

export const SIMULATION_PHONE_PREFIX = "mcp:";
export const MAX_SIMULATION_TURNS = 10;
export const MAX_SIMULATION_MESSAGE_CHARS = 1000;
/** Turnos de simulação por token. Cada turno custa uma chamada de LLM. */
export const SIMULATION_LIMIT = { max: 30, windowSeconds: 10 * 60 } as const;
export const SIMULATION_VARIANTS = ["current", "proposal", "both"] as const;
export type SimulationVariant = (typeof SIMULATION_VARIANTS)[number];

const PROPOSAL_UNAVAILABLE = "Variante disponível após a aprovação de propostas.";
const AGENT_NOT_FOUND = "Agente não encontrado nesta conta.";
const SIMULATION_NOT_FOUND = "Simulação não encontrada nesta conta.";
const PHONE_PATTERN = /^mcp:([^:]+):([^:]+)$/;

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
  runs: { variant: "current"; turns: SimulationTurn[] }[];
  dryRun: true;
};

/** O que sai de uma conversa passa pela máscara (e-mail, telefone, nome). */
function safe(text: string): string {
  return maskText(text);
}

/** Reserva um turno de saldo por mensagem ANTES de rodar qualquer coisa. */
async function reserveTurns(tokenId: string, turns: number): Promise<void> {
  for (let i = 0; i < turns; i++) {
    const limited = await rateLimit("mcp:simulate", tokenId, SIMULATION_LIMIT.max, SIMULATION_LIMIT.windowSeconds);
    if (!limited.allowed) {
      throw new McpRateLimitedError(
        `Limite de ${SIMULATION_LIMIT.max} turnos de simulação a cada ${SIMULATION_LIMIT.windowSeconds / 60} minutos atingido.`,
        limited.retryAfterSeconds,
      );
    }
  }
}

export async function runSimulation(
  ctx: { tenantId: string; tokenId: string },
  input: { agentId: string; messages: string[]; variant: SimulationVariant },
): Promise<SimulationResult> {
  // A variante "proposta" depende de propostas aprovadas (parte C). O enum já
  // está no schema para a API não mudar; aqui só a atual roda.
  if (input.variant !== "current") throw new McpToolError(PROPOSAL_UNAVAILABLE);

  // `tenantId` do token na consulta: id de outra conta responde igual a inexistente.
  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, tenantId: ctx.tenantId, archived: false },
    select: { id: true },
  });
  if (!agent) throw new McpToolError(AGENT_NOT_FOUND);

  await reserveTurns(ctx.tokenId, input.messages.length);

  const simulationId = randomUUID();
  const { lead, conversation } = await getOrCreateConversation(
    ctx.tenantId,
    `${SIMULATION_PHONE_PREFIX}${agent.id}:${simulationId}`,
    "Simulação MCP",
    { isTest: true },
  );

  const turns: SimulationTurn[] = [];
  for (const message of input.messages) {
    try {
      const turn = await runAgentTurn({
        tenantId: ctx.tenantId,
        conversationId: conversation.id,
        leadId: lead.id,
        userMessage: message,
        agentId: agent.id,
        // Mesmas três travas do chat de teste (`/api/sandbox`).
        skipUsageCheck: true,
        skipEnabledCheck: true,
        dryRunScheduling: true,
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

  return { simulationId, runs: [{ variant: "current", turns }], dryRun: true };
}

export type StoredSimulation = {
  simulationId: string;
  agentId: string;
  runs: { variant: "current"; turns: { user: string; reply: string | null }[] }[];
  dryRun: true;
};

/**
 * Relê o transcript de uma simulação. Só conversas de teste com telefone `mcp:` da
 * conta do token; id de outra conta, de conversa real ou do chat de teste do
 * painel respondem igual a inexistente. O banco guarda as falas, não as
 * ferramentas nem o status de cada turno — esses só vêm no retorno de
 * `run_simulation`.
 */
export async function getSimulation(tenantId: string, simulationId: string): Promise<StoredSimulation> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      isTest: true,
      lead: {
        tenantId,
        isTest: true,
        phone: { startsWith: SIMULATION_PHONE_PREFIX, endsWith: `:${simulationId}` },
      },
    },
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
  // Confere de novo o formato exato: o filtro acima é só o caminho do índice.
  const match = PHONE_PATTERN.exec(conversation?.lead?.phone ?? "");
  if (!conversation || !match || match[2] !== simulationId) throw new McpToolError(SIMULATION_NOT_FOUND);

  const turns: { user: string; reply: string | null }[] = [];
  for (const message of conversation.messages) {
    if (message.role === "user") {
      turns.push({ user: safe(message.content), reply: null });
    } else {
      const last = turns[turns.length - 1];
      if (last && last.reply === null) last.reply = safe(message.content);
    }
  }
  return { simulationId, agentId: match[1], runs: [{ variant: "current", turns }], dryRun: true };
}
