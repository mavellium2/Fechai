import { recordMessageContext } from "../../src/modules/reports/contact-context-events";
import { prisma } from "../../src/lib/prisma";
import { getWhatsAppProviderForInstance } from "../../src/modules/whatsapp/meta-config";
import { agentRepliesOn, findWhatsappChannel } from "../../src/modules/whatsapp/instances";
import {
  FOLLOWUP_STALE_AFTER_MINUTES,
  cumulativeDelays,
  parseFollowUpConfig,
  parseFollowUpReason,
  type FollowUpConfig,
  type FollowUpSequence,
  type FollowUpStep,
} from "../../src/modules/follow-up/config";
import { composeFollowUp } from "../../src/modules/follow-up/compose";
import { parseScheduleConfig } from "../../src/modules/scheduling/config";
import { partsInZone } from "../../src/modules/scheduling/time";
import { sanitizeUnresolvedPlaceholders } from "../../src/modules/agent-engine/reply-sanitizer";
import { DEFAULT_AGENT_TIMEZONE } from "../../src/modules/agent-engine/time-context";
import { parseConversationVariables, withContactDefaults } from "../../src/modules/agent-engine/variables";
import { isPhoneBlocked } from "../../src/modules/whatsapp/blocklist";

/**
 * Follow-up em esteira: várias mensagens espaçadas, e a esteira depende de
 * como o contato deixou a conversa (ver `modules/follow-up/config.ts`):
 * `noReply` para quem sumiu, `declined` para quem disse que não quer agendar
 * agora, nenhuma para quem pediu para parar.
 *
 * Não há coluna de "esteira ativa": a esteira é o silêncio. Ela começa quando
 * o agente fala e o contato não responde, avança uma etapa por envio
 * (`followUpStep`, com `followUpSentAt` marcando o último) e acaba sozinha
 * quando o contato escreve — `followUpStep` só vale enquanto
 * `followUpSentAt >= lastInboundAt`, então a resposta zera a contagem sem
 * ninguém precisar escrever nada.
 */

export type FollowUpCandidate = {
  needsHuman: boolean;
  /** Humano assumiu esta conversa manualmente (`sendManualMessage`). */
  agentPaused: boolean;
  lastInboundAt: Date | null;
  followUpSentAt: Date | null;
  followUpStep: number;
  followUpReason: string | null;
  /** Quem falou por último e quando — o silêncio começa aí. */
  lastMessage?: { role: string; createdAt: Date } | null;
  hasActiveAppointment?: boolean;
  /** Chave geral do agente (`Agent.enabled`). Pausado não reengaja ninguém. */
  agentEnabled?: boolean;
};

/** A esteira que vale para a conversa; null quando nenhuma deve sair. */
export function sequenceFor(reason: string | null, cfg: FollowUpConfig): FollowUpSequence | null {
  const parsed = parseFollowUpReason(reason);
  if (parsed === "stop") return null;
  const seq = parsed === "declined" ? cfg.declined : cfg.noReply;
  return seq.enabled ? seq : null;
}

/**
 * Etapas já enviadas NESTA esteira. Um envio anterior à última mensagem do
 * contato é de uma esteira que ele já encerrou respondendo.
 */
export function stepsSentInRun(conv: Pick<FollowUpCandidate, "followUpSentAt" | "lastInboundAt" | "followUpStep">): number {
  if (!conv.followUpSentAt || !conv.lastInboundAt) return 0;
  return conv.followUpSentAt >= conv.lastInboundAt ? Math.max(0, conv.followUpStep) : 0;
}

export type NextFollowUp = { index: number; step: FollowUpStep; dueAt: Date };

/**
 * A próxima etapa e quando ela vence, ou null quando não há o que mandar.
 *
 * A espera da primeira conta da última fala do agente (o começo do silêncio,
 * que costuma ser segundos depois da mensagem do contato, mas pode ser dias
 * quando quem respondeu foi um humano); a das seguintes, do envio anterior.
 */
