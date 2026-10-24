import { SURVEY_TOPICS, topicLabel } from "./categories";

/**
 * Agregados da pesquisa de satisfação. Puro: o painel e o relatório mensal
 * usam a MESMA função, para a média e a distribuição não divergirem entre as
 * duas telas. Nenhum texto de comentário entra aqui — só nota e chaves.
 */

/** Com menos respostas que isso a média é "amostra pequena" e não vai ao relatório do cliente. */
export const MIN_ANSWERS_FOR_AVERAGE = 5;
/** Quantos motivos de melhoria o relatório mostra. */
export const TOP_TOPICS = 3;

export type RatedSurvey = {
  rating: number;
  topics: readonly string[];
  /** Há comentário em texto (o texto em si nunca vem para cá). */
  hasComment: boolean;
  classified: boolean;
};

export type TopicCount = { key: string; label: string; count: number };

export type SurveySummary = {
  /** Pesquisas que o contato recebeu no período. */
  sent: number;
  /** Com nota. */
  answered: number;
  /** answered / sent, em %, limitado a 100. Null sem envio. */
  responseRatePercent: number | null;
  /** Média de 1 casa (ex.: 4.3). Null sem resposta. */
  average: number | null;
  /** Índice 0 = nota 1 … índice 4 = nota 5. Soma = answered. */
  distribution: [number, number, number, number, number];
  /** Os motivos mais citados (até 3), só chaves do conjunto fechado. */
  topTopics: TopicCount[];
  /** Todos os motivos contados, para a tela. */
  topics: TopicCount[];
  /** Comentários que a IA ainda não classificou (ou que não conseguiu). */
  unclassified: number;
  withComment: number;
};

export const EMPTY_DISTRIBUTION = (): SurveySummary["distribution"] => [0, 0, 0, 0, 0];

/** Média de 1 casa decimal, do mesmo jeito em toda tela. */
export const roundAverage = (sum: number, n: number): number | null => (n > 0 ? Math.round((sum / n) * 10) / 10 : null);

export function summarizeSurveys(sent: number, rated: readonly RatedSurvey[]): SurveySummary {
  const distribution = EMPTY_DISTRIBUTION();
  const counts = new Map<string, number>();
  let sum = 0;
  let answered = 0;
  let unclassified = 0;
  let withComment = 0;

  for (const s of rated) {
    if (!Number.isInteger(s.rating) || s.rating < 1 || s.rating > 5) continue;
    answered++;
    sum += s.rating;
    distribution[s.rating - 1]++;
    if (s.hasComment) {
      withComment++;
      if (!s.classified) unclassified++;
    }
    for (const key of new Set(s.topics)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Só chaves do conjunto fechado; ordem estável (contagem, depois a ordem do catálogo).
  const order = new Map<string, number>(SURVEY_TOPICS.map((t, i) => [t.key, i]));
  const topics = [...counts.entries()]
    .filter(([key]) => order.has(key))
    .map(([key, count]) => ({ key, label: topicLabel(key), count }))
    .sort((a, b) => b.count - a.count || order.get(a.key)! - order.get(b.key)!);

  return {
    sent,
    answered,
    responseRatePercent: sent > 0 ? Math.min(100, Math.round((answered / sent) * 100)) : null,
    average: roundAverage(sum, answered),
    distribution,
    topTopics: topics.slice(0, TOP_TOPICS),
    topics,
    unclassified,
    withComment,
  };
}

/** A média só se mostra com respostas suficientes; antes disso é "amostra pequena". */
export const averageIsReliable = (answered: number) => answered >= MIN_ANSWERS_FOR_AVERAGE;
