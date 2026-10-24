import ICAL from "ical.js";
import { isKnownTimeZone, parseLocalDateTime, partsInZone, zonedTimeToUtc, zoneOffsetMinutes } from "./time";

/**
 * iCalendar (RFC 5545) do Calendário da Apple: escrita do evento do fechai e
 * leitura do que já está ocupado no iPhone. Funções puras — sem rede, sem banco.
 *
 * Duas decisões que valem ser lidas antes de mexer:
 *
 * - **O horário vai com o fuso da agenda (`TZID`) e um `VTIMEZONE`**, não em
 *   UTC. Em UTC o evento aparece certo, mas sem fuso: o iPhone de quem viaja
 *   o move junto com o relógio. O deslocamento sai de `time.ts`, a mesma
 *   tabela do resto do módulo.
 * - **Na leitura, o fuso que manda é o do arquivo.** Evento "flutuante" (sem
 *   fuso) é o horário da parede da agenda da clínica; dia inteiro bloqueia o
 *   dia local inteiro; `TRANSP:TRANSPARENT` ("livre") e `STATUS:CANCELLED`
 *   não ocupam ninguém.
 */

/** O UID do evento do fechai. Quem lê a agenda do iPhone reconhece o que é nosso por ele. */
export function eventUid(appointmentId: string): string {
  return `fechai-${appointmentId}@fechai`;
}

/** Inverso de `eventUid`: o id da consulta, ou null se o UID não é do fechai. */
export function appointmentIdFromUid(uid: string): string | null {
  const m = /^fechai-([A-Za-z0-9_-]+)(?:@fechai)?$/.exec(uid.trim());
  return m ? m[1] : null;
}

/** Prefixo do título do evento criado pelo chat de teste do agente. */
export const TEST_EVENT_PREFIX = "[TESTE fechai]";

export type IcloudEventInput = {
  appointmentId: string;
  /** Título da consulta no fechai; usado quando não há nome do paciente. */
  title: string;
  patientName?: string | null;
  procedure?: string | null;
  /** Telefone do contato (só dígitos ou formatado). Nunca vai em lead de teste. */
  phone?: string | null;
  notes?: string | null;
  /** `ScheduleConfig.location`. */
  location?: string | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  /** Chat de teste do agente: título marcado e sem telefone. */
  isTest?: boolean;
};

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Escape de valor TEXT (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Dobra a linha em 75 octetos (RFC 5545 §3.1), sem cortar um caractere ao meio. */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch, "utf8");
    // A continuação começa com um espaço, que também conta.
    const limit = out.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function localStamp(at: Date, timeZone: string): string {
  const p = partsInZone(at, timeZone);
  return `${pad(p.year, 4)}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}00`;
}