export function nextFollowUp(conv: FollowUpCandidate, cfg: FollowUpConfig): NextFollowUp | null {
  if (conv.needsHuman) return null;
  // Humano assumiu a conversa manualmente: a esteira automática não pode
  // falar por cima de quem está atendendo (mesmo motivo de `needsHuman`).
  if (conv.agentPaused) return null;
  // Chave geral do agente desligada: pausar é para ele parar de falar com
  // cliente, e follow-up é justamente isso. `undefined` (agente sem
  // `agentId`, chamada antiga do candidato) não bloqueia por si só — quem
  // decide isso é a varredura, que já filtra pelo agente na consulta.
  if (conv.agentEnabled === false) return null;
  // Follow-up tenta recuperar uma venda/conversa abandonada. Depois que há
  // consulta (marcada ou realizada, futura ou passada), o objetivo já foi
  // alcançado; dali em diante quem fala sozinho são os lembretes da consulta,
  // não uma cobrança genérica. Só consulta cancelada não conta.
  if (conv.hasActiveAppointment) return null;
  if (!conv.lastInboundAt) return null;
  // Só faz sentido se a última mensagem foi do agente (o contato ficou em
  // silêncio). A mensagem do contato ainda sem resposta é do atendimento.
  if (!conv.lastMessage || conv.lastMessage.role !== "assistant") return null;

  const seq = sequenceFor(conv.followUpReason, cfg);
  if (!seq) return null;

  const index = stepsSentInRun(conv);
  const step = seq.steps[index];
  if (!step) return null;

  const base = index === 0 ? conv.lastMessage.createdAt : conv.followUpSentAt!;
  return { index, step, dueAt: new Date(base.getTime() + step.delayMinutes * 60_000) };
}

