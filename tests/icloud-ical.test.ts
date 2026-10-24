import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import {
  appointmentIdFromUid, buildEvent, escapeText, eventUid, foldLine, parseBusyBlocks, parseIcsOccurrences,
  TEST_EVENT_PREFIX,
} from "@/modules/scheduling/ical";
import * as ics from "./fixtures/icloud/ics";

const TZ = "America/Sao_Paulo";
const range = (from: string, to: string) => ({ rangeStart: new Date(from), rangeEnd: new Date(to), timeZone: TZ });
const iso = (d: Date | null) => d?.toISOString();

describe("escrita do evento", () => {
  const input = {
    appointmentId: "abc123",
    title: "Consulta",
    patientName: "Maria, da Silva",
    procedure: "Implante; molar",
    phone: "5511999990000",
    notes: "Linha 1\nLinha 2 \\ fim",
    location: "Rua A, 10",
    startsAt: new Date("2026-08-12T17:00:00Z"),
    endsAt: new Date("2026-08-12T18:00:00Z"),
    timeZone: TZ,
  };

  it("grava com TZID e VTIMEZONE do fuso da agenda, não em UTC", () => {
    const text = buildEvent(input, new Date("2026-08-01T00:00:00Z"));
    expect(text).toContain("DTSTART;TZID=America/Sao_Paulo:20260812T140000");
    expect(text).toContain("DTEND;TZID=America/Sao_Paulo:20260812T150000");
    expect(text).toContain("BEGIN:VTIMEZONE");
    expect(text).toContain("TZOFFSETTO:-0300");
    expect(text).toContain("UID:fechai-abc123@fechai");
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("é lido de volta pelo próprio parser, com o mesmo instante", () => {
    const text = buildEvent(input);
    const parsed = parseIcsOccurrences([text], range("2026-08-12T00:00:00Z", "2026-08-13T00:00:00Z"));
    expect(parsed.skipped).toBe(0);
    expect(parsed.items).toHaveLength(1);
    expect(iso(parsed.items[0].startsAt)).toBe("2026-08-12T17:00:00.000Z");
    expect(iso(parsed.items[0].endsAt)).toBe("2026-08-12T18:00:00.000Z");
    expect(parsed.items[0].title).toBe("Maria, da Silva — Implante; molar");
  });

  it("escapa vírgula, ponto e vírgula, barra e quebra de linha no texto", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const text = buildEvent(input);
    const comp = new ICAL.Component(ICAL.parse(text));
    const ve = comp.getFirstSubcomponent("vevent")!;
    expect(ve.getFirstPropertyValue("summary")).toBe("Maria, da Silva — Implante; molar");
    expect(ve.getFirstPropertyValue("description")).toBe(
      "Procedimento: Implante; molar\nWhatsApp: 5511999990000\nObservações: Linha 1\nLinha 2 \\ fim",
    );
    expect(ve.getFirstPropertyValue("location")).toBe("Rua A, 10");
  });

  it("dobra linhas em 75 octetos sem partir caractere acentuado", () => {
    const long = "ação".repeat(60);
    const folded = foldLine(`SUMMARY:${long}`);
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${long}`);
  });

  it("chat de teste: título marcado e sem o telefone", () => {
    const text = buildEvent({ ...input, isTest: true });
    expect(text).toContain(`SUMMARY:${TEST_EVENT_PREFIX}`.replace(/,/g, "\\,"));
    expect(text).not.toContain("5511999990000");
  });

  it("sem nome do paciente usa o título; sem procedimento não sobra traço", () => {
    const text = buildEvent({ ...input, patientName: null, procedure: null });
    const ve = new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent("vevent")!;
    expect(ve.getFirstPropertyValue("summary")).toBe("Consulta");
  });

  it("UTC vai em horário UTC, sem VTIMEZONE", () => {
    const text = buildEvent({ ...input, timeZone: "UTC" });
    expect(text).toContain("DTSTART:20260812T170000Z");
    expect(text).not.toContain("VTIMEZONE");
  });

  it("reconhece o UID do fechai", () => {
    expect(eventUid("abc")).toBe("fechai-abc@fechai");
    expect(appointmentIdFromUid("fechai-abc@fechai")).toBe("abc");
    expect(appointmentIdFromUid("fechai-abc")).toBe("abc");
    expect(appointmentIdFromUid("semanal-1")).toBeNull();
  });
});

describe("leitura: o que está ocupado", () => {
  const day = "2026-08-12";

  it("evento com fuso do arquivo", () => {
    expect(parseBusyBlocks([ics.OTHER_ZONE], day, TZ)?.map((b) => [iso(b.startsAt), iso(b.endsAt)]))
      .toEqual([["2026-08-12T14:00:00.000Z", "2026-08-12T15:00:00.000Z"]]);
    expect(parseBusyBlocks([ics.UTC_EVENT], day, TZ)?.map((b) => iso(b.startsAt))).toEqual(["2026-08-12T17:00:00.000Z"]);
  });

  it("evento sem fuso vale na hora da parede da agenda", () => {
    expect(parseBusyBlocks([ics.FLOATING], day, TZ)?.map((b) => iso(b.startsAt))).toEqual(["2026-08-12T12:00:00.000Z"]);
  });

  it("dia inteiro bloqueia o dia local inteiro, e só ele", () => {
    const blocks = parseBusyBlocks([ics.ALL_DAY], day, TZ)!;
    expect(blocks).toHaveLength(1);
    expect(iso(blocks[0].startsAt)).toBe("2026-08-12T03:00:00.000Z");
    expect(iso(blocks[0].endsAt)).toBe("2026-08-14T03:00:00.000Z");
    expect(parseBusyBlocks([ics.ALL_DAY], "2026-08-14", TZ)).toEqual([]);
    expect(parseBusyBlocks([ics.ALL_DAY], "2026-08-11", TZ)).toEqual([]);
  });

  it("livre e cancelado não ocupam", () => {
    expect(parseBusyBlocks([ics.TRANSPARENT, ics.CANCELLED], day, TZ)).toEqual([]);
  });

  it("recorrência: bloqueia a ocorrência do dia e respeita EXDATE", () => {
    expect(parseBusyBlocks([ics.WEEKLY], "2026-08-10", TZ)).toHaveLength(1);
    expect(parseBusyBlocks([ics.WEEKLY], "2026-08-17", TZ)).toEqual([]);
    expect(parseBusyBlocks([ics.WEEKLY], "2026-08-24", TZ)).toHaveLength(1);
    expect(parseBusyBlocks([ics.WEEKLY], "2026-08-31", TZ)).toEqual([]);
  });

  it("exceção de recorrência substitui a ocorrência original, inclusive movida de dia", () => {
    expect(parseBusyBlocks([ics.WEEKLY_WITH_EXCEPTION], "2026-08-24", TZ)).toEqual([]);
    const moved = parseBusyBlocks([ics.WEEKLY_WITH_EXCEPTION], "2026-08-25", TZ)!;
    expect(moved.map((b) => iso(b.startsAt))).toEqual(["2026-08-25T18:00:00.000Z"]);
  });

  it("a remarcação ignora o próprio evento do fechai, e só ele", () => {
    expect(parseBusyBlocks([ics.FECHAI_EVENT], day, TZ)).toHaveLength(1);
    expect(parseBusyBlocks([ics.FECHAI_EVENT], day, TZ, eventUid("abc123"))).toEqual([]);
    expect(parseBusyBlocks([ics.FECHAI_EVENT], day, TZ, eventUid("outro"))).toHaveLength(1);
  });

  it("arquivo ilegível ou evento sem UID: disponibilidade desconhecida (null), nunca vazia", () => {
    expect(parseBusyBlocks([ics.BROKEN], day, TZ)).toBeNull();
    expect(parseBusyBlocks([ics.NO_UID], day, TZ)).toBeNull();
    expect(parseBusyBlocks([ics.FLOATING, ics.BROKEN], day, TZ)).toBeNull();
  });

  it("recorrência sem fim: um dia lê só a ocorrência daquele dia", () => {
    expect(parseBusyBlocks([ics.DAILY_FOREVER], day, TZ)).toHaveLength(1);
  });

  it("dia inválido ou lista vazia", () => {
    expect(parseBusyBlocks([], day, TZ)).toEqual([]);
    expect(parseBusyBlocks([ics.FLOATING], "2026-13-40", TZ)).toBeNull();
  });
});

describe("leitura: itens para a agenda", () => {
  it("devolve título e horários, nunca descrição nem local", () => {
    const parsed = parseIcsOccurrences([ics.FECHAI_EVENT], range("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"));
    expect(parsed.items).toHaveLength(1);
    expect(Object.keys(parsed.items[0]).sort()).toEqual(["allDay", "endsAt", "free", "startsAt", "title", "uid"]);
    expect(JSON.stringify(parsed.items)).not.toContain("5511999990000");
    expect(JSON.stringify(parsed.items)).not.toContain("Rua A");
  });

  it("marca livre, dia inteiro e conta o ilegível em skipped", () => {
    const parsed = parseIcsOccurrences(
      [ics.TRANSPARENT, ics.ALL_DAY, ics.BROKEN, ics.NO_UID],
      range("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    );
    expect(parsed.items.find((i) => i.uid === "livre-1")?.free).toBe(true);
    expect(parsed.items.find((i) => i.uid === "ferias-1")?.allDay).toBe(true);
    expect(parsed.skipped).toBe(2);
  });

  it("teto de ocorrências: devolve até o limite e avisa que cortou", () => {
    const parsed = parseIcsOccurrences([ics.DAILY_FOREVER], { ...range("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"), limit: 10 });
    expect(parsed.items).toHaveLength(10);
    expect(parsed.truncated).toBe(true);
  });

  it("recorrência dentro do mês: série menos a excluída", () => {
    const parsed = parseIcsOccurrences([ics.WEEKLY], range("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"));
    expect(parsed.items.map((i) => iso(i.startsAt))).toEqual(["2026-08-10T13:00:00.000Z", "2026-08-24T13:00:00.000Z"]);
  });

  it("ordena por horário", () => {
    const parsed = parseIcsOccurrences([ics.UTC_EVENT, ics.FLOATING], range("2026-08-12T00:00:00Z", "2026-08-13T00:00:00Z"));
    expect(parsed.items.map((i) => i.uid)).toEqual(["flut-1", "utc-1"]);
  });
});
