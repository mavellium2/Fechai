import { prisma } from "@/lib/prisma";
import { RECEIVED_STATUSES } from "@/modules/satisfaction/eligibility";
import { summarizeSurveys, MIN_ANSWERS_FOR_AVERAGE } from "@/modules/satisfaction/summary";
import type { MonthlyInput, MonthlySurvey } from "./monthly";
import type { MonthlyEvidence } from "./monthly-evidence";
import type { Metric, MonthlySatisfaction } from "./monthly-data";

/*
 * Satisfação dos contatos no relatório mensal. O motor calcula aqui, na mesma
 * passada dos demais números; a IA só recebe estes agregados e o PDF só os
 * apresenta. O texto do comentário nunca entra: nem em `data`, nem na
 * evidência, nem nas ferramentas da IA, nem no PDF.
 */

/** Pesquisas com envio ou resposta dentro da janela, sem testes e sem texto de comentário. */
export async function loadMonthlySurveys(tenantId: string, start: Date, end: Date): Promise<MonthlySurvey[]> {
  const rows = await prisma.satisfactionSurvey.findMany({
    where: {
      tenantId,
      isTest: false,
      OR: [
        { status: { in: [...RECEIVED_STATUSES] }, sentAt: { gte: start, lt: end } },
        { rating: { not: null }, ratedAt: { gte: start, lt: end } },
      ],
    },
    select: { id: true, agentId: true, conversationId: true, sentAt: true, ratedAt: true, rating: true, topics: true, comment: true, classifiedAt: true },
  });
  return rows.map((r) => ({
    id: r.id, agentId: r.agentId, conversationId: r.conversationId, sentAt: r.sentAt, ratedAt: r.ratedAt, rating: r.rating,
    topics: r.topics, hasComment: Boolean(r.comment?.trim()), classified: r.classifiedAt !== null,
  }));
}

const metric = (value: number | null, note?: string): Metric => ({ value, status: value === null ? "unavailable" : "measured", source: "satisfactionSurveys", ...(note ? { note } : {}) });

/**
 * Coorte: respostas pela data da NOTA no mês (`ratedAt`), envios pela data do
 * envio; conversas de teste já ficaram fora na leitura e o escopo de agentes é
 * o da revisão. Sem envio e sem resposta no mês, o bloco não existe (`undefined`).
 */
export function buildSatisfaction(input: MonthlyInput, evidence: MonthlyEvidence): MonthlySatisfaction | undefined {
  if (!input.surveys) return undefined;
  const { start, end, config } = input;
  const includesAgent = (agentId?: string | null) => !config.agentIds?.length || Boolean(agentId && config.agentIds.includes(agentId));
  const inMonth = (at: Date | null) => at !== null && at >= start && at < end;

  const scoped = input.surveys.filter((s) => includesAgent(s.agentId));
  const sent = scoped.filter((s) => inMonth(s.sentAt)).length;
  const rated = scoped.filter((s) => s.rating !== null && inMonth(s.ratedAt));
  if (!sent && !rated.length) return undefined;

  const summary = summarizeSurveys(sent, rated.map((s) => ({ rating: s.rating!, topics: s.topics, hasComment: s.hasComment, classified: s.classified })));
  evidence.surveys = rated.map((s) => ({ surveyId: s.id, conversationId: s.conversationId, rating: s.rating!, topics: [...s.topics] }));
  const small = summary.answered < MIN_ANSWERS_FOR_AVERAGE;
  return {
    sent: summary.sent,
    answered: summary.answered,
    responseRatePercent: summary.responseRatePercent,
    average: metric(summary.average, small && summary.average !== null ? "amostra pequena" : undefined),
    distribution: summary.distribution,
    improvementTopics: summary.topTopics.map(({ key, label, count }) => ({ key, label, count })),
    unclassified: summary.unclassified,
    withComment: summary.withComment,
    smallSample: small,
  };
}
