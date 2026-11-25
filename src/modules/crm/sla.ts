/**
 * Selo de espera da coluna "Aguardando humano" no Kanban.
 *
 * A espera conta da entrada do lead na etapa (`LeadTransition` da dimensão
 * `stage`), que é o momento do transbordo. As cores seguem os prazos da conta
 * (CRM-10, `HandoffSlaSettings`; padrão 15 e 60 min). O selo mostra o tempo
 * corrido de verdade; os avisos do worker (`handoff-sla.ts`) é que podem
 * contar só o expediente. Aqui é só leitura para a tela, sem gravar nada.
 */
export const CRM_SLA_ALERT_MINUTES = 15;
export const CRM_SLA_ESCALATE_MINUTES = 60;

export type CrmSlaLevel = "ok" | "alert" | "late" | "unknown";
export type CrmSlaLimits = { alertMinutes: number; escalateMinutes: number };
const DEFAULT_LIMITS: CrmSlaLimits = { alertMinutes: CRM_SLA_ALERT_MINUTES, escalateMinutes: CRM_SLA_ESCALATE_MINUTES };

export function crmWaitMinutes(since: string | null, now: number): number | null {
  if (!since) return null;
  const at = Date.parse(since);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now - at) / 60_000));
}

export function crmSlaLevel(minutes: number | null, limits: CrmSlaLimits = DEFAULT_LIMITS): CrmSlaLevel {
  if (minutes === null) return "unknown";
  if (minutes >= limits.escalateMinutes) return "late";
  if (minutes >= limits.alertMinutes) return "alert";
  return "ok";
}

/** "23 min", "1 h 5 min", "2 d": o tempo por extenso, para selo, aviso e e-mail. */
export function crmDurationLabel(minutes: number) {
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.floor(hours / 24)} d`;
}

/** Texto do selo: a cor nunca é a única informação. */
export function crmSlaLabel(minutes: number | null, limits: CrmSlaLimits = DEFAULT_LIMITS): string {
  const level = crmSlaLevel(minutes, limits);
  if (level === "unknown" || minutes === null) return "Espera sem registro";
  const status = level === "late" ? "Atrasado" : level === "alert" ? "Atenção" : "No prazo";
  return `${status} · aguardando há ${crmDurationLabel(minutes)}`;
}
