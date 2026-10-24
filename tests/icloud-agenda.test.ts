import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  icloudCalendarIntegration: { findUnique: vi.fn(), update: vi.fn() },
  calendarFeatures: { findUnique: vi.fn() },
  tenantAction: { findFirst: vi.fn() },
  agent: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { encryptSecret } from "@/lib/crypto";
import {
  clearIcloudAgendaCache, icloudAgendaCache, listIcloudAgenda, pushEventToIcloud, AGENDA_MAX_OCCURRENCES,
} from "@/modules/scheduling/icloud";
import { appointmentIdFromUid } from "@/modules/scheduling/ical";
import * as xml from "./fixtures/icloud/caldav";
import * as ics from "./fixtures/icloud/ics";

const APPLE_ID = "dona.clinica@icloud.com";
const PASSWORD = "abcd-efgh-ijkl-mnop";
const TZ = "America/Sao_Paulo";
const fetchMock = vi.fn();
const reply = (status: number, body = "") => Promise.resolve(new Response(body || null, { status }));

let row: Record<string, unknown> | null;
const baseRow = () => ({
  id: "i1", tenantId: "t1", appleId: encryptSecret(APPLE_ID), appPassword: encryptSecret(PASSWORD),
  principalUrl: xml.PRINCIPAL_URL, calendarHomeUrl: xml.HOME_URL, calendarUrl: xml.CAL_URL, calendarName: "Consultório",
  busyCalendarUrls: [], syncEnabled: true, checkAvailability: true, lastError: null, lastErrorAt: null, lastSyncAt: null,
  authFailedAt: null, connectionError: null, connectionErrorAt: null, lastCheckedAt: null,
});

