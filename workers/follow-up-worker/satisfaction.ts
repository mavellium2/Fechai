import { prisma } from "../../src/lib/prisma";
import { isPhoneBlocked } from "../../src/modules/whatsapp/blocklist";
import { parseFollowUpConfig, type FollowUpConfig } from "../../src/modules/follow-up/config";
import { parseSurveySettings, type SurveySettings } from "../../src/modules/satisfaction/settings";
import {
  OPEN_STATUSES,
  RECEIVED_STATUSES,
  SURVEY_COOLDOWN_DAYS,
  SURVEY_WINDOW_HOURS,
  evaluateSurvey,
  type SurveyCandidate,
} from "../../src/modules/satisfaction/eligibility";
import { sendSurvey } from "../../src/modules/satisfaction/send";
import { classifyPendingSurveys } from "../../src/modules/satisfaction/classify";
import { nextFollowUp, stepsSentInRun } from "./scan";

/**
 * Varredura da pesquisa de satisfação (a cada 5 minutos). Para cada conta com
 * a pesquisa ligada, olha as conversas em que o contato escreveu nas últimas
 * 24h e pergunta à regra pura (`evaluateSurvey`) o que fazer:
 *
 * - `send`: manda a pergunta da nota (claim antes do POST, nunca repete);
 * - `expire`: era elegível mas o prazo de 24h acabou — registra `expired`, sem
 *   enviar, e não olha de novo;
 * - o resto espera ou fica de fora.
 *
 * Também fecha o que ficou aberto (sem nota em 24h, sem comentário em 24h,
 * envio que nunca confirmou) e classifica os comentários novos em segundo plano.
 */

const HOUR = 3_600_000;
/** Teto de envios por conta em cada volta: uma conta com fila grande não vira rajada. */
const MAX_SENDS_PER_TENANT = 20;
const MAX_CANDIDATES_PER_TENANT = 300;
/** Janela do "conversou de verdade" quando o contato nunca recebeu pesquisa. */
const EPISODE_LOOKBACK_DAYS = 7;
/**
 * Envio que não confirmou em tanto tempo deixa de ser "enviando" e vira
 * `unknown`. Até lá a captura ainda aceita a nota (a linha pode ter ficado em
 * `sending` por falha ao gravar o id); depois, não.
 */
const SENDING_STALE_MINUTES = 10;

const AUTOMATED_KINDS = ["contact_campaign", "contact_reminder", "contact_followup"];

/** Fecha pesquisas que ficaram abertas além do prazo. */
export async function closeStaleSurveys(now: Date) {
  const cutoff = new Date(now.getTime() - SURVEY_WINDOW_HOURS * HOUR);
  const stuck = new Date(now.getTime() - SENDING_STALE_MINUTES * 60_000);
  const [noReply, noComment, unknown] = await Promise.all([
    prisma.satisfactionSurvey.updateMany({
      where: { status: "awaiting_rating", sentAt: { lt: cutoff } },
      data: { status: "no_reply" },
    }),
    // A nota existe; só o comentário não veio. A pesquisa termina com a nota.
    prisma.satisfactionSurvey.updateMany({
      where: { status: "awaiting_comment", ratedAt: { lt: cutoff } },
      data: { status: "completed" },
    }),
    prisma.satisfactionSurvey.updateMany({
      where: { status: "sending", sentAt: { lt: stuck } },
      data: { status: "unknown" },
    }),
  ]);
  return { noReply: noReply.count, noComment: noComment.count, unknown: unknown.count };
}

async function followUpConfigs(tenantId: string): Promise<Map<string, FollowUpConfig>> {
  const rows = await prisma.tenantAction.findMany({
    where: { tenantId, key: "follow_up", enabled: true },
    select: { agentId: true, config: true },
  });
  return new Map(rows.map((r) => [r.agentId, parseFollowUpConfig(r.config)]));
}

