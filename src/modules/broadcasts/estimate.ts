/**
 * Estimativa de quando um disparo começa e termina, para a tela de revisão.
 *
 * O ritmo vem do worker (`worker.ts`): lotes de 25 contatos, 250 ms entre
 * envios e ~10 s até o próximo lote. Com o tempo de resposta da Meta, dá uns
 * 60 por minuto — número conservador, por isso a tela diz "por volta de".
 * Só conta minutos dentro da faixa diária; o que não cabe vai para o dia
 * seguinte, como a fila faz. Puro: sem relógio, sem banco.
 */

export const BROADCAST_PER_MINUTE = 60;

const DAY = 24 * 60;

function minutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const value = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? value : null;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

export type BroadcastEstimate = {
  /** Dia e hora em que o primeiro envio sai. */
  startDay: string;
  startTime: string;
  /** O horário pedido caiu fora da faixa e o início foi empurrado. */
  delayed: boolean;
  /** Dia e hora aproximados do último envio. */
  endDay: string;
  endTime: string;
  /** Minutos de envio (só dentro da faixa). */
  sendingMinutes: number;
  /** Quantos dias o disparo ocupa (1 = termina no mesmo dia). */
  days: number;
};

/**
 * `today`/`nowTime` são o dia e a hora atuais **no fuso do disparo**; `date`/
 * `time` só valem quando agendado. Devolve `null` se a faixa for inválida.
 */
export function estimateBroadcast(o: {
  total: number;
  today: string;
  nowTime: string;
  scheduled?: { date: string; time: string } | null;
  windowStart: string;
  windowEnd: string;
}): BroadcastEstimate | null {
  const ws = minutes(o.windowStart);
  const we = minutes(o.windowEnd);
  if (ws === null || we === null || ws >= we) return null;
  const sched = o.scheduled && o.scheduled.date && minutes(o.scheduled.time) !== null ? o.scheduled : null;
  let day = sched ? sched.date : o.today;
  const wanted = sched ? minutes(sched.time)! : (minutes(o.nowTime) ?? 0);
  let start = wanted;
  if (start < ws) start = ws;
  else if (start >= we) {
    day = addDays(day, 1);
    start = ws;
  }
  const delayed = Boolean(sched) && (start !== wanted || day !== sched!.date);
  const startDay = day;
  const startTime = clock(start);

  const sendingMinutes = Math.max(1, Math.ceil(o.total / BROADCAST_PER_MINUTE));
  let left = sendingMinutes;
  let cursor = start;
  let days = 1;
  while (left > we - cursor) {
    left -= we - cursor;
    day = addDays(day, 1);
    cursor = ws;
    days++;
    if (days > 365) break;
  }
  const end = Math.min(cursor + left, DAY - 1);
  return { startDay, startTime, delayed, endDay: day, endTime: clock(end), sendingMinutes, days };
}

/** "cerca de 1 minuto", "cerca de 17 minutos", "cerca de 1 h 40 min". */
export function durationLabel(totalMinutes: number): string {
  if (totalMinutes < 60) return `cerca de ${totalMinutes} ${totalMinutes === 1 ? "minuto" : "minutos"}`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `cerca de ${h} h${m ? ` ${m} min` : ""}`;
}

/** "hoje", "amanhã" ou "dd/mm", relativo a `today`. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "hoje";
  if (day === addDays(today, 1)) return "amanhã";
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}
