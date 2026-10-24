import { prisma } from "@/lib/prisma";
import { ACTION_BY_KEY, AVAILABLE_ACTIONS } from "@/modules/agent-engine/actions";
import { describeHandoff, parseHandoffConfig } from "@/modules/agent-engine/handoff";
import { composeSystemPrompt, type PersonaAnswers } from "@/modules/agent-engine/persona";
import { allVariableDefinitions, parseVariableDefinitions } from "@/modules/agent-engine/variables";
import { describeFollowUp, parseFollowUpConfig } from "@/modules/follow-up/config";
import { describeSchedule, parseScheduleConfig } from "@/modules/scheduling/config";
import { parseVoiceStyle } from "@/modules/voice/style";

/**
 * Leitura da configuração do agente para a rota MCP.
 *
 * Duas regras valem para tudo aqui:
 *
 * 1. **Todo acesso ao banco leva o `tenantId` do token.** O `agentId` que chega
 *    do cliente é só um filtro dentro da conta; um id de outra conta devolve
 *    "não encontrado", igual a um id que não existe.
 * 2. **A saída é uma lista de permissões, não de proibições.** Cada campo que
 *    sai está escrito abaixo; campo novo na config de uma ação NÃO aparece até
 *    alguém decidir que pode. O inverso (apagar o que é secreto) vazaria o
 *    próximo segredo que alguém colocasse na config.
 *
 * O que nunca sai: `voiceId`, `groupId`/nome do grupo, ids de Clinicorp,
 * categorias e aceite de risco do QR, template da Meta, credenciais de qualquer
 * integração, `ownerNames`, valores de variáveis de conversa e o conteúdo dos
 * documentos da base. Lead, mensagem e consulta não são consultados.
 */

export type McpAgentListItem = {
  id: string;
  name: string;
  isPrimary: boolean;
  enabled: boolean;
};

export async function listAgentsForMcp(tenantId: string): Promise<McpAgentListItem[]> {
  return prisma.agent.findMany({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, isPrimary: true, enabled: true },
  });
}

export type McpAgentConfig = {
  id: string;
  name: string;
  isPrimary: boolean;
  enabled: boolean;
  persona: {
    agentName: string;
    businessName: string;
    sector: string;
    tone: string;
    writingStyle: string;
    offer: string;
    objective: string;
    rules: string;
  };
  systemPrompt: string;
  behavior: {
    listenAudio: boolean;
    stopOnEmoji: boolean;
    speakReplies: boolean;
    voiceStyle: string;
    hasVoice: boolean;
  };
  variables: { key: string; description: string }[];
  actions: {
    key: string;
    label: string;
    enabled: boolean;
    summary: string;
    config: Record<string, unknown> | null;
  }[];
  /** Só título e tamanho: o conteúdo da base não sai por aqui. */
  knowledge: { title: string; characters: number; status: string }[];
};

