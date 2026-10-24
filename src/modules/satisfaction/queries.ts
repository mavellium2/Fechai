import { prisma } from "@/lib/prisma";
import { maskText } from "@/modules/knowledge-gaps/mask";
import { RECEIVED_STATUSES } from "./eligibility";
import { summarizeSurveys, type RatedSurvey, type SurveySummary } from "./summary";

/**
 * Leituras da pesquisa de satisfação para o painel. Todas filtram por
 * `tenantId` e deixam `isTest` de fora. Quem não é da clínica (Mavellium
 * personificando) recebe o comentário mascarado (LGPD): nome e telefone do
 * contato nunca saem daqui, nem para a clínica — a linha leva só o link da
 * conversa.
 */

const MAX_ROWS = 100;
const MAX_RATED = 5000;

export type SurveyFilters = {
  /** Null = desde o começo ("tudo"). */
  from: Date | null;
  /** Exclusivo. */
  to: Date;
  rating?: number | null;
  agentId?: string | null;
};

export type SurveyRow = {
  id: string;
  conversationId: string;
  rating: number;
  topics: string[];
  classified: boolean;
  classifiedBy: string | null;
  comment: string | null;
  hasAudioComment: boolean;
  ratedAt: Date;
  agentName: string | null;
  reviewedAt: Date | null;
};

export type SatisfactionOverview = {
  summary: SurveySummary;
  rows: SurveyRow[];
  agents: { id: string; name: string }[];
  /** Notas 1 e 2 ainda não revisadas (de qualquer período). */
  toReview: number;
};

export async function loadSatisfaction(
  tenantId: string,
  filters: SurveyFilters,
  options: { maskComments?: boolean } = {},
): Promise<SatisfactionOverview> {
  const agentWhere = filters.agentId ? { agentId: filters.agentId } : {};
  const ratedWhere = {
    tenantId,
    isTest: false,
    rating: { not: null },
    ratedAt: { ...(filters.from ? { gte: filters.from } : {}), lt: filters.to },
    ...agentWhere,
  };

  const [sent, rated, rows, agents, toReview] = await Promise.all([
    prisma.satisfactionSurvey.count({
      where: { tenantId, isTest: false, status: { in: [...RECEIVED_STATUSES] }, sentAt: { ...(filters.from ? { gte: filters.from } : {}), lt: filters.to }, ...agentWhere },
    }),
    prisma.satisfactionSurvey.findMany({
      where: ratedWhere,
      take: MAX_RATED,
      select: { rating: true, topics: true, comment: true, commentAudioUrl: true, classifiedAt: true },
    }),
    prisma.satisfactionSurvey.findMany({
      where: { ...ratedWhere, ...(filters.rating ? { rating: filters.rating } : {}) },
      orderBy: { ratedAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true, conversationId: true, rating: true, topics: true, comment: true, commentAudioUrl: true,
        classifiedAt: true, classifiedBy: true, ratedAt: true, reviewedAt: true,
        agent: { select: { name: true } },
        conversation: { select: { lead: { select: { name: true, phone: true } } } },
      },
    }),
    prisma.agent.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    countLowRatingsToReview(tenantId),
  ]);

  const summary = summarizeSurveys(
    sent,
    rated.flatMap((s): RatedSurvey[] =>
      s.rating === null
        ? []
        : [{ rating: s.rating, topics: s.topics, hasComment: Boolean(s.comment?.trim()), classified: s.classifiedAt !== null }],
    ),
  );

  return {
    summary,
    agents,
    toReview,
    rows: rows.flatMap((s): SurveyRow[] => {
      if (s.rating === null || !s.ratedAt) return [];
      const lead = s.conversation.lead;
      return [{
        id: s.id,
        conversationId: s.conversationId,
        rating: s.rating,
        topics: s.topics,
        classified: s.classifiedAt !== null,
        classifiedBy: s.classifiedBy,
        comment: s.comment && options.maskComments ? maskText(s.comment, { names: [lead.name], phones: [lead.phone] }) : s.comment,
        hasAudioComment: Boolean(s.commentAudioUrl),
        ratedAt: s.ratedAt,
        agentName: s.agent?.name ?? null,
        reviewedAt: s.reviewedAt,
      }];
    }),
  };
}

/** Notas 1 e 2 que ninguém revisou ainda: o alerta do `/inicio`. */
export function countLowRatingsToReview(tenantId: string): Promise<number> {
  return prisma.satisfactionSurvey.count({
    where: { tenantId, isTest: false, rating: { lte: 2, not: null }, reviewedAt: null },
  });
}

export type LowRatingAlert = { id: string; conversationId: string; rating: number; ratedAt: Date; agentName: string | null };

export async function listLowRatingsToReview(tenantId: string, limit = 5): Promise<LowRatingAlert[]> {
  const rows = await prisma.satisfactionSurvey.findMany({
    where: { tenantId, isTest: false, rating: { lte: 2, not: null }, reviewedAt: null },
    orderBy: { ratedAt: "desc" },
    take: limit,
    select: { id: true, conversationId: true, rating: true, ratedAt: true, agent: { select: { name: true } } },
  });
  return rows.flatMap((r) =>
    r.rating === null || !r.ratedAt
      ? []
      : [{ id: r.id, conversationId: r.conversationId, rating: r.rating, ratedAt: r.ratedAt, agentName: r.agent?.name ?? null }],
  );
}

/** Pesquisa da conversa para o cartão do thread (a mais recente que o contato recebeu). */
export async function loadConversationSurvey(tenantId: string, conversationId: string) {
  return prisma.satisfactionSurvey.findFirst({
    where: { tenantId, conversationId, status: { in: [...RECEIVED_STATUSES] } },
    orderBy: { sentAt: "desc" },
    select: { id: true, status: true, sentAt: true, rating: true, ratedAt: true, comment: true, isTest: true, topics: true },
  });
}
