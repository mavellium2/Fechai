import { parseLocalDateTime } from "@/modules/scheduling/time";
import { crmOriginFilter } from "./lead-origin";

export const CRM_TIME_ZONE = "America/Sao_Paulo";
export const CRM_COLUMN_SIZE = 20;
export const CRM_TAG_MAX = 40;
export const CRM_TASK_MAX = 240;
export type CrmSearchParams = Record<string, string | string[] | undefined>;

/** Filtro de responsável: uma pessoa da conta, ninguém ou atendimento humano sem autor conhecido. */
export const CRM_ASSIGNEE_NONE = "sem";
export const CRM_ASSIGNEE_UNIDENTIFIED = "nao-identificado";

export function validCrmId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function dayStart(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(+day) || day.toISOString().slice(0, 10) !== value ? null : parseLocalDateTime(value, "00:00", CRM_TIME_ZONE);
}

export function readCrmFilters(params: CrmSearchParams) {
  const from = dayStart(params.de);
  const to = dayStart(params.ate);
  const nextDay = to ? new Date(`${params.ate}T00:00:00Z`) : null;
  nextDay?.setUTCDate(nextDay.getUTCDate() + 1);
  const end = nextDay ? parseLocalDateTime(nextDay.toISOString().slice(0, 10), "00:00", CRM_TIME_ZONE) : null;
  return {
    stage: validCrmId(params.etapa) ? params.etapa : "",
    tag: validCrmId(params.etiqueta) ? params.etiqueta : "",
    assignee: validCrmId(params.responsavel) ? params.responsavel : "",
    origin: crmOriginFilter(params.origem),
    basis: params.periodo === "atividade" ? "atividade" as const : "entrada" as const,
    from: from ? String(params.de) : "",
    to: to ? String(params.ate) : "",
    invalidRange: Boolean(from && end && from >= end),
    range: { ...(from ? { gte: from } : {}), ...(end ? { lt: end } : {}) },
  };
}

export function crmColumnPage(params: CrmSearchParams, stageId: string, count: number) {
  const value = params[`p_${stageId}`];
  const page = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 1;
  const last = Math.max(1, Math.ceil(count / CRM_COLUMN_SIZE));
  return Math.min(last, Math.max(1, Number.isSafeInteger(page) ? page : 1));
}

export function crmBoardHref(params: CrmSearchParams, changes: Record<string, string | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && /^(etapa|etiqueta|responsavel|origem|periodo|de|ate|lead|antes|p_[a-zA-Z0-9_-]{1,100})$/.test(key)) query.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  return query.size ? `/crm?${query}` : "/crm";
}