/** Responde por método: PROPFIND (ctag ou lista de calendários) e REPORT (eventos). */
function server(state: { ctag: string; ics: string[]; status?: number }) {
  fetchMock.mockImplementation((url: string, init: RequestInit & { headers: Record<string, string> }) => {
    if (init.method === "REPORT") return state.status ? reply(state.status) : reply(207, xml.reportOf(state.ics));
    if (String(init.body).includes("getctag")) return reply(207, xml.ctagOf(state.ctag));
    if (String(init.body).includes("displayname")) return reply(207, xml.CALENDARS_207);
    if (init.method === "PUT") return reply(201);
    return reply(500);
  });
}
const reports = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === "REPORT");
const month = (from = "2026-08-01", to = "2026-08-31", opts?: { fresh?: boolean }) => listIcloudAgenda("t1", from, to, TZ, opts);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
  vi.resetAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "chave-de-testes-com-mais-de-32-caracteres");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  row = baseRow();
  db.icloudCalendarIntegration.findUnique.mockImplementation(async () => (row ? { ...row } : null));
  db.icloudCalendarIntegration.update.mockResolvedValue({});
  db.calendarFeatures.findUnique.mockResolvedValue({ icloudEnabled: true });
  db.tenantAction.findFirst.mockResolvedValue(null);
  db.agent.findFirst.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  clearIcloudAgendaCache();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("agenda do iPhone na /agenda", () => {
  it.each([
    ["desabilitada em /integracoes", () => db.calendarFeatures.findUnique.mockResolvedValue({ icloudEnabled: false })],
    ["não conectada", () => { row = null; }],
    ["sem calendário escolhido", () => { row = { ...baseRow(), calendarUrl: null }; }],
    ["senha revogada", () => { row = { ...baseRow(), authFailedAt: new Date() }; }],
  ])("%s: off, sem chamar a Apple", async (_name, arrange) => {
    arrange();
    expect(await month()).toEqual({ status: "off" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("devolve só título, horário e calendário — nunca descrição, local nem telefone", async () => {
    server({ ctag: "c1", ics: [ics.FECHAI_EVENT, ics.UTC_EVENT, ics.TRANSPARENT] });
    const res = await month();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.items.map((i) => i.title).sort()).toEqual(["Em UTC", "Lembrete livre", "Maria — Implante"]);
    expect(res.items.every((i) => i.calendarName === "Consultório")).toBe(true);
    const text = JSON.stringify(res);
    expect(text).not.toContain("5511999990000");
    expect(text).not.toContain("Rua A");
    expect(text).not.toContain("DESCRIPTION");
    expect(res.items.find((i) => i.uid === "livre-1")?.free).toBe(true);
  });

  it("junta o calendário de gravação e os marcados como ocupado, cada item com o nome do seu", async () => {
    row = { ...baseRow(), busyCalendarUrls: [xml.CAL_WORK] };
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "REPORT") return reply(207, xml.reportOf(url === xml.CAL_URL ? [ics.UTC_EVENT] : [ics.FLOATING]));
      if (String(init.body).includes("getctag")) return reply(207, xml.ctagOf("c1"));
      return reply(207, xml.CALENDARS_207);
    });
    const res = await month();
    if (res.status !== "ok") throw new Error("esperava ok");
    expect(Object.fromEntries(res.items.map((i) => [i.uid, i.calendarName]))).toEqual({ "utc-1": "Consultório", "flut-1": "Pessoal" });
  });

  it("recorrência dentro do mês, dia inteiro e fuso", async () => {
    server({ ctag: "c1", ics: [ics.WEEKLY, ics.ALL_DAY, ics.OTHER_ZONE] });
    const res = await month();
    if (res.status !== "ok") throw new Error("esperava ok");
    expect(res.items.filter((i) => i.uid === "semanal-1").map((i) => i.startsAt.toISOString())).toEqual(["2026-08-10T13:00:00.000Z", "2026-08-24T13:00:00.000Z"]);
    expect(res.items.find((i) => i.uid === "ferias-1")).toMatchObject({ allDay: true });
    expect(res.items.find((i) => i.uid === "ny-1")?.startsAt.toISOString()).toBe("2026-08-12T14:00:00.000Z");
  });

  it("linha ilegível vira skipped, nunca some em silêncio", async () => {
    server({ ctag: "c1", ics: [ics.UTC_EVENT, ics.BROKEN, ics.NO_UID] });
    const res = await month();
    expect(res).toMatchObject({ status: "ok", skipped: 2 });
  });

  it("teto de ocorrências no mês, avisando que cortou", async () => {
    server({ ctag: "c1", ics: [ics.DAILY_FOREVER] });
    const res = await month("2026-08-01", "2026-08-31");
    expect(res).toMatchObject({ status: "ok", truncated: false });
    expect(AGENDA_MAX_OCCURRENCES).toBe(500);
    // Vários anos de uma recorrência diária estouram o teto.
    const long = await month("2026-01-01", "2030-12-31");
    expect(long).toMatchObject({ status: "ok", truncated: true });
    if (long.status === "ok") expect(long.items).toHaveLength(500);
  });

  it("a UID do fechai é reconhecida para a tela deduplicar", async () => {
    server({ ctag: "c1", ics: [ics.FECHAI_EVENT] });
    const res = await month();
    if (res.status !== "ok") throw new Error("esperava ok");
    expect(appointmentIdFromUid(res.items[0].uid)).toBe("abc123");
  });
});

describe("falhas: erro explícito, sem gravar lastError", () => {
  it.each([[500], [401], [403]])("%i vira erro com texto amigável", async (status) => {
    server({ ctag: "c1", ics: [], status });
    const res = await month();
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error).toMatch(/Calendário da Apple|senha de app/);
      expect(res.error).not.toContain(PASSWORD);
    }
    expect(db.icloudCalendarIntegration.update).not.toHaveBeenCalled();
  });

  it("rede caindo e banco fora do ar não lançam", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect((await month()).status).toBe("error");
    clearIcloudAgendaCache();
    db.icloudCalendarIntegration.findUnique.mockRejectedValue(new Error("db"));
    await expect(month()).resolves.toMatchObject({ status: "error" });
  });

  it("período inválido", async () => {
    server({ ctag: "c1", ics: [] });
    expect((await month("2026-99-01", "2026-99-31")).status).toBe("error");
  });
});

