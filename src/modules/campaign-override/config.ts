/**
 * Regra provisória da campanha de implantes (URG-01): o que mora em
 * `CampaignOverride.rules` e as constantes da campanha. Lida por
 * `parseOverrideRules`, que **nunca lança**: a linha pode ser null, antiga ou
 * editada à mão (mesmo padrão de `scheduling/config.ts`).
 */

/** Chave da regra da campanha de implantes de novembro de 2026. */
export const IMPLANTES_KEY = "implantes-2026-11";

/** Fim rígido de produção: 19/11/2026 23:59:59 em Brasília. */
export const IMPLANTES_ENDS_AT = new Date("2026-11-20T02:59:59.000Z");

/** Dias do evento (dia local, America/Sao_Paulo) e a hora única de início. */
export const IMPLANTES_DATES = ["2026-11-18", "2026-11-19"] as const;
export const IMPLANTES_TIME = "09:00";

export type OverrideRules = {
  /** Dias permitidos, "AAAA-MM-DD" no fuso da conta. */
  dates: string[];
  /** Hora de início única, "HH:mm". */
  time: string;
  /** Vagas por dia. Ausente = ainda não definidas. */
  capacityPerDay?: number;
  /** Texto da oferta para o agente (usado no PR-2). */
  offerText?: string;
};

export const DEFAULT_OVERRIDE_RULES: OverrideRules = {
  dates: [...IMPLANTES_DATES],
  time: IMPLANTES_TIME,
};

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/** Código de anúncio comparável: sem espaços, maiúsculo ("ad 27" → "AD27"). */
export function normalizeAdCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/\s+/g, "").toUpperCase();
  return code ? code : null;
}

/** Lê `rules` sem lançar. Campo faltando ou inválido cai no padrão da campanha. */
export function parseOverrideRules(json: unknown): OverrideRules {
  try {
    if (!json || typeof json !== "object" || Array.isArray(json)) return { ...DEFAULT_OVERRIDE_RULES, dates: [...DEFAULT_OVERRIDE_RULES.dates] };
    const raw = json as Record<string, unknown>;
    const dates = Array.isArray(raw.dates) ? [...new Set(raw.dates.filter(isValidDateKey))].sort() : [];
    const rules: OverrideRules = {
      dates: dates.length ? dates : [...DEFAULT_OVERRIDE_RULES.dates],
      time: isValidTime(raw.time) ? raw.time : DEFAULT_OVERRIDE_RULES.time,
    };
    if (typeof raw.capacityPerDay === "number" && Number.isInteger(raw.capacityPerDay) && raw.capacityPerDay >= 1) {
      rules.capacityPerDay = raw.capacityPerDay;
    }
    if (typeof raw.offerText === "string" && raw.offerText.trim()) rules.offerText = raw.offerText.trim();
    return rules;
  } catch {
    return { ...DEFAULT_OVERRIDE_RULES, dates: [...DEFAULT_OVERRIDE_RULES.dates] };
  }
}
