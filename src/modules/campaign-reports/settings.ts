import { TIMEZONES, dayKeyInZone, partsInZone, zonedTimeToUtc } from "@/modules/scheduling/time";

/**
 * Envio semanal do relatório de campanhas, por conta (`CampaignReportSettings`).
 * Puro de propósito: a tela importa daqui. O destino é **um grupo** do WhatsApp
 * (escolhido aqui ou, sem escolha, o dos avisos de Perguntas) **ou um número**
 * (o da própria pessoa). Os dois ficam guardados: trocar de destino não apaga o
 * outro.
 */

/**
 * `refused`: o número digitado é de um contato que a clínica não pode procurar
 * por aqui (bloqueado, pediu para parar, ou fala pela API oficial da Meta).
 */
export type CampaignSendStatus = "sent" | "no_group" | "no_phone" | "no_channel" | "no_data" | "refused" | "failed";

export type CampaignDestination = "group" | "phone";

/** Importação do histórico de anúncios: pedida pela tela, executada pelo worker. */
export type HistoryImportStatus = "requested" | "running" | "done" | "failed";

export type CampaignSettings = {
  enabled: boolean;
  /** Domingo = 0, como `Date.getDay()`. */
  weekday: number;
  /** Hora local (0–23). */
  hour: number;
  timezone: string;
  destination: CampaignDestination;
  /** Grupo escolhido aqui; null = usa o grupo dos avisos de Perguntas. */
  groupId: string | null;
  groupName: string | null;
  /** Só dígitos, com 55 (ex.: 5511987654321). */
  phone: string | null;
  lastSentAt: Date | null;
  lastStatus: CampaignSendStatus | null;
  history: { status: HistoryImportStatus | null; at: Date | null; summary: string | null };
};

/** Sexta às 8h: o dia que o cliente pediu, com a semana fechada na quinta. */
export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  enabled: false,
  weekday: 5,
  hour: 8,
  timezone: "America/Sao_Paulo",
  destination: "group",
  groupId: null,
  groupName: null,
  phone: null,
  lastSentAt: null,
  lastStatus: null,
  history: { status: null, at: null, summary: null },
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

const STATUSES: CampaignSendStatus[] = ["sent", "no_group", "no_phone", "no_channel", "no_data", "refused", "failed"];
const HISTORY_STATUSES: HistoryImportStatus[] = ["requested", "running", "done", "failed"];

/** Importação "rodando" há mais que isto é worker que caiu no meio: a tela libera pedir de novo. */
export const HISTORY_STALE_MS = 30 * 60_000;
/** Quanto do passado a importação lê. Cobre o início de setembro de 2026 e o que a Evolution ainda guarda. */
export const HISTORY_IMPORT_DAYS = 60;

const MAX_GROUP_NAME = 100;

/** JID de grupo: dígitos (e "-" nos antigos) + `@g.us`. */
const GROUP_JID = /^\d[\d-]*@g\.us$/;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Lê a linha do banco (ou a ausência dela). Nunca lança: valor estranho cai no padrão. */
export function parseCampaignSettings(
  row: Partial<Record<string, unknown>> | null | undefined,
): CampaignSettings {
  const r = row ?? {};
  const int = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  const groupId = text(r.groupId);
  const phone = text(r.phone);
  return {
    enabled: r.enabled === true,
    weekday: int(r.weekday, 0, 6, DEFAULT_CAMPAIGN_SETTINGS.weekday),
    hour: int(r.hour, 0, 23, DEFAULT_CAMPAIGN_SETTINGS.hour),
    timezone:
      typeof r.timezone === "string" && TIMEZONES.some((z) => z.value === r.timezone)
        ? r.timezone
        : DEFAULT_CAMPAIGN_SETTINGS.timezone,
    destination: r.destination === "phone" ? "phone" : "group",
    groupId: groupId && GROUP_JID.test(groupId) ? groupId : null,
    groupName: groupId && GROUP_JID.test(groupId) ? text(r.groupName)?.slice(0, MAX_GROUP_NAME) ?? null : null,
    phone: phone && /^55\d{10,11}$/.test(phone) ? phone : null,
    lastSentAt: r.lastSentAt instanceof Date ? r.lastSentAt : null,
    lastStatus: STATUSES.includes(r.lastStatus as CampaignSendStatus) ? (r.lastStatus as CampaignSendStatus) : null,
    history: {
      status: HISTORY_STATUSES.includes(r.historyImportStatus as HistoryImportStatus)
        ? (r.historyImportStatus as HistoryImportStatus)
        : null,
      at: r.historyImportAt instanceof Date ? r.historyImportAt : null,
      summary: text(r.historyImportSummary),
    },
  };
}

/** "(11) 98765-4321" para mostrar o número guardado (5511987654321). */
export function formatReportPhone(phone: string): string {
  const local = phone.startsWith("55") ? phone.slice(2) : phone;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

/** A importação pode ser pedida de novo? Não enquanto uma está na fila ou rodando (e não travou). */
export function canRequestHistoryImport(h: CampaignSettings["history"], now: Date): boolean {
  if (h.status === "requested") return false;
  if (h.status === "running") return !h.at || now.getTime() - h.at.getTime() > HISTORY_STALE_MS;
  return true;
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