/** Dentro das horas em que o follow-up pode sair, no fuso da agenda. */
export function isWithinFollowUpWindow(now: Date, window: FollowUpConfig["window"], timezone: string): boolean {
  const { hour } = partsInZone(now, timezone);
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * Venceu há mais que `FOLLOWUP_STALE_AFTER_MINUTES`: não sai mais, e a esteira
 * acaba aí até o contato escrever de novo. Cobre o worker que ficou parado e
 * a conta que acabou de ligar o follow-up — sem isso, toda conversa antiga e
 * silenciosa receberia a primeira mensagem da esteira de uma vez.
 */
export function isStale(dueAt: Date, now: Date): boolean {
  return now.getTime() - dueAt.getTime() > FOLLOWUP_STALE_AFTER_MINUTES * 60_000;
}

/**
 * Até onde a busca olha para trás: a esteira mais longa configurada, mais a
 * folga de uma janela fechada por etapa. Sem esse teto a varredura carregaria
 * toda conversa silenciosa da história da conta a cada ciclo.
 */
function lookbackMinutes(configs: FollowUpConfig[]): number {
  let longest = 0;
  let mostSteps = 0;
  for (const cfg of configs) {
    for (const seq of [cfg.noReply, cfg.declined]) {
      if (!seq.enabled) continue;
      longest = Math.max(longest, cumulativeDelays(seq.steps).at(-1) ?? 0);
      mostSteps = Math.max(mostSteps, seq.steps.length);
    }
  }
  return longest + (mostSteps + 1) * FOLLOWUP_STALE_AFTER_MINUTES;
}

// Varre as conversas dos agentes com a ação follow_up ativa e dispara a etapa vencida.
export async function scanAndSendFollowUps(now: Date = new Date()) {
  // A esteira é por agente (TenantAction.config, ver módulo follow-up) — cada
  // agente da conta pode ter a dele. Por isso a busca não filtra por um prazo
  // só: traz o candidato e decide na volta.
  const enabled = await prisma.tenantAction.findMany({
    where: { key: "follow_up", enabled: true },
    select: { tenantId: true, agentId: true, config: true },
  });
  if (enabled.length === 0) return { scanned: 0, sent: 0 };

  const configByAgent = new Map<string, FollowUpConfig>(
    enabled.map((a) => [a.agentId, parseFollowUpConfig(a.config)]),
  );
  const agentIds = [...configByAgent.keys()];

  // A janela de envio é em horas locais, no fuso da agenda do agente — mesmo
  // com o agendamento desligado a config tem fuso (o padrão).
  const schedules = await prisma.tenantAction.findMany({
    where: { key: "schedule_meeting", agentId: { in: agentIds } },
    select: { agentId: true, config: true },
  });
  const timezoneByAgent = new Map(schedules.map((s) => [s.agentId, parseScheduleConfig(s.config).timezone]));

  const since = new Date(now.getTime() - lookbackMinutes([...configByAgent.values()]) * 60_000);

  const convos = await prisma.conversation.findMany({
    where: {
      agentId: { in: agentIds },
      // Agente pausado (chave geral, `Agent.enabled = false`) não deve
      // reengajar ninguém — pausar é para o agente parar de falar com
      // cliente, e follow-up é justamente isso.
      agent: { enabled: true },
      // Conversa de teste não recebe follow-up: ninguém do outro lado para
      // reengajar (antes o filtro era pelo telefone "sandbox", mais abaixo).
      isTest: false,
      needsHuman: false,
      // Humano assumiu esta conversa manualmente (`sendManualMessage`): a
      // esteira automática não pode falar por cima de quem está atendendo.
      agentPaused: false,
      lastInboundAt: { gte: since },
      // Qualquer consulta não cancelada (marcada ou realizada, futura ou
      // passada) encerra o follow-up: o objetivo já foi alcançado.
      // Vale para agendamento do agente e manual: ambos se ligam ao Lead. Usar
      // `conversation.appointments` deixaria passar o manual, que não guarda
      // `conversationId`.
      lead: {
        appointments: {
          none: { status: { in: ["scheduled", "done"] } },
        },
      },
    },
    include: {
      agent: { select: { systemPrompt: true, enabled: true } },
      lead: {
        include: {
          // Segunda defesa em memória: mantém a regra explícita em
          // `nextFollowUp` e protege o envio mesmo se a consulta principal for
          // ampliada/refatorada depois.
          appointments: {
            where: { status: { in: ["scheduled", "done"] } },
            select: { id: true },
            take: 1,
          },
        },
      },
      messages: {
        where: { role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { role: true, createdAt: true },
      },
    },
  });

  let sent = 0;

  for (const c of convos) {
    // Conversa de um agente que não tem follow_up ligado (mesmo que outro
    // agente da mesma conta tenha) não entra — a ação é por agente.
    const config = c.agentId ? configByAgent.get(c.agentId) : undefined;
    if (!config) continue;

    const next = nextFollowUp({
      ...c,
      lastMessage: c.messages[0] ?? null,
      hasActiveAppointment: c.lead.appointments.length > 0,
      agentEnabled: c.agent?.enabled,
    }, config);
    if (!next || now < next.dueAt || isStale(next.dueAt, now)) continue;

    // Fora da janela a etapa espera: ninguém quer "oi, sumiu?" às 3h.
    const timezone = (c.agentId && timezoneByAgent.get(c.agentId)) || DEFAULT_AGENT_TIMEZONE;
    if (!isWithinFollowUpWindow(now, config.window, timezone)) continue;

    // O webhook barra novas mensagens desse contato, mas a conversa antiga
    // continua elegível aqui. Não registrar um follow-up que não foi enviado:
    // followUpSentAt também alimenta a tela e o relatório de recuperação.
    if (await isPhoneBlocked(c.tenantId, c.lead.phone)) continue;

    const values = withContactDefaults(parseConversationVariables(c.variables), c.lead);
    const reference = sanitizeUnresolvedPlaceholders(next.step.message, values);
    if (!reference) {
      await markStep(c.id, next.index, now);
      continue;
    }

    // Conexão antes da IA: não se paga uma mensagem gerada que não tem como
    // sair. Desconectado não consome a etapa — a próxima varredura tenta de
    // novo até a etapa ficar velha (`isStale`). Sai pelo número em que o
    // contato escreveu: com as duas conexões, a dele fora do ar espera, não
    // troca de número (ver `pickWhatsappChannel`).
    const instance = await findWhatsappChannel(c.tenantId, c.whatsappProvider);
    if (!instance?.externalId) continue;
    // Número em que o agente não responde (ex.: Meta só para Disparos): o
    // follow-up é o agente escrevendo sozinho, então também não sai.
    if (!agentRepliesOn(instance)) continue;
    const provider = getWhatsAppProviderForInstance(instance);
    if (!provider.isConfigured()) continue;

    const composed = next.step.ai
      ? await composeFollowUp({
          tenantId: c.tenantId,
          conversationId: c.id,
          systemPrompt: c.agent?.systemPrompt ?? null,
          reference,
          values,
          timeZone: timezone,
          now,
        })
      : { text: reference, byAi: false };

    let keyId: string | null;
    try {
      keyId = await provider.sendMessage(instance.externalId, c.lead.phone, composed.text);
    } catch (err) {
      console.error("[follow-up] falha ao enviar", c.id, err);
      continue;
    }

    const savedMessage = await prisma.message.create({
      data: {
        conversationId: c.id,
        role: "assistant",
        content: composed.text,
        whatsappMessageId: keyId ?? undefined,
        // Só o texto escrito pela IA conta na cota (ver billing/usage.ts): a
        // mensagem fixa da etapa não passou por LLM nenhum.
        ...(composed.byAi ? { sentBy: "agent" } : {}),
      },
    });
    await recordMessageContext(c.tenantId, savedMessage?.id, "contact_followup");
    await markStep(c.id, next.index, now);
    sent++;
  }

  return { scanned: convos.length, sent };
}

/** Registra a etapa `index` como a última da esteira. */
async function markStep(conversationId: string, index: number, now: Date) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { followUpSentAt: now, followUpStep: index + 1 },
  });
}
