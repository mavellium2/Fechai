import { dayKeyInZone, isKnownTimeZone, parseLocalDateTime, timeInZone } from "@/modules/scheduling/time";

/**
 * Período da campanha: o DIA que a pessoa escolhe na tela vira instante UTC e
 * volta a ser dia na hora de exibir. Toda a conta de fuso passa por
 * `scheduling/time.ts` — o servidor roda em UTC e "30/11" tem de ser o dia
 * 30 da clínica, não o de Greenwich.
 */

/**
 * A conta ainda não tem fuso próprio. Fica fixo em Brasília e é GRAVADO em
 * `Campaign.timezone` na criação, para que a campanha lembre em qual fuso foi
 * escolhida quando o fuso da conta existir.
 */
export const DEFAULT_CAMPAIGN_TIMEZONE = "America/Sao_Paulo";

/**
 * O fuso gravado na linha, ou Brasília se ele não existir para o `Intl` (linha
 * editada à mão, nome de fuso do Windows). Uma campanha nunca deve quebrar a
 * tela ou uma action por causa do texto de uma coluna.
 */
export function zoneOrDefault(timeZone: string | null | undefined): string {
  return timeZone && isKnownTimeZone(timeZone) ? timeZone : DEFAULT_CAMPAIGN_TIMEZONE;
}

/** Ano mínimo e máximo aceitos: barra o `0001-01-01` digitado sem querer. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** "2026-11-30" existe no calendário? ("2026-02-30" não, e a regex sozinha deixaria passar.) */
export function isRealDay(day: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, date));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === date;
}

/** Dia real e dentro da janela de anos aceita. */
export function isAcceptableDay(day: string): boolean {
  if (!isRealDay(day)) return false;
  const year = Number(day.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/** Dia seguinte, em "YYYY-MM-DD". Aritmética de calendário pura: não depende de fuso. */
function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/** 00:00 locais do dia, como instante UTC (em Brasília: 03:00Z). */
export function startOfDayUtc(day: string, timeZone: string): Date {
  const at = parseLocalDateTime(day, "00:00", timeZone);
  if (!at) throw new Error(`Dia inválido: ${day}`);
  return at;
}

/**
 * 23:59:59 locais do dia, como instante UTC (em Brasília: 02:59:59Z do dia
 * seguinte). Calculado como "0h do dia seguinte menos 1 segundo", e não como
 * 23:59 + 59s, porque `parseLocalDateTime` não tem segundos e porque assim a
 * virada de horário de verão (se o fuso tiver) não desloca o fim.
 */
export function endOfDayUtc(day: string, timeZone: string): Date {
  const next = parseLocalDateTime(nextDay(day), "00:00", timeZone);
  if (!next) throw new Error(`Dia inválido: ${day}`);
  return new Date(next.getTime() - 1000);
}

/** Dia local de um instante, em "YYYY-MM-DD" — o valor de um `<input type="date">`. Vazio sem data. */
export function dayOf(at: Date | null | undefined, timeZone: string): string {
  return at ? dayKeyInZone(at, timeZone) : "";
}

/** "2026-11-30" → "30/11/2026". */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** "13/11/2026 às 14:30", no fuso da campanha. */
export function formatDateTime(at: Date, timeZone: string): string {
  return `${formatDay(dayKeyInZone(at, timeZone))} às ${timeInZone(at, timeZone)}`;
}

/**
 * O período em uma linha, do jeito que a lista mostra:
 * `01/11 a 30/11/2026` (o ano só no fim quando é o mesmo), `01/11/2026` (um
 * dia só), `15/12/2026 a 15/01/2027`, `A partir de 01/11/2026`,
 * `Até 30/11/2026` e `Sem período definido`.
 */
export function formatPeriod(startsAt: Date | null, endsAt: Date | null, timeZone: string): string {
  const start = startsAt ? dayKeyInZone(startsAt, timeZone) : null;
  const end = endsAt ? dayKeyInZone(endsAt, timeZone) : null;

  if (start && end) {
    if (start === end) return formatDay(start);
    if (start.slice(0, 4) === end.slice(0, 4)) {
      const [, month, date] = start.split("-");
      return `${date}/${month} a ${formatDay(end)}`;
    }
    return `${formatDay(start)} a ${formatDay(end)}`;
  }
  if (start) return `A partir de ${formatDay(start)}`;
  if (end) return `Até ${formatDay(end)}`;
  return "Sem período definido";
}

/** Os dois dias da tela viram o par de instantes que vai para o banco. */
export function periodToUtc(
  startsOn: string | null,
  endsOn: string | null,
  timeZone: string,
): { startsAt: Date | null; endsAt: Date | null } {
  return {
    startsAt: startsOn ? startOfDayUtc(startsOn, timeZone) : null,
    endsAt: endsOn ? endOfDayUtc(endsOn, timeZone) : null,
  };
}