describe("cache", () => {
  it("o segundo pedido do mesmo mês não vai à Apple; outro mês vai", async () => {
    server({ ctag: "c1", ics: [ics.UTC_EVENT] });
    await month();
    const calls = fetchMock.mock.calls.length;
    await month();
    expect(fetchMock.mock.calls.length).toBe(calls);
    await month("2026-09-01", "2026-09-30");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it("pedidos simultâneos compartilham a mesma leitura", async () => {
    server({ ctag: "c1", ics: [ics.UTC_EVENT] });
    await Promise.all([month(), month(), month()]);
    expect(reports()).toHaveLength(1);
  });

  it("a leitura vale 30 minutos; depois relê", async () => {
    server({ ctag: "c1", ics: [ics.UTC_EVENT] });
    await month();
    vi.setSystemTime(new Date("2026-08-05T12:29:00Z"));
    await month();
    expect(reports()).toHaveLength(1);
    vi.setSystemTime(new Date("2026-08-05T12:31:00Z"));
    await month();
    expect(reports()).toHaveLength(2);
  });

  it("erro fica só 10 segundos: o pulso seguinte tenta de novo", async () => {
    server({ ctag: "c1", ics: [], status: 500 });
    await month();
    vi.setSystemTime(new Date("2026-08-05T12:00:05Z"));
    await month();
    expect(reports()).toHaveLength(1);
    server({ ctag: "c1", ics: [ics.UTC_EVENT] });
    vi.setSystemTime(new Date("2026-08-05T12:00:11Z"));
    expect((await month()).status).toBe("ok");
  });

  it("fresh com o mesmo ctag reaproveita os eventos, sem REPORT", async () => {
    server({ ctag: "c1", ics: [ics.UTC_EVENT] });
    const first = await month();
    vi.setSystemTime(new Date("2026-08-05T12:00:20Z"));
    const second = await month("2026-08-01", "2026-08-31", { fresh: true });
    expect(reports()).toHaveLength(1);
    if (first.status === "ok" && second.status === "ok") {
      expect(second.items).toEqual(first.items);
      expect(second.fetchedAt).toBeGreaterThan(first.fetchedAt);
    } else throw new Error("esperava ok");
  });

  it("fresh com ctag diferente relê o mês", async () => {
    server({ ctag: "c1", ics: [ics.UTC_EVENT] });
    await month();
    server({ ctag: "c2", ics: [ics.UTC_EVENT, ics.FLOATING] });
    const second = await month("2026-08-01", "2026-08-31", { fresh: true });
    expect(reports()).toHaveLength(2);
    expect(second.status === "ok" && second.items.length).toBe(2);
  });

  it("fresh que não consegue ler o ctag (null) não confia no cache", async () => {
    server({ ctag: "c1", ics: [ics.UTC_EVENT] });
    await month();
    fetchMock.mockImplementation((_u: string, init: RequestInit) =>
      String(init.body).includes("getctag") ? reply(500) : init.method === "REPORT" ? reply(207, xml.reportOf([ics.UTC_EVENT])) : reply(207, xml.CALENDARS_207));
    await month("2026-08-01", "2026-08-31", { fresh: true });
    expect(reports()).toHaveLength(2);
  });

  it("escrever no calendário limpa o cache da conta (o evento recém-enviado aparece)", async () => {
    server({ ctag: "c1", ics: [] });
    await month();
    expect(reports()).toHaveLength(1);
    await pushEventToIcloud("t1", {
      appointmentId: "abc123", title: "Consulta", startsAt: new Date("2026-08-12T17:00:00Z"), endsAt: new Date("2026-08-12T18:00:00Z"), timeZone: TZ,
    });
    await month();
    expect(reports()).toHaveLength(2);
  });

  it("não vaza entre contas e respeita o teto de entradas", async () => {
    server({ ctag: "c1", ics: [] });
    await month();
    clearIcloudAgendaCache("outra-conta");
    expect(icloudAgendaCache().size).toBe(1);
    clearIcloudAgendaCache("t1");
    expect(icloudAgendaCache().size).toBe(0);
    for (let day = 1; day <= 28; day++) {
      for (const m of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"]) {
        await month(`2026-${m}-${String(day).padStart(2, "0")}`, `2026-${m}-${String(day).padStart(2, "0")}`);
      }
    }
    expect(icloudAgendaCache().size).toBeLessThanOrEqual(300);
  });
});
