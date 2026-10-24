/** `.ics` de exemplo, no formato que o iCloud devolve (CRLF, VTIMEZONE embutido). */

const wrap = (body: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18//EN", body, "END:VCALENDAR", ""].join("\r\n");

const SAO_PAULO_TZ = [
  "BEGIN:VTIMEZONE",
  "TZID:America/Sao_Paulo",
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:-0300",
  "TZOFFSETTO:-0300",
  "TZNAME:GMT-3",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

const event = (lines: string[]) => ["BEGIN:VEVENT", "DTSTAMP:20260101T000000Z", ...lines, "END:VEVENT"].join("\r\n");

/** 10/08/2026 10:00–11:00 (Brasília), toda segunda, 3 vezes; a de 17/08 foi excluída. */
export const WEEKLY = wrap(
  [
    SAO_PAULO_TZ,
    event([
      "UID:semanal-1",
      "DTSTART;TZID=America/Sao_Paulo:20260810T100000",
      "DTEND;TZID=America/Sao_Paulo:20260810T110000",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "EXDATE;TZID=America/Sao_Paulo:20260817T100000",
      "SUMMARY:Reunião semanal",
    ]),
  ].join("\r\n"),
);

/** Mesma série, com a ocorrência de 24/08 movida para 25/08 às 15:00. */
export const WEEKLY_WITH_EXCEPTION = wrap(
  [
    SAO_PAULO_TZ,
    event([
      "UID:semanal-2",
      "DTSTART;TZID=America/Sao_Paulo:20260810T100000",
      "DTEND;TZID=America/Sao_Paulo:20260810T110000",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "SUMMARY:Reunião",
    ]),
    event([
      "UID:semanal-2",
      "RECURRENCE-ID;TZID=America/Sao_Paulo:20260824T100000",
      "DTSTART;TZID=America/Sao_Paulo:20260825T150000",
      "DTEND;TZID=America/Sao_Paulo:20260825T160000",
      "SUMMARY:Reunião (movida)",
    ]),
  ].join("\r\n"),
);

/** Férias: dia inteiro 12 e 13/08/2026 (DTEND exclusivo, dia 14). */
export const ALL_DAY = wrap(
  event(["UID:ferias-1", "DTSTART;VALUE=DATE:20260812", "DTEND;VALUE=DATE:20260814", "SUMMARY:Férias"]),
);

/** Marcado como "livre" no iPhone. */
export const TRANSPARENT = wrap(
  event([
    "UID:livre-1",
    "DTSTART;TZID=America/Sao_Paulo:20260812T140000",
    "DTEND;TZID=America/Sao_Paulo:20260812T150000",
    "TRANSP:TRANSPARENT",
    "SUMMARY:Lembrete livre",
  ]),
);

export const CANCELLED = wrap(
  event([
    "UID:cancelado-1",
    "DTSTART;TZID=America/Sao_Paulo:20260812T140000",
    "DTEND;TZID=America/Sao_Paulo:20260812T150000",
    "STATUS:CANCELLED",
    "SUMMARY:Cancelado",
  ]),
);

/** Sem fuso (flutuante): vale o horário da parede da agenda. */
export const FLOATING = wrap(
  event(["UID:flut-1", "DTSTART:20260812T090000", "DTEND:20260812T100000", "SUMMARY:Sem fuso"]),
);

/** Em UTC: 12/08 17:00Z = 14:00 em Brasília. */
export const UTC_EVENT = wrap(
  event(["UID:utc-1", "DTSTART:20260812T170000Z", "DTEND:20260812T180000Z", "SUMMARY:Em UTC"]),
);

/** Em outro fuso: 12/08 10:00 em Nova York = 11:00 em Brasília. */
export const OTHER_ZONE = wrap(
  event([
    "UID:ny-1",
    "DTSTART;TZID=America/New_York:20260812T100000",
    "DTEND;TZID=America/New_York:20260812T110000",
    "SUMMARY:Em Nova York",
  ]),
);

/** O evento que o fechai gravou — o UID é o que a remarcação ignora. */
export const FECHAI_EVENT = wrap(
  event([
    "UID:fechai-abc123@fechai",
    "DTSTART;TZID=America/Sao_Paulo:20260812T140000",
    "DTEND;TZID=America/Sao_Paulo:20260812T150000",
    "SUMMARY:Maria — Implante",
    "DESCRIPTION:Procedimento: Implante\\nWhatsApp: 5511999990000",
    "LOCATION:Rua A\\, 10",
  ]),
);

/** Lixo: não é um calendário. */
export const BROKEN = "isto não é um arquivo iCalendar";

/** Evento sem UID: ilegível para nós. */
export const NO_UID = wrap(event(["DTSTART:20260812T090000", "DTEND:20260812T100000", "SUMMARY:Sem UID"]));

/** Todo dia, sem fim: serve para provar o teto de ocorrências. */
export const DAILY_FOREVER = wrap(
  [
    SAO_PAULO_TZ,
    event([
      "UID:diario-1",
      "DTSTART;TZID=America/Sao_Paulo:20260101T080000",
      "DTEND;TZID=America/Sao_Paulo:20260101T090000",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Todo dia",
    ]),
  ].join("\r\n"),
);
