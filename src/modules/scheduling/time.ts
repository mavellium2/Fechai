/**
 * Conversão entre "9h da manhã em São Paulo" e um instante UTC.
 *
 * O banco guarda `Appointment.startsAt` em UTC (é o que o Postgres/Prisma
 * fazem), mas quem marca horário fala em hora local: o lead escreve "terça às
 * 15h", o dono do negócio lê a agenda no fuso dele, e o servidor pode estar em
 * qualquer lugar (em produção roda em UTC). Sem esta ponte, um agendamento
 * feito pelo agente saía com 3 horas de diferença.
 *
 * Sem dependência de biblioteca: `Intl.DateTimeFormat` já sabe os fusos e o
 * horário de verão do sistema — é a mesma tabela que o date-fns-tz consulta.
 */

const PAD = (n: number) => String(n).padStart(2, "0");

/** Quanto o fuso está deslocado do UTC neste instante, em milissegundos. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour` volta como 24 na virada do dia com hour12:false em alguns runtimes.
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asIfUtc - at.getTime();
}

/** Deslocamento do fuso em minutos neste instante (-180 = UTC-03:00). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  return Math.round(offsetMs(at, timeZone) / 60_000);
}

/** O fuso existe para o `Intl`? Nome inventado ou do Windows não existe. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Data/hora local de um fuso -> instante UTC.
 *
 * Duas passadas de propósito: o deslocamento depende do instante (horário de
 * verão), e o instante é justamente o que estamos calculando. A primeira usa um
 * palpite, a segunda corrige nas viradas de horário de verão.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** "2026-08-12" + "15:30" (hora do fuso) -> Date em UTC. Null se malformado. */
export function parseLocalDateTime(date: string, time: string, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;

  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const utc = zonedTimeToUtc(year, month, day, hour, minute, timeZone);
  return Number.isNaN(utc.getTime()) ? null : utc;
}

/** Partes da data no fuso do tenant — base de tudo que a tela desenha. */
export function partsInZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    /** Domingo = 0, como `Date.getDay()`. */
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

/** "2026-08-12" no fuso do tenant — chave estável para agrupar por dia. */
export function dayKeyInZone(at: Date, timeZone: string): string {
  const p = partsInZone(at, timeZone);
  return `${p.year}-${PAD(p.month)}-${PAD(p.day)}`;
}

/** "15:30" no fuso do tenant. */
export function timeInZone(at: Date, timeZone: string): string {
  const p = partsInZone(at, timeZone);
  return `${PAD(p.hour)}:${PAD(p.minute)}`;
}

/** "15:30:05" no fuso do tenant — o "atualizado às" da agenda ao vivo. */
export function clockInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/**
 * "terça-feira, 12 de agosto" — só o dia, por extenso. Separado de
 * `formatInZone` porque o lembrete tem `{{data}}` e `{{hora}}` como variáveis
 * independentes: quem escreve "sua consulta {{data}} às {{hora}}" não pode
 * receber o horário embutido na data.
 */
export function dateInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(at);
}

/** "ter, 12 de ago · 15:30" — rótulo curto usado na agenda e nas respostas. */
export function formatInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** Início (00:00 local) do mês que contém `ref`, como instante UTC. */
export function monthRangeUtc(year: number, month: number, timeZone: string) {
  const start = zonedTimeToUtc(year, month, 1, 0, 0, timeZone);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, timeZone);
  return { start, end };
}

/** Data local de "hoje" no fuso do tenant, como `{ year, month, day }`. */
export function todayInZone(timeZone: string) {
  const p = partsInZone(new Date(), timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Lista de fusos oferecida na configuração. Curta e brasileira de propósito. */
export const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília (São Paulo)" },
  { value: "America/Manaus", label: "Manaus" },
  { value: "America/Cuiaba", label: "Cuiabá" },
  { value: "America/Belem", label: "Belém" },
  { value: "America/Fortaleza", label: "Fortaleza" },
  { value: "America/Recife", label: "Recife" },
  { value: "America/Rio_Branco", label: "Rio Branco" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
  { value: "UTC", label: "UTC" },
];
