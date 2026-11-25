import { parseLocalDateTime } from "@/modules/scheduling/time";
import { crmOriginFilter, type CRM_ORIGIN_OPTIONS } from "./lead-origin";

export const CRM_TIME_ZONE = "America/Sao_Paulo";
export const CRM_COLUMN_SIZE = 20;
export const CRM_SEARCH_MAX = 80;
export const CRM_TAG_MAX = 40;
export const CRM_TASK_MAX = 240;
export type CrmSearchParams = Record<string, string | string[] | undefined>;

/** Busca global (`q`) e por coluna (`q_<etapa>`) do quadro. */
export type CrmSearches = { global: string; columns: Record<string, string> };

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

/** Teto de valores por filtro: a URL é de quem clica, não de quem monta à mão. */
export const CRM_FILTER_MAX_VALUES = 50;

/**
 * Um filtro pode ter vários valores, separados por vírgula na URL
 * (`etapa=a,b`). Um valor só é o formato antigo e continua valendo. Valor fora
 * do formato é descartado; repetido conta uma vez.
 */
function idList(value: string | string[] | undefined): string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(","))].filter(validCrmId).slice(0, CRM_FILTER_MAX_VALUES);
}

function originList(value: string | string[] | undefined) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map(crmOriginFilter))]
    .filter((origin): origin is keyof typeof CRM_ORIGIN_OPTIONS => origin !== "");
}

export function readCrmFilters(params: CrmSearchParams) {
  const from = dayStart(params.de);
  const to = dayStart(params.ate);
  const nextDay = to ? new Date(`${params.ate}T00:00:00Z`) : null;
  nextDay?.setUTCDate(nextDay.getUTCDate() + 1);
  const end = nextDay ? parseLocalDateTime(nextDay.toISOString().slice(0, 10), "00:00", CRM_TIME_ZONE) : null;
  return {
    // Dentro de um filtro vale qualquer um dos valores (ou); entre filtros, todos (e).
    stages: idList(params.etapa),
    tags: idList(params.etiqueta),
    assignees: idList(params.responsavel),
    origins: originList(params.origem),
    basis: params.periodo === "atividade" ? "atividade" as const : "entrada" as const,
    from: from ? String(params.de) : "",
    to: to ? String(params.ate) : "",
    invalidRange: Boolean(from && end && from >= end),
    range: { ...(from ? { gte: from } : {}), ...(end ? { lt: end } : {}) },
  };
}

/** Texto de busca: sem controle, sem excesso e sempre aparado. */
function searchText(value: string | string[] | undefined) {
  if (typeof value !== "string") return "";
  return value.replace(/\p{Cc}/gu, " ").trim().slice(0, CRM_SEARCH_MAX);
}

export function readCrmSearches(params: CrmSearchParams): CrmSearches {
  const columns: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const stage = /^q_([a-zA-Z0-9_-]{1,100})$/.exec(key);
    if (!stage) continue;
    const text = searchText(value);
    if (text) columns[stage[1]] = text;
  }
  return { global: searchText(params.q), columns };
}

export function crmBoardHref(params: CrmSearchParams, changes: Record<string, string | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && /^(etapa|etiqueta|responsavel|origem|periodo|de|ate|lead|antes|q|q_[a-zA-Z0-9_-]{1,100})$/.test(key)) query.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  return query.size ? `/crm?${query}` : "/crm";
}
