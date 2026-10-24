import { partsInZone } from "@/modules/scheduling/time";
import type { SurveySettings } from "./settings";

/**
 * Quem recebe a pesquisa e quando. Regra PURA: o worker junta os dados da
 * conversa (`SurveyCandidate`) e pergunta aqui. Nada de banco, relógio global
 * ou WhatsApp — tudo que decide entra como argumento, para cada exclusão ter
 * teste próprio.
 */

/** Margem para o envio sair antes de a janela de 24h da Meta fechar. */
export const WINDOW_SAFETY_MINUTES = 60;
/** Janela de atendimento do WhatsApp (Meta) e o limite que adotamos também para o QR. */
export const SURVEY_WINDOW_HOURS = 24;
/** Uma pesquisa por contato a cada 30 dias, contando quem RECEBEU. */
export const SURVEY_COOLDOWN_DAYS = 30;
/** "Conversou de verdade": pelo menos estas falas do contato e uma resposta do agente. */
export const MIN_CONTACT_MESSAGES = 2;
export const MIN_AGENT_REPLIES = 1;

/** Estados em que o contato RECEBEU a pesquisa (ou pode ter recebido). */
export const RECEIVED_STATUSES = ["sending", "awaiting_rating", "awaiting_comment", "completed", "no_reply", "unknown"] as const;
/** Estados em que a pesquisa ainda espera algo do contato (ou do envio). */
export const OPEN_STATUSES = ["sending", "awaiting_rating", "awaiting_comment"] as const;

export type SurveyCandidate = {
  isTest: boolean;
  leadIsTest: boolean;
  /** Por onde o contato fala. Null = site/widget ou conversa antiga: fora. */
  whatsappProvider: string | null;
  agentEnabled: boolean;
  needsHuman: boolean;
  agentPaused: boolean;
  /** Houve transbordo para a equipe no episódio (mesmo que devolvido ao agente). */
  handoffInEpisode: boolean;
  followUpReason: string | null;
  blocked: boolean;
  lastInboundAt: Date | null;
  /** Última mensagem da conversa (de qualquer lado). */
  lastMessage: { role: string; createdAt: Date } | null;
  /** A última fala do agente foi um Disparo, lembrete ou follow-up (não é fim de atendimento). */
  lastMessageAutomated: boolean;
  contactMessages: number;
  agentReplies: number;
  /** A esteira de follow-up está andando para este contato (etapa pendente ou já enviada). */
  followUpActive: boolean;
  /** Reativação (P-88). Ainda não existe no código: ponto de extensão. */
  inReactivation: boolean;
  /** Pesquisa ainda em aberto (enviando ou esperando nota/comentário). */
  hasOpenSurvey: boolean;
  /** Pesquisa já criada para este episódio (qualquer estado, inclusive expirada). */
  surveyCreatedAfterLastInbound: boolean;
  /** Quando o contato recebeu a última pesquisa (só quem recebeu). */
  lastReceivedAt: Date | null;
};

export type SkipReason =
  | "disabled"
  | "test"
  | "no_channel"
  | "agent_off"
  | "needs_human"
  | "handoff"
  | "opt_out"
  | "blocked"
  | "reactivation"
  | "follow_up"
  | "automated_last"
  | "not_real_conversation"
  | "open_survey"
  | "already_handled"
  | "cooldown"
  | "contact_last";

export type SurveyVerdict =
  | { action: "send" }
  /** Ainda não é a hora (silêncio curto ou fora da faixa de horas). */
  | { action: "wait"; reason: "silence" | "window" }
  /** Era elegível, mas o prazo de 24h não deixa mais enviar. */
  | { action: "expire" }
  | { action: "skip"; reason: SkipReason };

const skip = (reason: SkipReason): SurveyVerdict => ({ action: "skip", reason });

/** Dentro da faixa de horas locais da conta (início inclusive, fim exclusive). */
export function isWithinSurveyWindow(at: Date, s: Pick<SurveySettings, "windowStartHour" | "windowEndHour" | "timezone">): boolean {
  const { hour } = partsInZone(at, s.timezone);
  return hour >= s.windowStartHour && hour < s.windowEndHour;
}

/** Último instante em que o envio ainda cabe: 24h da última fala do contato, menos a margem. */
export function sendDeadline(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + SURVEY_WINDOW_HOURS * 3_600_000 - WINDOW_SAFETY_MINUTES * 60_000);
}

/** A faixa de horas abre antes do prazo? Procura de 15 em 15 minutos. */
function windowOpensBefore(now: Date, deadline: Date, s: SurveySettings): boolean {
  for (let t = now.getTime(); t <= deadline.getTime(); t += 15 * 60_000) {
    if (isWithinSurveyWindow(new Date(t), s)) return true;
  }
  return false;
}

/**
 * Ponto de extensão da reativação (P-88): quando ela existir, é aqui que a
 * regra "quem está em ciclo de reativação não recebe pesquisa" se liga. Hoje
 * o candidato sempre chega com `inReactivation: false`.
 */
export const isInReactivation = (c: Pick<SurveyCandidate, "inReactivation">) => c.inReactivation;

/**
 * Decide o que fazer com a conversa agora. `ignoreTiming` é o envio de teste:
 * ignora espera e faixa de horas (e só ele).
 */
export function evaluateSurvey(
  c: SurveyCandidate,
  settings: SurveySettings,
  now: Date,
  options: { ignoreTiming?: boolean } = {},
): SurveyVerdict {
  if (!settings.enabled) return skip("disabled");
  if (c.isTest || c.leadIsTest) return skip("test");
  if (!c.whatsappProvider) return skip("no_channel");
  if (!c.agentEnabled) return skip("agent_off");
  if (c.needsHuman || c.agentPaused) return skip("needs_human");
  if (c.handoffInEpisode) return skip("handoff");
  if (c.followUpReason === "stop") return skip("opt_out");
  if (c.blocked) return skip("blocked");
  if (isInReactivation(c)) return skip("reactivation");
  if (c.followUpActive) return skip("follow_up");
  if (c.hasOpenSurvey) return skip("open_survey");
  if (c.surveyCreatedAfterLastInbound) return skip("already_handled");
  if (c.lastReceivedAt && now.getTime() - c.lastReceivedAt.getTime() < SURVEY_COOLDOWN_DAYS * 86_400_000) return skip("cooldown");

  if (c.contactMessages < MIN_CONTACT_MESSAGES || c.agentReplies < MIN_AGENT_REPLIES) return skip("not_real_conversation");
  if (!c.lastInboundAt || !c.lastMessage) return skip("not_real_conversation");
  // O contato falou por último: ele espera o atendimento, não uma pesquisa.
  if (c.lastMessage.role !== "assistant") return skip("contact_last");
  if (c.lastMessageAutomated) return skip("automated_last");

  if (options.ignoreTiming) return { action: "send" };

  const dueAt = c.lastMessage.createdAt.getTime() + settings.delayMinutes * 60_000;
  if (now.getTime() < dueAt) return { action: "wait", reason: "silence" };

  // Passou da janela de 24h do contato: sem pesquisa (nem template, nem QR).
  const deadline = sendDeadline(c.lastInboundAt);
  if (now.getTime() > deadline.getTime()) return { action: "expire" };

  if (!isWithinSurveyWindow(now, settings)) {
    // A faixa só abre depois do prazo: não adianta esperar.
    return windowOpensBefore(now, deadline, settings) ? { action: "wait", reason: "window" } : { action: "expire" };
  }
  return { action: "send" };
}
