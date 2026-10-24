import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caldavRequest, caldavStamp, deleteEvent, discoverCalendarHome, discoverPrincipal, getCtag, isIcloudUrl, listCalendars,
  putEvent, queryEvents, resolveIcloudUrl,
} from "@/modules/scheduling/caldav";
import * as xml from "./fixtures/icloud/caldav";
import * as ics from "./fixtures/icloud/ics";

const cred = { appleId: "dona@icloud.com", appPassword: "abcd-efgh-ijkl-mnop" };
const fetchMock = vi.fn();

const reply = (status: number, body = "", headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(body || null, { status, headers }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("caldav: endereços", () => {
  it("só aceita https em *.icloud.com", () => {
    expect(isIcloudUrl("https://caldav.icloud.com/")).toBe(true);
    expect(isIcloudUrl("https://p52-caldav.icloud.com:443/x/")).toBe(true);
    expect(isIcloudUrl("http://caldav.icloud.com/")).toBe(false);
    expect(isIcloudUrl("https://icloud.com.evil.com/")).toBe(false);
    expect(isIcloudUrl("https://evilicloud.com/")).toBe(false);
    expect(isIcloudUrl("não é url")).toBe(false);
  });

  it("resolve href relativo e tira a porta; recusa host de fora", () => {
    expect(resolveIcloudUrl("/a/b/", "https://caldav.icloud.com/")).toBe("https://caldav.icloud.com/a/b/");
    expect(resolveIcloudUrl("https://p52-caldav.icloud.com:443/a/", "https://caldav.icloud.com/")).toBe("https://p52-caldav.icloud.com/a/");
    expect(resolveIcloudUrl("https://evil.example/a/", "https://caldav.icloud.com/")).toBeNull();
  });

  it("não chama a rede para endereço que não é do iCloud", async () => {
    const res = await caldavRequest({ method: "PROPFIND", url: "https://evil.example/", cred });
    expect(res.kind).toBe("rejected");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("caldav: classificação das respostas", () => {
  const cases: [number, string][] = [
    [207, "ok"], [201, "ok"], [204, "ok"], [401, "auth"], [403, "forbidden"], [404, "not_found"],
    [412, "exists"], [500, "server"], [503, "server"], [400, "rejected"],
  ];
  for (const [status, kind] of cases) {
    it(`${status} -> ${kind}`, async () => {
      fetchMock.mockReturnValueOnce(reply(status));
      expect((await caldavRequest({ method: "PUT", url: "https://caldav.icloud.com/x.ics", cred })).kind).toBe(kind);
    });
  }

  it("timeout e falha de rede não lançam", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    fetchMock.mockRejectedValueOnce(timeout).mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await deleteEvent(cred, "https://caldav.icloud.com/x.ics")).kind).toBe("timeout");
    expect((await deleteEvent(cred, "https://caldav.icloud.com/x.ics")).kind).toBe("network");
  });

  it("manda Basic, expira em 6s e não segue redirect sozinho", async () => {
    fetchMock.mockReturnValueOnce(reply(207));
    await caldavRequest({ method: "PROPFIND", url: "https://caldav.icloud.com/", cred });
    const init = fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("dona@icloud.com:abcd-efgh-ijkl-mnop").toString("base64")}`);
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeDefined();
  });
});

describe("caldav: redirecionamento de partição", () => {
  it("segue o redirect para outro host do iCloud, repetindo método e corpo", async () => {
    fetchMock
      .mockReturnValueOnce(reply(301, "", { location: "https://p52-caldav.icloud.com/12345678/calendars/" }))
      .mockReturnValueOnce(reply(207, xml.CALENDARS_207));
    const res = await caldavRequest({ method: "PROPFIND", url: "https://caldav.icloud.com/x/", cred, body: "<x/>" });
    expect(res.kind).toBe("ok");
    expect(fetchMock.mock.calls[1][0]).toBe("https://p52-caldav.icloud.com/12345678/calendars/");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("PROPFIND");
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBe("<x/>");
  });

  it("redirect para fora do iCloud é recusado e a senha não vai junto", async () => {
    fetchMock.mockReturnValueOnce(reply(302, "", { location: "https://evil.example/steal" }));
    const res = await caldavRequest({ method: "PROPFIND", url: "https://caldav.icloud.com/", cred });
    expect(res.kind).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("laço de redirect termina", async () => {
    fetchMock.mockImplementation(() => reply(302, "", { location: "https://caldav.icloud.com/loop" }));
    const res = await caldavRequest({ method: "PROPFIND", url: "https://caldav.icloud.com/", cred });
    expect(res.kind).toBe("rejected");
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(7);
  });
});

describe("caldav: descoberta", () => {
  it("principal -> home (host de partição) -> calendários de eventos", async () => {
    fetchMock
      .mockReturnValueOnce(reply(207, xml.PRINCIPAL_207))
      .mockReturnValueOnce(reply(207, xml.HOME_207))
      .mockReturnValueOnce(reply(207, xml.CALENDARS_207));

    const principal = await discoverPrincipal(cred);
    expect(principal).toMatchObject({ ok: true, data: { principalUrl: xml.PRINCIPAL_URL } });
    const home = await discoverCalendarHome(cred, xml.PRINCIPAL_URL);
    expect(home).toMatchObject({ ok: true, data: { calendarHomeUrl: xml.HOME_URL } });
    const calendars = await listCalendars(cred, xml.HOME_URL);
    expect(calendars).toMatchObject({ ok: true });
    if (!calendars.ok) return;
    // Lembretes (só VTODO), entrada e a raiz ficam de fora.
    expect(calendars.data).toEqual([
      { url: xml.CAL_URL, name: "Consultório", color: "#1BADF8" },
      { url: xml.CAL_WORK, name: "Pessoal", color: null },
    ]);
  });

  it("401 na descoberta = senha recusada", async () => {
    fetchMock.mockReturnValueOnce(reply(401));
    expect(await discoverPrincipal(cred)).toEqual({ ok: false, status: 401, kind: "auth" });
  });

  it("principal fora do iCloud ou resposta que não é XML = rejeitado", async () => {
    fetchMock.mockReturnValueOnce(reply(207, xml.NOT_XML));
    expect((await discoverPrincipal(cred)).ok).toBe(false);
    fetchMock.mockReturnValueOnce(reply(207, xml.PRINCIPAL_207.replace("/12345678/principal/", "https://evil.example/p/")));
    expect((await discoverPrincipal(cred)).ok).toBe(false);
  });
});

describe("caldav: leitura", () => {
  it("REPORT com time-range e devolve os .ics já decodificados", async () => {
    fetchMock.mockReturnValueOnce(reply(207, xml.reportOf([ics.WEEKLY, ics.FECHAI_EVENT])));
    const res = await queryEvents(cred, xml.CAL_URL, new Date("2026-08-01T03:00:00Z"), new Date("2026-09-01T03:00:00Z"));
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toContain("BEGIN:VEVENT");
    expect(res.data[0]).toContain("RRULE:FREQ=WEEKLY;COUNT=3");
    const init = fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(init.method).toBe("REPORT");
    expect(init.headers.Depth).toBe("1");
    expect(String(init.body)).toContain('<c:time-range start="20260801T030000Z" end="20260901T030000Z"/>');
  });

  it("calendário vazio é lista vazia; resposta que não é Multi-Status é falha", async () => {
    fetchMock.mockReturnValueOnce(reply(207, xml.reportOf([])));
    expect(await queryEvents(cred, xml.CAL_URL, new Date(), new Date())).toMatchObject({ ok: true, data: [] });
    fetchMock.mockReturnValueOnce(reply(207, xml.NOT_XML));
    expect(await queryEvents(cred, xml.CAL_URL, new Date(), new Date())).toMatchObject({ ok: false, kind: "rejected" });
  });

  it("ctag", async () => {
    fetchMock.mockReturnValueOnce(reply(207, xml.ctagOf("FT=-@RU=abc@S=12")));
    expect(await getCtag(cred, xml.CAL_URL)).toMatchObject({ ok: true, data: "FT=-@RU=abc@S=12" });
  });

  it("formato do time-range", () => {
    expect(caldavStamp(new Date("2026-08-01T03:00:00.000Z"))).toBe("20260801T030000Z");
  });
});

describe("caldav: escrita", () => {
  it("PUT novo manda If-None-Match; sobrescrever não manda", async () => {
    fetchMock.mockReturnValueOnce(reply(201)).mockReturnValueOnce(reply(204));
    await putEvent(cred, "https://p52-caldav.icloud.com/x/fechai-1.ics", "ICS", { onlyIfNew: true });
    await putEvent(cred, "https://p52-caldav.icloud.com/x/fechai-1.ics", "ICS");
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers["If-None-Match"]).toBe("*");
    expect((fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers["If-None-Match"]).toBeUndefined();
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers["Content-Type"]).toContain("text/calendar");
  });
});
