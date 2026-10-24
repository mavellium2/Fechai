/**
 * Conjunto FECHADO de motivos da pesquisa de satisfação. A IA em segundo plano
 * só devolve chaves daqui (nunca texto livre), e é isso que o relatório conta:
 * "demora" tem o mesmo significado em todos os meses. Mudar uma chave órfã as
 * linhas antigas — acrescente, não renomeie.
 */
export const SURVEY_TOPICS = [
  { key: "demora", label: "Demora no atendimento" },
  { key: "nao_entendeu", label: "O agente não entendeu" },
  { key: "informacao_errada", label: "Informação errada" },
  { key: "preco", label: "Preço" },
  { key: "queria_pessoa", label: "Queria falar com uma pessoa" },
  { key: "agendamento_dificil", label: "Agendamento difícil" },
  { key: "tom_robotico", label: "Tom robótico" },
  { key: "outro", label: "Outro motivo" },
] as const;

export type SurveyTopicKey = (typeof SURVEY_TOPICS)[number]["key"];

/** Comentário que ainda não foi classificado, ou que a IA não soube encaixar. */
export const UNCLASSIFIED = "nao_classificado" as const;

export const SURVEY_TOPIC_KEYS: readonly string[] = SURVEY_TOPICS.map((t) => t.key);

export const isSurveyTopic = (v: unknown): v is SurveyTopicKey => typeof v === "string" && SURVEY_TOPIC_KEYS.includes(v);

export function topicLabel(key: string): string {
  if (key === UNCLASSIFIED) return "Sem classificação";
  return SURVEY_TOPICS.find((t) => t.key === key)?.label ?? "Outro motivo";
}

/** Só chaves do conjunto fechado, sem repetição, no máximo `max`. */
export function cleanTopics(input: unknown, max = 3): SurveyTopicKey[] {
  if (!Array.isArray(input)) return [];
  const out: SurveyTopicKey[] = [];
  for (const v of input) if (isSurveyTopic(v) && !out.includes(v)) out.push(v);
  return out.slice(0, max);
}