const text = (value: unknown, max = 4000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function readPersona(draft: unknown, fallbackObjective: string): PersonaAnswers {
  const d = (draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {}) as Record<string, unknown>;
  return {
    agentName: text(d.agentName, 120),
    businessName: text(d.businessName, 200),
    sector: text(d.sector, 300),
    tone: text(d.tone, 300),
    writingStyle: text(d.writingStyle, 500),
    offer: text(d.offer),
    avoid: text(d.avoid, 8000),
    objective: text(d.objective, 500) || text(fallbackObjective, 500),
  };
}

/**
 * Config de cada ação, só com o que cabe mostrar. `null` para ação sem
 * configuração própria (ou desconhecida): não há o que expor.
 */
export function publicActionConfig(key: string, raw: unknown): Record<string, unknown> | null {
  if (key === "schedule_meeting") {
    const c = parseScheduleConfig(raw);
    return {
      ...(c.weeklyAvailability !== undefined ? { weeklyAvailability: c.weeklyAvailability } : {}),
      workdays: c.workdays,
      startTime: c.startTime,
      endTime: c.endTime,
      timezone: c.timezone,
      durationMinutes: c.durationMinutes,
      durations: c.durations,
      breaks: c.breaks,
      location: c.location,
      minNoticeHours: c.minNoticeHours,
      allowCancellation: c.allowCancellation,
      allowRescheduling: c.allowRescheduling,
      recognizeExisting: c.recognizeExisting,
      blockedDates: c.blockedDates,
      reminderEnabled: c.reminderEnabled,
      reminderAudience: c.reminderAudience,
      reminderTypes: c.reminderTypes,
      reminders: c.reminders.map((r) => ({
        minutesBefore: r.minutesBefore,
        ...(r.sendTime ? { sendTime: r.sendTime } : {}),
        template: r.template,
      })),
    };
  }
  if (key === "follow_up") {
    const c = parseFollowUpConfig(raw);
    const sequence = (s: typeof c.noReply) => ({
      enabled: s.enabled,
      steps: s.steps.map((step) => ({ delayMinutes: step.delayMinutes, message: step.message, ai: step.ai })),
    });
    return { noReply: sequence(c.noReply), declined: sequence(c.declined), window: c.window };
  }
  if (key === "handoff_human") {
    const c = parseHandoffConfig(raw);
    // O JID e o nome do grupo são da equipe da clínica: saem só como "tem grupo".
    return { notifyGroup: c.notifyGroup, hasGroup: Boolean(c.groupId), groupReason: c.groupReason };
  }
  return null;
}

function summarizeAction(key: string, raw: unknown): string {
  if (key === "schedule_meeting") return describeSchedule(parseScheduleConfig(raw));
  if (key === "follow_up") return describeFollowUp(parseFollowUpConfig(raw));
  // O resumo do card cita o nome do grupo da equipe: tira antes de descrever.
  if (key === "handoff_human") return describeHandoff({ ...parseHandoffConfig(raw), groupName: null });
  return ACTION_BY_KEY[key as keyof typeof ACTION_BY_KEY]?.description ?? "";
}

export async function getAgentConfigForMcp(
  tenantId: string,
  agentId: string,
): Promise<McpAgentConfig | null> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId, archived: false },
    select: {
      id: true,
      name: true,
      isPrimary: true,
      enabled: true,
      systemPrompt: true,
      objective: true,
      personaDraft: true,
      variableDefinitions: true,
      listenAudio: true,
      stopOnEmoji: true,
      speakReplies: true,
      voiceStyle: true,
      // Só para virar boolean: o id do modelo de voz não sai daqui.
      voiceId: true,
    },
  });
  if (!agent) return null;

  const [actionRows, documents] = await Promise.all([
    prisma.tenantAction.findMany({
      where: { tenantId, agentId: agent.id },
      select: { key: true, enabled: true, config: true },
    }),
    // `length(content)` no banco: carregar o texto inteiro só para medir
    // arrastaria até dezenas de MB para a memória.
    prisma.$queryRaw<{ title: string; size: number | bigint; status: string }[]>`
      SELECT title, length(content) AS size, status
      FROM "KnowledgeDocument"
      WHERE "tenantId" = ${tenantId} AND "agentId" = ${agent.id}
      ORDER BY "createdAt" ASC`,
  ]);

  const persona = readPersona(agent.personaDraft, agent.objective);
  const rowByKey = new Map(actionRows.map((row) => [row.key, row]));

  return {
    id: agent.id,
    name: agent.name,
    isPrimary: agent.isPrimary,
    enabled: agent.enabled,
    persona: {
      agentName: persona.agentName,
      businessName: persona.businessName,
      sector: persona.sector,
      tone: persona.tone,
      writingStyle: persona.writingStyle,
      offer: persona.offer,
      objective: persona.objective,
      rules: persona.avoid,
    },
    systemPrompt: agent.systemPrompt.trim() || composeSystemPrompt(persona),
    behavior: {
      listenAudio: agent.listenAudio,
      stopOnEmoji: agent.stopOnEmoji,
      speakReplies: agent.speakReplies,
      voiceStyle: parseVoiceStyle(agent.voiceStyle).key,
      hasVoice: Boolean(agent.voiceId),
    },
    variables: allVariableDefinitions(parseVariableDefinitions(agent.variableDefinitions)).map((v) => ({
      key: v.key,
      description: v.description,
    })),
    actions: AVAILABLE_ACTIONS.map((def) => {
      const row = rowByKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        enabled: row?.enabled === true,
        summary: summarizeAction(def.key, row?.config),
        config: publicActionConfig(def.key, row?.config),
      };
    }),
    knowledge: documents.map((doc) => ({
      title: doc.title,
      characters: Number(doc.size),
      status: doc.status,
    })),
  };
}
