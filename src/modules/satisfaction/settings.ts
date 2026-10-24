import { TIMEZONES } from "@/modules/scheduling/time";

/**
 * Pesquisa de satisfação por conta (`SatisfactionSurveySettings`). Puro de
 * propósito: a tela importa daqui.
 *
 * Não é config de ação (`TenantAction.config`): a pesquisa não é uma habilidade
 * do catálogo e não pode comer vaga do plano — mesma lição de
 * `knowledge-gaps/settings.ts`. Sem linha no banco = desligada.
 *
 * Os textos são os que a clínica aprova com a Mavellium fora do sistema: aqui
 * só se editam. Texto vazio (ou igual ao padrão) volta ao padrão.
 */

export const SURVEY_DELAY_MIN = 30;
export const SURVEY_DELAY_MAX = 1200;
export const SURVEY_TEXT_MAX = 400;

export const DEFAULT_SURVEY_TEXTS = {
  rating: "De 1 a 5, como foi seu atendimento com a gente?",
  low: "Poxa, o que a gente poderia melhorar?",
  high: "Que bom! O que você mais gostou? E tem algo que poderia ser melhor?",
  thanks: "Obrigado pelo retorno! Se precisar de algo, é só mandar mensagem.",
} as const;

export type SurveyTexts = { rating: string; low: string; high: string; thanks: string };

export type SurveySettings = {
  enabled: boolean;
  /** Silêncio (min) depois da última fala do agente para a conversa contar como terminada. */
  delayMinutes: number;
  /** Horas locais em que a pesquisa pode sair: de `windowStartHour` inclusive até `windowEndHour` exclusive. */
  windowStartHour: number;
  windowEndHour: number;
  timezone: string;
  /** Textos efetivos (padrão já aplicado). */
  texts: SurveyTexts;
  /** Quais textos a clínica trocou — a tela mostra o padrão nos demais. */
  customized: Record<keyof SurveyTexts, boolean>;
};

export const DEFAULT_SURVEY_SETTINGS: SurveySettings = {
  enabled: false,
  delayMinutes: 180,
  windowStartHour: 8,
  windowEndHour: 20,
  timezone: "America/Sao_Paulo",
  texts: { ...DEFAULT_SURVEY_TEXTS },
  customized: { rating: false, low: false, high: false, thanks: false },
};

type Row = Partial<Record<
  "enabled" | "delayMinutes" | "windowStartHour" | "windowEndHour" | "timezone" | "ratingText" | "lowText" | "highText" | "thanksText",
  unknown
>>;

const hourOr = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

function textOr(v: unknown, fallback: string): { value: string; custom: boolean } {
  const t = typeof v === "string" ? v.trim().slice(0, SURVEY_TEXT_MAX) : "";
  return t && t !== fallback ? { value: t, custom: true } : { value: fallback, custom: false };
}

/** Lê a linha do banco (ou a ausência dela). Nunca lança: valor estranho cai no padrão. */
export function parseSurveySettings(row: Row | null | undefined): SurveySettings {
  const r = row ?? {};
  const d = DEFAULT_SURVEY_SETTINGS;
  let start = hourOr(r.windowStartHour, d.windowStartHour, 0, 23);
  let end = hourOr(r.windowEndHour, d.windowEndHour, 1, 24);
  // Janela vazia ou invertida não deixaria nada sair: volta ao padrão.
  if (end <= start) { start = d.windowStartHour; end = d.windowEndHour; }
  const delay = typeof r.delayMinutes === "number" && Number.isFinite(r.delayMinutes)
    ? Math.min(SURVEY_DELAY_MAX, Math.max(SURVEY_DELAY_MIN, Math.round(r.delayMinutes)))
    : d.delayMinutes;
  const rating = textOr(r.ratingText, DEFAULT_SURVEY_TEXTS.rating);
  const low = textOr(r.lowText, DEFAULT_SURVEY_TEXTS.low);
  const high = textOr(r.highText, DEFAULT_SURVEY_TEXTS.high);
  const thanks = textOr(r.thanksText, DEFAULT_SURVEY_TEXTS.thanks);
  return {
    enabled: r.enabled === true,
    delayMinutes: delay,
    windowStartHour: start,
    windowEndHour: end,
    timezone: typeof r.timezone === "string" && TIMEZONES.some((z) => z.value === r.timezone) ? r.timezone : d.timezone,
    texts: { rating: rating.value, low: low.value, high: high.value, thanks: thanks.value },
    customized: { rating: rating.custom, low: low.custom, high: high.custom, thanks: thanks.custom },
  };
}

/** Resumo de uma linha, para o card fechado. */
export function describeSurveySettings(s: SurveySettings): string {
  if (!s.enabled) return "desligada";
  const h = (n: number) => `${String(n).padStart(2, "0")}h`;
  const wait = s.delayMinutes % 60 === 0 ? `${s.delayMinutes / 60}h` : `${s.delayMinutes} min`;
  return `liga ${wait} depois da conversa, entre ${h(s.windowStartHour)} e ${h(s.windowEndHour)}`;
}

/** A nota 1–3 pede o que melhorar; 4–5, o que gostou (e o que melhorar). */
export const isLowRating = (rating: number) => rating <= 3;

/** Uma nota de 1 a 2 vira alerta no painel para revisar a conversa. */
export const needsReviewRating = (rating: number | null | undefined) => typeof rating === "number" && rating <= 2;

export const RATING_STARS = (n: number) => "⭐".repeat(Math.min(5, Math.max(1, n)));

/** Linhas da lista interativa da Meta (título até 24 caracteres). */
export const RATING_ROWS = [1, 2, 3, 4, 5].map((n) => ({ id: `rating_${n}`, title: `${n} ${RATING_STARS(n)}` }));

/** Texto numerado para o número por QR, que não tem botões nem lista. */
export function numberedPrompt(ratingText: string): string {
  return [
    ratingText,
    "",
    "Responda com um número de 1 a 5:",
    ...[1, 2, 3, 4, 5].map((n) => `${n} - ${RATING_STARS(n)}`),
  ].join("\n");
}