type Conv = Awaited<ReturnType<typeof loadConversations>>[number];

function loadConversations(tenantId: string, since: Date, notAfter: Date) {
  return prisma.conversation.findMany({
    where: {
      tenantId,
      isTest: false,
      lead: { isTest: false },
      whatsappProvider: { not: null },
      needsHuman: false,
      agentPaused: false,
      agent: { enabled: true },
      // Já completou a espera: a última fala do agente é depois da do contato, então
      // quem escreveu depois de `notAfter` ainda não está vencido. Filtrar aqui
      // evita que as conversas novas ocupem o lote e as vencidas passem do prazo.
      // As mais antigas primeiro: são as mais perto de expirar.
      lastInboundAt: { gte: since, lte: notAfter },
    },
    orderBy: { lastInboundAt: "asc" },
    take: MAX_CANDIDATES_PER_TENANT,
    select: {
      id: true, agentId: true, isTest: true, needsHuman: true, agentPaused: true, whatsappProvider: true,
      followUpReason: true, followUpSentAt: true, followUpStep: true, lastInboundAt: true,
      agent: { select: { enabled: true } },
      lead: {
        select: {
          phone: true, isTest: true,
          appointments: { where: { status: { in: ["scheduled", "done"] } }, select: { id: true }, take: 1 },
        },
      },
    },
  });
}

