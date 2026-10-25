/**
 * Formatação de data/telefone para a interface, em pt-BR.
 *
 * O painel mostrava datas cruas (`toLocaleDateString`) e nenhum tempo relativo —
 * numa caixa de entrada, "há 12 minutos" responde a pergunta que "31/07/2026"
 * não responde: isso é recente?
 */

// O painel é brasileiro e o servidor pode rodar em UTC (produção). Sem fixar o
// fuso, "14:32" na tela era 11:32 quando o servidor estava em UTC — mesma
// regra da saudação de /inicio, que fixa Brasília para o "boa tarde" não virar
// "boa noite" no meio da tarde.
const PANEL_TIME_ZONE = "America/Sao_Paulo";

const RELATIVE = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "12 de julho de 2026", no fuso do painel. */
export function dateLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: PANEL_TIME_ZONE }).format(
    date,
  );
}

/** "12 jul, 14:32", no fuso do painel. */
export function dateTimeLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PANEL_TIME_ZONE,
  }).format(date);
}

/** "14:32" — horário de envio de uma mensagem no histórico, no fuso do painel. */
export function timeLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PANEL_TIME_ZONE,
  }).format(date);
}

/** "agora", "há 12 minutos", "há 3 dias". */
export function relativeTime(date: Date, now: Date = new Date()) {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);

  if (abs < MINUTE) return "agora";
  if (abs < HOUR) return RELATIVE.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return RELATIVE.format(Math.round(diff / HOUR), "hour");
  if (abs < 30 * DAY) return RELATIVE.format(Math.round(diff / DAY), "day");
  return dateLabel(date);
}

/** Versão curta para listas apertadas: "12min", "3h", "5d", "12 jul". */
export function shortAge(date: Date, now: Date = new Date()) {
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "agora";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}min`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: PANEL_TIME_ZONE,
  }).format(date);
}

/** Moeda em reais a partir de centavos: "R$ 1.234,56". Visão Financeira de /relatorios. */
export function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/**
 * Início do dia ("meia-noite") no fuso do painel, como instante UTC.
 *
 * `new Date(y,m,d)` interpretaria as partes no fuso do servidor — em UTC,
 * "hoje" viraria "ontem" no fim da tarde de Brasília. Aqui as partes são lidas
 * com `timeZone: America/Sao_Paulo` e montadas como se fossem UTC: é o mesmo
 * truque de `modules/scheduling/time.ts` (que não é importado aqui para o
 * `lib/format` não depender de um módulo de negócio).
 */
function startOfPanelDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PANEL_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

/** Separador de dia dentro do histórico: "hoje", "ontem" ou a data. */
export function dayLabel(date: Date, now: Date = new Date()) {
  const days = Math.round((startOfPanelDay(now) - startOfPanelDay(date)) / DAY);
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    timeZone: PANEL_TIME_ZONE,
  }).format(date);
}

/** Duas datas caem no mesmo dia de painel? (separador de dia no histórico) */
export function samePanelDay(a: Date, b: Date) {
  return startOfPanelDay(a) === startOfPanelDay(b);
}

/**
 * Telefone sintético: não é número de ninguém. O chat de teste cria um lead com
 * "sandbox" (contas antigas) ou "sandbox:<agentId>" (teste por agente, ver
 * `api/sandbox/route.ts`), e a simulação do MCP usa "mcp:<agentId>:<id>" (ver
 * `agent-mcp/simulate.ts`). Nenhum dá para ligar nem abrir no WhatsApp, e a
 * interface e o prompt precisam saber antes de oferecer a ação ou de expor a string.
 */
export function isSyntheticPhone(phone: string) {
  return phone === "sandbox" || phone.startsWith("sandbox:") || phone.startsWith("mcp:");
}

/** Telefone formatado para leitura: "(11) 98765-4321" quando reconhecível. */
export function phoneLabel(phone: string) {
  if (isSyntheticPhone(phone)) return "teste no sandbox";
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

/** Link de conversa direta no WhatsApp, ou `null` quando não há número real. */
export function waLink(phone: string) {
  if (isSyntheticPhone(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}`;
}
