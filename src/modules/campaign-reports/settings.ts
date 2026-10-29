import { TIMEZONES, dayKeyInZone, partsInZone, zonedTimeToUtc } from "@/modules/scheduling/time";

/**
 * Envio semanal do relatório de campanhas, por conta (`CampaignReportSettings`).
 * Puro de propósito: a tela importa daqui. O destino não mora aqui: é o grupo
 * das perguntas sem resposta (`KnowledgeGapSettings.groupId`), para a clínica
 * ter um grupo interno só.
 */

export type CampaignSendStatus = "sent" | "no_group" | "no_channel" | "no_data" | "failed";

export type CampaignSettings = {
  enabled: boolean;
  /** Domingo = 0, como `Date.getDay()`. */
  weekday: number;
  /** Hora local (0–23). */
  hour: number;
  timezone: string;
  lastSentAt: Date | null;
  lastStatus: CampaignSendStatus | null;
};

/** Sexta às 8h: o dia que o cliente pediu, com a semana fechada na quinta. */
export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  enabled: false,
  weekday: 5,
  hour: 8,
  timezone: "America/Sao_Paulo",
  lastSentAt: null,
  lastStatus: null,
};

export const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

const STATUSES: CampaignSendStatus[] = ["sent", "no_group", "no_channel", "no_data", "failed"];

/** Lê a linha do banco (ou a ausência dela). Nunca lança: valor estranho cai no padrão. */
export function parseCampaignSettings(
  row: Partial<Record<keyof CampaignSettings, unknown>> | null | undefined,
): CampaignSettings {
  const r = row ?? {};
  const int = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  return {
    enabled: r.enabled === true,
    weekday: int(r.weekday, 0, 6, DEFAULT_CAMPAIGN_SETTINGS.weekday),
    hour: int(r.hour, 0, 23, DEFAULT_CAMPAIGN_SETTINGS.hour),
    timezone:
      typeof r.timezone === "string" && TIMEZONES.some((z) => z.value === r.timezone)
        ? r.timezone
        : DEFAULT_CAMPAIGN_SETTINGS.timezone,
    lastSentAt: r.lastSentAt instanceof Date ? r.lastSentAt : null,
    lastStatus: STATUSES.includes(r.lastStatus as CampaignSendStatus) ? (r.lastStatus as CampaignSendStatus) : null,
  };
}

/**
 * Quanto o worker ainda pode atrasar depois da hora marcada e mesmo assim
 * enviar. Worker parado às 8h e de volta às 9h manda; de volta à noite, não —
 * o relatório da semana não pode chegar quando ninguém mais está olhando.
 */
export const SEND_GRACE_MS = 6 * 3_600_000;

/**
 * O instante marcado de HOJE (no fuso da conta), se `now` está dentro da janela
 * de envio dele: dia da semana certo, já passou da hora e dentro da tolerância
 * (sem atravessar a meia-noite). `null` = não é hora de enviar.
 */
export function currentSlot(now: Date, s: Pick<CampaignSettings, "weekday" | "hour" | "timezone">): Date | null {
  const p = partsInZone(now, s.timezone);
  if (p.weekday !== s.weekday) return null;
  const slot = zonedTimeToUtc(p.year, p.month, p.day, s.hour, 0, s.timezone);
  const late = now.getTime() - slot.getTime();
  if (late < 0 || late > SEND_GRACE_MS) return null;
  return dayKeyInZone(slot, s.timezone) === dayKeyInZone(now, s.timezone) ? slot : null;
}

/**
 * A semana do relatório: os 7 dias que terminam na meia-noite local de hoje
 * (hoje fica de fora, porque ainda está acontecendo), mais os 7 anteriores para
 * a comparação. Sexta às 8h cobre de sexta passada até quinta à noite.
 */
export function weekWindow(now: Date, timezone: string): { from: Date; to: Date; prevFrom: Date } {
  const p = partsInZone(now, timezone);
  const midnight = (daysBack: number) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day - daysBack));
    return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, timezone);
  };
  return { from: midnight(7), to: midnight(0), prevFrom: midnight(14) };
}

/** "sexta-feira às 08:00 (Brasília)" — o resumo de uma linha do envio. */
export function describeCampaignSchedule(s: CampaignSettings): string {
  const zone = TIMEZONES.find((z) => z.value === s.timezone)?.label ?? s.timezone;
  return `${WEEKDAYS[s.weekday].toLowerCase()} às ${String(s.hour).padStart(2, "0")}:00 (${zone})`;
}