/** Monta o que a regra precisa saber sobre a conversa. Só leitura. */
async function buildCandidate(
  tenantId: string,
  c: Conv,
  followUps: Map<string, FollowUpConfig>,
  now: Date,
): Promise<SurveyCandidate> {
  const surveys = await prisma.satisfactionSurvey.findMany({
    where: { conversationId: c.id },
    orderBy: { sentAt: "desc" },
    take: 10,
    select: { status: true, sentAt: true, createdAt: true, isTest: true },
  });
  // Pesquisa de teste só vale como "aberta" (a captura pegaria a resposta dela);
  // não segura a regra dos 30 dias nem conta como pesquisa deste episódio.
  const real = surveys.filter((s) => !s.isTest);
  const received = (RECEIVED_STATUSES as readonly string[]);
  const lastReceivedAt = real.find((s) => received.includes(s.status))?.sentAt ?? null;
  const hasOpenSurvey = surveys.some((s) => (OPEN_STATUSES as readonly string[]).includes(s.status));
  const surveyCreatedAfterLastInbound = real.some((s) => c.lastInboundAt && s.createdAt >= c.lastInboundAt);

  // O episódio começa na última pesquisa recebida (ou há 7 dias): conversa
  // antiga já avaliada não "conta" para a próxima.
  const lookback = now.getTime() - EPISODE_LOOKBACK_DAYS * 86_400_000;
  const episodeStart = new Date(Math.max(lastReceivedAt?.getTime() ?? 0, lookback));

  const messages = await prisma.message.findMany({
    where: { conversationId: c.id, createdAt: { gt: episodeStart }, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: { role: true, sentBy: true, createdAt: true },
  });
  const last = messages[0] ?? null;
  const [handoffs, automated, blocked] = await Promise.all([
    prisma.reportEvent.count({ where: { conversationId: c.id, kind: "handoff", createdAt: { gt: episodeStart } } }),
    last
      ? prisma.reportEvent.count({ where: { conversationId: c.id, kind: { in: AUTOMATED_KINDS }, createdAt: { gte: last.createdAt } } })
      : Promise.resolve(0),
    isPhoneBlocked(tenantId, c.lead.phone),
  ]);

  // Follow-up em andamento: etapa pendente ou já enviada nesta esteira.
  const config = c.agentId ? followUps.get(c.agentId) : undefined;
  let followUpActive = false;
  if (config) {
    const base = {
      needsHuman: c.needsHuman, agentPaused: c.agentPaused, lastInboundAt: c.lastInboundAt,
      followUpSentAt: c.followUpSentAt, followUpStep: c.followUpStep, followUpReason: c.followUpReason,
      lastMessage: last ? { role: last.role, createdAt: last.createdAt } : null,
      hasActiveAppointment: c.lead.appointments.length > 0,
      agentEnabled: c.agent?.enabled,
    };
    followUpActive = stepsSentInRun(base) > 0 || nextFollowUp(base, config) !== null;
  }

  return {
    isTest: c.isTest,
    leadIsTest: c.lead.isTest,
    whatsappProvider: c.whatsappProvider,
    agentEnabled: c.agent?.enabled !== false,
    needsHuman: c.needsHuman,
    agentPaused: c.agentPaused,
    handoffInEpisode: handoffs > 0,
    followUpReason: c.followUpReason,
    blocked,
    lastInboundAt: c.lastInboundAt,
    lastMessage: last ? { role: last.role, createdAt: last.createdAt } : null,
    lastMessageAutomated: automated > 0,
    contactMessages: messages.filter((m) => m.role === "user").length,
    agentReplies: messages.filter((m) => m.role === "assistant" && m.sentBy === "agent").length,
    followUpActive,
    // Reativação (P-88) ainda não existe: ponto de extensão em `isInReactivation`.
    inReactivation: false,
    hasOpenSurvey,
    surveyCreatedAfterLastInbound,
    lastReceivedAt,
  };
}

async function scanTenant(tenantId: string, settings: SurveySettings, now: Date) {
  const result = { scanned: 0, sent: 0, expired: 0, waiting: 0 };
  const since = new Date(now.getTime() - SURVEY_WINDOW_HOURS * HOUR);
  const notAfter = new Date(now.getTime() - settings.delayMinutes * 60_000);
  const [conversations, followUps] = await Promise.all([loadConversations(tenantId, since, notAfter), followUpConfigs(tenantId)]);

  for (const c of conversations) {
    result.scanned++;
    if (result.sent >= MAX_SENDS_PER_TENANT) break;
    try {
      const candidate = await buildCandidate(tenantId, c, followUps, now);
      const verdict = evaluateSurvey(candidate, settings, now);
      if (verdict.action === "expire") {
        await prisma.satisfactionSurvey.create({
          data: { tenantId, conversationId: c.id, agentId: c.agentId, provider: c.whatsappProvider ?? "evolution", status: "expired" },
        });
        result.expired++;
      } else if (verdict.action === "send") {
        const sent = await sendSurvey({ tenantId, conversationId: c.id, settings });
        if (sent.status === "sent" || sent.status === "unknown") result.sent++;
        else if (sent.status === "waiting") result.waiting++;
      }
    } catch (err) {
      console.error("[satisfaction] conversa não processada", c.id, err);
    }
  }
  return result;
}

export async function scanSatisfactionSurveys(now: Date = new Date()) {
  const closed = await closeStaleSurveys(now);
  const rows = await prisma.satisfactionSurveySettings.findMany({ where: { enabled: true } });
  const totals = { tenants: 0, scanned: 0, sent: 0, expired: 0, waiting: 0, classified: 0 };
  for (const row of rows) {
    const settings = parseSurveySettings(row);
    if (!settings.enabled) continue;
    totals.tenants++;
    try {
      const r = await scanTenant(row.tenantId, settings, now);
      totals.scanned += r.scanned;
      totals.sent += r.sent;
      totals.expired += r.expired;
      totals.waiting += r.waiting;
    } catch (err) {
      console.error("[satisfaction] conta não processada", row.tenantId, err);
    }
  }
  // A classificação não depende de a pesquisa estar ligada: comentário que já
  // chegou continua valendo se a clínica desligou depois.
  totals.classified = await classifyPendingSurveys().catch((err) => {
    console.error("[satisfaction] classificação falhou", err);
    return 0;
  });
  return { ...totals, closed, cooldownDays: SURVEY_COOLDOWN_DAYS };
}