function utcStamp(at: Date): string {
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** TZID não precisa de escape, mas não pode carregar quebra de linha nem separador. */
function safeTzid(timeZone: string): string {
  return timeZone.replace(/[^A-Za-z0-9_+\-/]/g, "");
}

/**
 * O `VTIMEZONE` do evento: um período só, com o deslocamento que vale no
 * horário da consulta. Um evento único não precisa da regra anual do horário
 * de verão, e inventar uma regra à mão erraria mais do que acertaria.
 */
function vtimezone(timeZone: string, at: Date): string[] {
  const offset = offsetText(zoneOffsetMinutes(at, timeZone));
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${safeTzid(timeZone)}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    `TZOFFSETFROM:${offset}`,
    `TZOFFSETTO:${offset}`,
    `TZNAME:${offset}`,
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/** "Maria — Implante": paciente e procedimento, com o prefixo do chat de teste. */
export function eventSummary(input: Pick<IcloudEventInput, "title" | "patientName" | "procedure" | "isTest">): string {
  const who = input.patientName?.trim() || input.title.trim() || "Consulta";
  const base = input.procedure?.trim() ? `${who} — ${input.procedure.trim()}` : who;
  return input.isTest ? `${TEST_EVENT_PREFIX} ${base}` : base;
}

/** O texto completo do evento (CRLF, dobrado). */
export function buildEvent(input: IcloudEventInput, now = new Date()): string {
  const tz = input.timeZone;
  const useUtc = tz === "UTC";
  const sameOffset = zoneOffsetMinutes(input.startsAt, tz) === zoneOffsetMinutes(input.endsAt, tz);

  const description = [
    input.procedure?.trim() ? `Procedimento: ${input.procedure.trim()}` : null,
    !input.isTest && input.phone?.trim() ? `WhatsApp: ${input.phone.trim()}` : null,
    input.notes?.trim() ? `Observações: ${input.notes.trim()}` : null,
  ].filter((x): x is string => Boolean(x));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mavellium//fechai//PT",
    "CALSCALE:GREGORIAN",
  ];

  if (useUtc) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${eventUid(input.appointmentId)}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${utcStamp(input.startsAt)}`,
      `DTEND:${utcStamp(input.endsAt)}`,
    );
  } else {
    lines.push(...vtimezone(tz, input.startsAt));
    lines.push(
      "BEGIN:VEVENT",
      `UID:${eventUid(input.appointmentId)}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART;TZID=${safeTzid(tz)}:${localStamp(input.startsAt, tz)}`,
      // Se o horário de verão virar no meio do evento, o fim vai em UTC: o
      // VTIMEZONE acima só descreve o deslocamento do início.
      sameOffset ? `DTEND;TZID=${safeTzid(tz)}:${localStamp(input.endsAt, tz)}` : `DTEND:${utcStamp(input.endsAt)}`,
    );
  }

  lines.push(`SUMMARY:${escapeText(eventSummary(input))}`);
  if (description.length) lines.push(`DESCRIPTION:${escapeText(description.join("\n"))}`);
  if (input.location?.trim()) lines.push(`LOCATION:${escapeText(input.location.trim())}`);
  lines.push(`LAST-MODIFIED:${utcStamp(now)}`, "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export type IcalOccurrence = {
  uid: string;
  startsAt: Date;
  /** Null quando o evento não tem fim (instante). Dia inteiro sempre tem. */
  endsAt: Date | null;
  allDay: boolean;
  /** Só o título: DESCRIPTION e LOCATION nunca saem daqui. */
  title: string;
  /** `TRANSP:TRANSPARENT` — aparece, mas não ocupa o horário. */
  free: boolean;
};

export type ParseOptions = {
  /** Intervalo de interesse, `[rangeStart, rangeEnd)`. */
  rangeStart: Date;
  rangeEnd: Date;
  /** Fuso da agenda: dá o dia local e o horário de evento sem fuso. */
  timeZone: string;
  /** Ao remarcar, o próprio evento do fechai não ocupa o novo horário. */
  ignoreUid?: string;
  /** Outros UIDs que não ocupam ninguém (eventos do fechai de consultas que já não estão marcadas). */
  ignoreUids?: ReadonlySet<string>;
  /** Teto de ocorrências devolvidas (recorrência diária explode rápido). */
  limit?: number;
};

export type ParseResult = {
  items: IcalOccurrence[];
  /** Eventos que não deu para ler. Contados, nunca escondidos. */
  skipped: number;
  /** Parou no `limit` — há mais ocorrências do que as devolvidas. */
  truncated: boolean;
};

const MAX_ITERATIONS = 20_000;

type Time = InstanceType<typeof ICAL.Time>;
type Comp = InstanceType<typeof ICAL.Component>;

function fieldsToInstant(t: Time, tzid: string | null, fallbackZone: string): Date {
  const ms = (t.second || 0) * 1000;
  if (tzid && isKnownTimeZone(tzid)) return new Date(zonedTimeToUtc(t.year, t.month, t.day, t.hour, t.minute, tzid).getTime() + ms);
  return new Date(zonedTimeToUtc(t.year, t.month, t.day, t.hour, t.minute, fallbackZone).getTime() + ms);
}

function tzidOf(prop: InstanceType<typeof ICAL.Property> | null): string | null {
  const v = prop?.getParameter("tzid");
  return typeof v === "string" && v ? v : null;
}

/** Um DTSTART/DTEND/RECURRENCE-ID como instante, olhando o `TZID` do próprio campo. */
function propInstant(prop: InstanceType<typeof ICAL.Property>, fallbackZone: string): { at: Date; allDay: boolean; time: Time } {
  const value = prop.getFirstValue() as Time;
  if (value.isDate) {
    return { at: zonedTimeToUtc(value.year, value.month, value.day, 0, 0, fallbackZone), allDay: true, time: value };
  }
  // `Z` no fim do valor: UTC de verdade. O ical.js marca a zona como "UTC".
  if (value.zone && value.zone.tzid === "UTC") {
    return {
      at: new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second)),
      allDay: false,
      time: value,
    };
  }
  const tzid = tzidOf(prop);
  if (tzid && !isKnownTimeZone(tzid) && value.zone && value.zone.tzid !== "floating") {
    // Nome que o Intl não conhece (ex.: do Windows), mas o arquivo traz o
    // VTIMEZONE: o ical.js sabe converter.
    return { at: value.toJSDate(), allDay: false, time: value };
  }
  return { at: fieldsToInstant(value, tzid, fallbackZone), allDay: false, time: value };
}

function daysBetween(a: Time, b: Time): number {
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.max(1, Math.round(ms / 86_400_000));
}

function textOf(comp: Comp, name: string): string {
  const v = comp.getFirstPropertyValue(name);
  return typeof v === "string" ? v : "";
}

type Base = {
  uid: string;
  title: string;
  free: boolean;
  allDay: boolean;
  startsAt: Date;
  /** Duração em ms (evento com hora) ou dias (dia inteiro). */
  durationMs: number;
  days: number;
  hasEnd: boolean;
  startTime: Time;
};

function readBase(ve: Comp, zone: string): Base {
  const uid = textOf(ve, "uid").trim();
  if (!uid) throw new Error("sem UID");
  const startProp = ve.getFirstProperty("dtstart");
  if (!startProp) throw new Error("sem DTSTART");
  const start = propInstant(startProp, zone);

  let durationMs = 0;
  let days = 1;
  let hasEnd = false;
  const endProp = ve.getFirstProperty("dtend");
  const durProp = ve.getFirstProperty("duration");
  if (endProp) {
    const end = propInstant(endProp, zone);
    hasEnd = true;
    if (start.allDay) days = daysBetween(start.time, end.time);
    else durationMs = Math.max(0, end.at.getTime() - start.at.getTime());
  } else if (durProp) {
    const seconds = (durProp.getFirstValue() as InstanceType<typeof ICAL.Duration>).toSeconds();
    hasEnd = true;
    if (start.allDay) days = Math.max(1, Math.ceil(seconds / 86_400));
    else durationMs = Math.max(0, seconds * 1000);
  }

  return {
    uid,
    title: textOf(ve, "summary").trim().slice(0, 200) || "(sem título)",
    free: textOf(ve, "transp").toUpperCase() === "TRANSPARENT",
    allDay: start.allDay,
    startsAt: start.at,
    durationMs,
    days,
    hasEnd,
    startTime: start.time,
  };
}

function occurrenceOf(base: Base, startsAt: Date, zone: string, startTime: Time): IcalOccurrence {
  if (base.allDay) {
    return {
      uid: base.uid,
      startsAt,
      endsAt: zonedTimeToUtc(startTime.year, startTime.month, startTime.day + base.days, 0, 0, zone),
      allDay: true,
      title: base.title,
      free: base.free,
    };
  }
  return {
    uid: base.uid,
    startsAt,
    endsAt: base.hasEnd && base.durationMs > 0 ? new Date(startsAt.getTime() + base.durationMs) : null,
    allDay: false,
    title: base.title,
    free: base.free,
  };
}

function overlaps(o: IcalOccurrence, opts: ParseOptions): boolean {
  const end = o.endsAt ?? o.startsAt;
  if (!o.endsAt) return o.startsAt >= opts.rangeStart && o.startsAt < opts.rangeEnd;
  return o.startsAt < opts.rangeEnd && end > opts.rangeStart;
}

/**
 * Expande os `.ics` (um por recurso CalDAV) nas ocorrências que tocam o
 * intervalo: RRULE/EXDATE, exceções por RECURRENCE-ID (que substituem a
 * ocorrência original, inclusive movida de dia), dia inteiro e fuso.
 *
 * Nunca lança. Evento ilegível entra em `skipped`.
 */
export function parseIcsOccurrences(icsList: string[], opts: ParseOptions): ParseResult {
  const limit = opts.limit ?? 500;
  const items: IcalOccurrence[] = [];
  let skipped = 0;
  let truncated = false;

  const push = (o: IcalOccurrence) => {
    if (opts.ignoreUid && o.uid === opts.ignoreUid) return;
    if (opts.ignoreUids?.has(o.uid)) return;
    if (!overlaps(o, opts)) return;
    if (items.length >= limit) { truncated = true; return; }
    items.push(o);
  };

  for (const ics of icsList) {
    let calendar: Comp;
    try {
      calendar = new ICAL.Component(ICAL.parse(ics));
    } catch {
      skipped++;
      continue;
    }

    const events = calendar.getAllSubcomponents("vevent");
    // Exceções por UID: a ocorrência original some, a exceção entra por conta própria.
    const overridden = new Map<string, Set<number>>();
    for (const ve of events) {
      try {
        const rid = ve.getFirstProperty("recurrence-id");
        if (!rid) continue;
        const uid = textOf(ve, "uid").trim();
        const set = overridden.get(uid) ?? new Set<number>();
        set.add(propInstant(rid, opts.timeZone).at.getTime());
        overridden.set(uid, set);
      } catch {
        // contado quando o evento for lido abaixo
      }
    }

    for (const ve of events) {
      try {
        if (textOf(ve, "status").toUpperCase() === "CANCELLED") continue;
        const base = readBase(ve, opts.timeZone);
        const isException = Boolean(ve.getFirstProperty("recurrence-id"));

        if (isException || !ve.hasProperty("rrule") && !ve.hasProperty("rdate")) {
          push(occurrenceOf(base, base.startsAt, opts.timeZone, base.startTime));
          continue;
        }

        const skip = overridden.get(base.uid);
        const iterator = new ICAL.Event(ve).iterator();
        let guard = 0;
        for (let next = iterator.next(); next; next = iterator.next()) {
          if (++guard > MAX_ITERATIONS) { truncated = true; break; }
          const at = base.allDay
            ? zonedTimeToUtc(next.year, next.month, next.day, 0, 0, opts.timeZone)
            : base.startTime.zone?.tzid === "UTC"
              ? new Date(Date.UTC(next.year, next.month - 1, next.day, next.hour, next.minute, next.second))
              : fieldsToInstant(next, tzidOf(ve.getFirstProperty("dtstart")), opts.timeZone);
          if (at >= opts.rangeEnd) break;
          if (skip?.has(at.getTime())) continue;
          const occurrence = occurrenceOf(base, at, opts.timeZone, next);
          if (overlaps(occurrence, opts)) push(occurrence);
          if (truncated) break;
        }
      } catch {
        skipped++;
      }
    }
  }

  items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { items, skipped, truncated };
}

export type BusyBlock = { startsAt: Date; endsAt: Date };

/** Início e fim (UTC) do dia local `YYYY-MM-DD`. */
export function localDayRange(day: string, timeZone: string): { start: Date; end: Date } | null {
  const start = parseLocalDateTime(day, "00:00", timeZone);
  if (!start) return null;
  const p = partsInZone(start, timeZone);
  return { start, end: zonedTimeToUtc(p.year, p.month, p.day + 1, 0, 0, timeZone) };
}

/**
 * O que está ocupado num dia local. Devolve `null` quando algo não pôde ser
 * lido: disponibilidade desconhecida nunca vira agenda vazia (mesma regra do
 * Clinicorp).
 */
export function parseBusyBlocks(
  icsList: string[],
  day: string,
  timeZone: string,
  ignoreUid?: string,
  ignoreUids?: ReadonlySet<string>,
): BusyBlock[] | null {
  const range = localDayRange(day, timeZone);
  if (!range) return null;
  const parsed = parseIcsOccurrences(icsList, {
    rangeStart: range.start, rangeEnd: range.end, timeZone, ignoreUid, ignoreUids, limit: 2000,
  });
  if (parsed.skipped > 0 || parsed.truncated) return null;
  return parsed.items
    .filter((o) => !o.free && o.endsAt && o.endsAt > o.startsAt)
    .map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt as Date }));
}
