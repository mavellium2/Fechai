import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  icloudCalendarIntegration: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  calendarFeatures: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { encryptSecret } from "@/lib/crypto";
import { checkIcloudCalendar } from "@/modules/scheduling/icloud";
import { HEALTH_EVERY_MS, scanIcloudHealth } from "@/modules/scheduling/icloud-health";
import * as xml from "./fixtures/icloud/caldav";

const APPLE_ID = "dona.clinica@icloud.com";
const PASSWORD = "abcd-efgh-ijkl-mnop";
const NOW = new Date("2026-10-06T15:00:00Z");
const fetchMock = vi.fn();
const reply = (status: number, body = "") => Promise.resolve(new Response(body || null, { status }));

let row: Record<string, unknown> | null;
const baseRow = () => ({
  id: "i1", tenantId: "t1", appleId: encryptSecret(APPLE_ID), appPassword: encryptSecret(PASSWORD),
  principalUrl: xml.PRINCIPAL_URL, calendarHomeUrl: xml.HOME_URL, calendarUrl: xml.CAL_URL, calendarName: "Consultório",
  busyCalendarUrls: [], syncEnabled: true, checkAvailability: true, lastError: "erro de envio antigo", lastErrorAt: new Date(),
  authFailedAt: null, connectionError: null, connectionErrorAt: null, lastCheckedAt: null,
});
let logged: string;
const written = () => db.icloudCalendarIntegration.update.mock.calls.map((c) => c[0].data as Record<string, unknown>);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "chave-de-testes-com-mais-de-32-caracteres");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  row = baseRow();
  logged = "";
  const capture = (...args: unknown[]) => { logged += args.map(String).join(" "); };
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  db.icloudCalendarIntegration.findUnique.mockImplementation(async () => (row ? { ...row } : null));
  db.icloudCalendarIntegration.update.mockResolvedValue({});
  db.icloudCalendarIntegration.findMany.mockResolvedValue([]);
  db.calendarFeatures.findUnique.mockResolvedValue({ icloudEnabled: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("checagem de uma conta", () => {
  it("207: tudo certo; limpa só o aviso de conexão, nunca o erro de envio", async () => {
    row = { ...baseRow(), connectionError: "O calendário sumiu", connectionErrorAt: new Date() };
    fetchMock.mockReturnValueOnce(reply(207, xml.ctagOf("ctag-1")));
    expect(await checkIcloudCalendar("t1")).toBe("ok");
    expect(written()).toEqual([{ connectionError: null, connectionErrorAt: null }]);
    expect(written()[0]).not.toHaveProperty("lastError");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("getctag");
    expect(fetchMock.mock.calls[0][1].headers.Depth).toBe("0");
  });

  it("207 sem aviso pendente não escreve no banco", async () => {
    fetchMock.mockReturnValueOnce(reply(207, xml.ctagOf("ctag-1")));
    expect(await checkIcloudCalendar("t1")).toBe("ok");
    expect(db.icloudCalendarIntegration.update).not.toHaveBeenCalled();
  });

  it("401: grava a queda da senha e o aviso, e para", async () => {
    fetchMock.mockReturnValueOnce(reply(401));
    expect(await checkIcloudCalendar("t1")).toBe("auth");
    const [data] = written();
    expect(data.authFailedAt).toBeInstanceOf(Date);
    expect(String(data.connectionError)).toContain("senha de app foi revogada");
    expect(JSON.stringify(data)).not.toContain(PASSWORD);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(APPLE_ID);
  });

  it.each([404, 403])("%i: o calendário escolhido não foi encontrado", async (status) => {
    fetchMock.mockReturnValueOnce(reply(status));
    expect(await checkIcloudCalendar("t1")).toBe("calendar");
    expect(String(written()[0].connectionError)).toContain("não foi encontrado");
    expect(written()[0]).not.toHaveProperty("authFailedAt");
  });

  it.each([
    ["5xx", () => fetchMock.mockReturnValueOnce(reply(503))],
    ["timeout", () => fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }))],
    ["rede", () => fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"))],
  ])("%s: a Apple oscilou, não grava nada", async (_name, arrange) => {
    arrange();
    expect(await checkIcloudCalendar("t1")).toBe("unreachable");
    expect(db.icloudCalendarIntegration.update).not.toHaveBeenCalled();
  });

  it.each([
    ["desabilitado", () => db.calendarFeatures.findUnique.mockResolvedValue({ icloudEnabled: false })],
    ["senha já revogada", () => { row = { ...baseRow(), authFailedAt: new Date() }; }],
    ["sem calendário escolhido", () => { row = { ...baseRow(), calendarUrl: null }; }],
    ["desconectado", () => { row = null; }],
  ])("%s: nem chama a Apple", async (_name, arrange) => {
    arrange();
    expect(await checkIcloudCalendar("t1")).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("banco fora do ar: não lança", async () => {
    db.icloudCalendarIntegration.findUnique.mockRejectedValue(new Error("db"));
    await expect(checkIcloudCalendar("t1")).resolves.toBe("skipped");
  });
});

describe("varredura de saúde", () => {
  it("só contas habilitadas, sem senha revogada, não checadas nos últimos 30 minutos; no máximo 20", async () => {
    await scanIcloudHealth(NOW);
    expect(db.icloudCalendarIntegration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        authFailedAt: null,
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: new Date(NOW.getTime() - HEALTH_EVERY_MS) } }],
        tenant: { status: "active", calendarFeatures: { icloudEnabled: true } },
      },
      take: 20,
    }));
    expect(HEALTH_EVERY_MS).toBe(30 * 60_000);
  });

  it("marca a hora da checagem antes de chamar a Apple e conta cada resultado", async () => {
    db.icloudCalendarIntegration.findMany.mockResolvedValue([{ tenantId: "t1" }]);
    fetchMock.mockReturnValueOnce(reply(207, xml.ctagOf("c")));
    const result = await scanIcloudHealth(NOW);
    expect(result).toMatchObject({ checked: 1, ok: 1, revoked: 0 });
    expect(db.icloudCalendarIntegration.update.mock.calls[0][0]).toEqual({ where: { tenantId: "t1" }, data: { lastCheckedAt: NOW } });
  });

  it("conta cada tipo de problema", async () => {
    db.icloudCalendarIntegration.findMany.mockResolvedValue([{ tenantId: "t1" }, { tenantId: "t1" }, { tenantId: "t1" }]);
    fetchMock.mockReturnValueOnce(reply(401)).mockReturnValueOnce(reply(404)).mockReturnValueOnce(reply(500));
    // Depois do primeiro 401 a linha passa a ter authFailedAt: a segunda checagem seria pulada; mantém a linha limpa.
    db.icloudCalendarIntegration.update.mockImplementation(async () => ({}));
    const result = await scanIcloudHealth(NOW);
    expect(result).toMatchObject({ checked: 3, revoked: 1, calendarMissing: 1, unreachable: 1 });
  });

  it("nunca lança", async () => {
    db.icloudCalendarIntegration.findMany.mockRejectedValue(new Error("db"));
    await expect(scanIcloudHealth(NOW)).resolves.toMatchObject({ checked: 0 });
  });
});
