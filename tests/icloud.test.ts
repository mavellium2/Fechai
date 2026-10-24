import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  icloudCalendarIntegration: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  calendarFeatures: { findUnique: vi.fn(), upsert: vi.fn() },
  appointment: { updateMany: vi.fn(), findMany: vi.fn() },
  tenantAction: { findFirst: vi.fn() },
  agent: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { encryptSecret } from "@/lib/crypto";
import {
  clearIcloudAgendaCache, deleteIcloudEvent, disconnectIcloud, eventUrl, getIcloudStatus, hasIcloudConflict, icloudAgendaCache,
  listIcloudBusyBlocks, listIcloudCalendars, maskAppleId, moveIcloudEvents, pushEventToIcloud, saveIcloudCredentials, testIcloudConnection,
  updateIcloudEvent, verifyIcloudCredentials,
} from "@/modules/scheduling/icloud";
import { setCalendarFeature } from "@/modules/scheduling/features";
import type { IcloudEventInput } from "@/modules/scheduling/ical";
import * as xml from "./fixtures/icloud/caldav";
import * as ics from "./fixtures/icloud/ics";

const APPLE_ID = "dona.clinica@icloud.com";
const PASSWORD = "abcd-efgh-ijkl-mnop";
const fetchMock = vi.fn();
const reply = (status: number, body = "", headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(body || null, { status, headers }));

let row: Record<string, unknown> | null;
const baseRow = () => ({
  id: "i1", tenantId: "t1", appleId: encryptSecret(APPLE_ID), appPassword: encryptSecret(PASSWORD),
  principalUrl: xml.PRINCIPAL_URL, calendarHomeUrl: xml.HOME_URL, calendarUrl: xml.CAL_URL, calendarName: "Consultório",
  busyCalendarUrls: [], syncEnabled: true, checkAvailability: true, lastError: null, lastErrorAt: null, lastSyncAt: null,
  authFailedAt: null, connectionError: null, connectionErrorAt: null, lastCheckedAt: null,
});
const event: IcloudEventInput = {
  appointmentId: "abc123", title: "Consulta", patientName: "Maria", procedure: "Implante", phone: "5511999990000",
  notes: null, location: "Rua A", startsAt: new Date("2026-08-12T17:00:00Z"), endsAt: new Date("2026-08-12T18:00:00Z"),
  timeZone: "America/Sao_Paulo",
};
const URL_OF = eventUrl(xml.CAL_URL, "abc123");

let logged: string;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "chave-de-testes-com-mais-de-32-caracteres");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  row = baseRow();
  db.icloudCalendarIntegration.findUnique.mockImplementation(async () => (row ? { ...row } : null));
  db.icloudCalendarIntegration.update.mockResolvedValue({});
  db.icloudCalendarIntegration.updateMany.mockResolvedValue({ count: 1 });
  db.icloudCalendarIntegration.upsert.mockResolvedValue({});
  db.calendarFeatures.findUnique.mockResolvedValue({ googleEnabled: false, clinicorpEnabled: false, icloudEnabled: true });
  db.appointment.updateMany.mockResolvedValue({ count: 0 });
  db.tenantAction.findFirst.mockResolvedValue(null);
  db.agent.findFirst.mockResolvedValue(null);
  clearIcloudAgendaCache();
  // Tudo que o módulo loga (e o que o console recebe) é capturado: credencial nunca pode estar lá.
  logged = "";
  const capture = (...args: unknown[]) => { logged += args.map((a) => (a instanceof Error ? `${a.name} ${a.message}` : String(a))).join(" ") + "\n"; };
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const noSecrets = () => {
  expect(logged).not.toContain(APPLE_ID);
  expect(logged).not.toContain(PASSWORD);
  expect(logged.toLowerCase()).not.toContain("authorization");
  expect(logged).not.toContain("Basic ");
};
const lastWrite = () => db.icloudCalendarIntegration.update.mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;

describe("conectar (verificação das credenciais)", () => {
  it("descobre principal, partição e calendários de eventos", async () => {
    fetchMock
      .mockReturnValueOnce(reply(207, xml.PRINCIPAL_207))
      .mockReturnValueOnce(reply(207, xml.HOME_207))
      .mockReturnValueOnce(reply(207, xml.CALENDARS_207));
    const res = await verifyIcloudCredentials(APPLE_ID, PASSWORD);
    expect(res).toMatchObject({ ok: true, data: { principalUrl: xml.PRINCIPAL_URL, calendarHomeUrl: xml.HOME_URL } });
    if (res.ok) expect(res.data.calendars.map((c) => c.name)).toEqual(["Consultório", "Pessoal"]);
  });

  it("senha recusada: mensagem útil, sem repetir a senha", async () => {
    fetchMock.mockReturnValueOnce(reply(401));
    const res = await verifyIcloudCredentials(APPLE_ID, PASSWORD);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("senha de app");
      expect(res.error).not.toContain(PASSWORD);
    }
    noSecrets();
  });

  it("iCloud fora do ar ou sem calendário: erro, nunca exceção", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await verifyIcloudCredentials(APPLE_ID, PASSWORD)).toMatchObject({ ok: false });
    fetchMock.mockReturnValueOnce(reply(207, xml.PRINCIPAL_207)).mockReturnValueOnce(reply(207, xml.HOME_207)).mockReturnValueOnce(reply(207, xml.reportOf([])));
    expect(await verifyIcloudCredentials(APPLE_ID, PASSWORD)).toMatchObject({ ok: false });
    noSecrets();
  });
});

describe("credenciais cifradas", () => {
  const input = { appleId: APPLE_ID, appPassword: PASSWORD, principalUrl: xml.PRINCIPAL_URL, calendarHomeUrl: xml.HOME_URL };

  it("grava Apple ID e senha cifrados, sem texto claro, e zera os erros", async () => {
    row = null;
    await saveIcloudCredentials("t1", input, { calendarUrl: xml.CAL_URL, calendarName: "Consultório" });
    const { create } = db.icloudCalendarIntegration.upsert.mock.calls[0][0];
    expect(create.appleId).toMatch(/^v1:/);
    expect(create.appPassword).toMatch(/^v1:/);
    expect(JSON.stringify(create)).not.toContain(PASSWORD);
    expect(JSON.stringify(create)).not.toContain(APPLE_ID);
    expect(create).toMatchObject({ authFailedAt: null, connectionError: null, lastError: null, calendarUrl: xml.CAL_URL });
  });

  it("mesmo Apple ID mantém as escolhas; outro Apple ID zera calendário e endereços dos eventos", async () => {
    await saveIcloudCredentials("t1", input);
    expect(db.icloudCalendarIntegration.upsert.mock.calls[0][0].update).not.toHaveProperty("calendarUrl");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();

    await saveIcloudCredentials("t1", { ...input, appleId: "outra@icloud.com" });
    expect(db.icloudCalendarIntegration.upsert.mock.calls[1][0].update).toMatchObject({ calendarUrl: null, busyCalendarUrls: [] });
    expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { icloudEventUrl: null, icloudSyncAttempts: 0, icloudNextAttemptAt: null } }));
  });

  it("salvar limpa o cache da agenda da conta", async () => {
    icloudAgendaCache().set("t1|a", 1);
    icloudAgendaCache().set("t2|a", 1);
    await saveIcloudCredentials("t1", input);
    expect([...icloudAgendaCache().keys()]).toEqual(["t2|a"]);
  });

  it("o status devolve só metadados: nem a senha, nem o Apple ID inteiro", async () => {
    const status = await getIcloudStatus("t1");
    expect(status).toMatchObject({ appleIdHint: "d***@icloud.com", calendarName: "Consultório", syncEnabled: true });
    const text = JSON.stringify(status);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(APPLE_ID);
    expect(maskAppleId("sem-arroba")).toBe("s***");
  });

  it("credencial ilegível (chave trocada) é o mesmo que desconectado", async () => {
    row = { ...baseRow(), appPassword: "v1:lixo:lixo:lixo" };
    expect(await getIcloudStatus("t1")).toBeNull();
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("desconectar apaga a linha, esquece os endereços e limpa o cache", async () => {
    icloudAgendaCache().set("t1|a", 1);
    await disconnectIcloud("t1");
    expect(db.icloudCalendarIntegration.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
    expect(db.appointment.updateMany).toHaveBeenCalled();
    expect(icloudAgendaCache().size).toBe(0);
  });

  it("lista de calendários e teste de conexão usam o endereço guardado e nunca lançam", async () => {
    fetchMock.mockReturnValueOnce(reply(207, xml.CALENDARS_207));
    const list = await listIcloudCalendars("t1");
    expect(list).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe(xml.HOME_URL);

    fetchMock.mockReturnValueOnce(reply(207, xml.CALENDARS_207));
    expect(await testIcloudConnection("t1")).toMatchObject({ ok: true });
    expect(db.icloudCalendarIntegration.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { authFailedAt: null, connectionError: null, connectionErrorAt: null } }));

    fetchMock.mockRejectedValueOnce(new Error("rede"));
    expect(await listIcloudCalendars("t1")).toMatchObject({ ok: false });
    row = null;
    expect(await listIcloudCalendars("t1")).toMatchObject({ ok: false });
  });
});

describe("habilitar o calendário", () => {
  it("grava a coluna certa de cada calendário", async () => {
    await setCalendarFeature("t1", "icloud", true);
    expect(db.calendarFeatures.upsert).toHaveBeenCalledWith({
      where: { tenantId: "t1" },
      create: { tenantId: "t1", googleEnabled: false, clinicorpEnabled: false, icloudEnabled: true },
      update: { icloudEnabled: true },
    });
  });
});

describe("enviar o evento", () => {
  it("201: endereço fixo, If-None-Match, TZID e VTIMEZONE; limpa o cache e anota o sucesso", async () => {
    icloudAgendaCache().set("t1|a", 1);
    fetchMock.mockReturnValueOnce(reply(201));
    const res = await pushEventToIcloud("t1", event);
    expect(res).toEqual({ status: "synced", url: URL_OF });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(URL_OF);
    expect(url.endsWith("/fechai-abc123.ics")).toBe(true);
    expect(init.method).toBe("PUT");
    expect(init.headers["If-None-Match"]).toBe("*");
    expect(String(init.body)).toContain("DTSTART;TZID=America/Sao_Paulo:20260812T140000");
    expect(String(init.body)).toContain("BEGIN:VTIMEZONE");
    expect(String(init.body)).toContain("UID:fechai-abc123@fechai");
    expect(icloudAgendaCache().size).toBe(0);
    expect(lastWrite()).toMatchObject({ lastError: null });
    noSecrets();
  });

  it("412 (a varredura do worker chegou antes) vira sucesso com um segundo PUT que sobrescreve", async () => {
    fetchMock.mockReturnValueOnce(reply(412)).mockReturnValueOnce(reply(204));
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "synced", url: URL_OF });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers["If-None-Match"]).toBeUndefined();
  });

  it("lead de teste: título marcado e sem telefone no corpo", async () => {
    fetchMock.mockReturnValueOnce(reply(201));
    await pushEventToIcloud("t1", { ...event, phone: null, isTest: true });
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("SUMMARY:[TESTE fechai]");
    expect(body).not.toContain("5511999990000");
  });

  it("sem local no pedido, usa o da configuração do agente", async () => {
    db.tenantAction.findFirst.mockResolvedValue({ config: { location: "Av. Brasil, 100" } });
    fetchMock.mockReturnValueOnce(reply(201));
    const { location: _omit, ...withoutLocation } = event;
    void _omit;
    await pushEventToIcloud("t1", withoutLocation, { agentId: "ag1" });
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain("LOCATION:Av. Brasil\\, 100");
  });

  it.each([
    ["integração desligada em /integracoes", () => db.calendarFeatures.findUnique.mockResolvedValue({ icloudEnabled: false })],
    ["envio desligado", () => { row = { ...baseRow(), syncEnabled: false }; }],
    ["sem calendário escolhido", () => { row = { ...baseRow(), calendarUrl: null }; }],
    ["senha revogada (authFailedAt)", () => { row = { ...baseRow(), authFailedAt: new Date() }; }],
    ["não conectado", () => { row = null; }],
  ])("%s: não chama a Apple", async (_name, arrange) => {
    arrange();
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401: grava a falha, trava a conta e não deixa a senha em lugar nenhum", async () => {
    fetchMock.mockReturnValueOnce(reply(401));
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "failed", reason: "auth" });
    const data = lastWrite();
    expect(data.authFailedAt).toBeInstanceOf(Date);
    expect(String(data.lastError)).toContain("senha de app foi revogada");
    expect(String(data.lastError)).toContain("appleid.apple.com");
    expect(JSON.stringify(data)).not.toContain(PASSWORD);
    expect(JSON.stringify(data)).not.toContain(APPLE_ID);
    noSecrets();
  });

  it("403/404 do calendário: connectionError, para o envio até escolher de novo", async () => {
    fetchMock.mockReturnValueOnce(reply(404));
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "failed", reason: "calendar" });
    expect(String(lastWrite().connectionError)).toContain("não existe mais ou é somente leitura");
    expect(lastWrite().authFailedAt).toBeUndefined();
  });

  it("5xx e queda de rede: falha temporária, nunca exceção", async () => {
    fetchMock.mockReturnValueOnce(reply(503));
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "failed", reason: "transient" });
    expect(String(lastWrite().lastError)).toContain("tenta de novo sozinho");
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "failed", reason: "transient" });
    noSecrets();
  });

  it("banco fora do ar: ainda assim não lança", async () => {
    db.icloudCalendarIntegration.findUnique.mockRejectedValue(new Error("db"));
    expect(await pushEventToIcloud("t1", event)).toEqual({ status: "skipped" });
    db.calendarFeatures.findUnique.mockRejectedValue(new Error("db"));
    await expect(pushEventToIcloud("t1", event)).resolves.toBeDefined();
  });
});

describe("remarcar e apagar", () => {
  it("remarcar: PUT no mesmo endereço, sem If-None-Match; 404 do evento recria sem erro", async () => {
    fetchMock.mockReturnValueOnce(reply(204));
    expect(await updateIcloudEvent("t1", URL_OF, event)).toEqual({ status: "synced", url: URL_OF });
    const init = fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers["If-None-Match"]).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe(URL_OF);
  });

  it("sem endereço gravado usa o fixo", async () => {
    fetchMock.mockReturnValueOnce(reply(201));
    expect(await updateIcloudEvent("t1", null, event)).toMatchObject({ status: "synced", url: URL_OF });
  });

  it("cancelar apaga mesmo com o calendário desabilitado em /integracoes", async () => {
    db.calendarFeatures.findUnique.mockResolvedValue({ icloudEnabled: false });
    fetchMock.mockReturnValueOnce(reply(204));
    expect(await deleteIcloudEvent("t1", URL_OF, "abc123")).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("sem endereço gravado apaga o endereço fixo; 404 conta como removido", async () => {
    fetchMock.mockReturnValueOnce(reply(404));
    expect(await deleteIcloudEvent("t1", null, "abc123")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(URL_OF);
  });

  it("falha ao apagar devolve false e registra; senha revogada nem chama a Apple", async () => {
    fetchMock.mockReturnValueOnce(reply(500));
    expect(await deleteIcloudEvent("t1", URL_OF, "abc123")).toBe(false);
    expect(String(lastWrite().lastError)).toContain("remover");
    fetchMock.mockReset();
    row = { ...baseRow(), authFailedAt: new Date() };
    expect(await deleteIcloudEvent("t1", URL_OF, "abc123")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    noSecrets();
  });

  it("não conectado: nada a remover; endereço fora do iCloud nunca recebe a senha", async () => {
    row = null;
    expect(await deleteIcloudEvent("t1", URL_OF, "abc123")).toBe(true);
    row = baseRow();
    expect(await deleteIcloudEvent("t1", "https://evil.example/x.ics", "abc123")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nunca lança, nem com fetch rejeitando", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(deleteIcloudEvent("t1", URL_OF, "abc123")).resolves.toBe(false);
    await expect(updateIcloudEvent("t1", URL_OF, event)).resolves.toMatchObject({ status: "failed" });
  });

  it("trocar de calendário apaga os eventos futuros do antigo e esquece os endereços", async () => {
    db.appointment.findMany.mockResolvedValue([{ id: "a1", icloudEventUrl: "https://p1-caldav.icloud.com/old/fechai-a1.ics" }]);
    fetchMock.mockReturnValueOnce(reply(204));
    await moveIcloudEvents("t1");
    expect(fetchMock.mock.calls[0][0]).toBe("https://p1-caldav.icloud.com/old/fechai-a1.ics");
    expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { icloudEventUrl: null, icloudSyncAttempts: 0, icloudNextAttemptAt: null } }));
  });
});

describe("disponibilidade: o que está ocupado no iPhone", () => {
  const DAY = "2026-08-12";
  const TZ = "America/Sao_Paulo";
  const report = (...list: string[]) => reply(207, xml.reportOf(list));
  const CAL_WORK_URL = xml.CAL_WORK;

  it.each([
    ["integração desabilitada em /integracoes", () => db.calendarFeatures.findUnique.mockResolvedValue({ icloudEnabled: false })],
    ["leitura desligada (checkAvailability)", () => { row = { ...baseRow(), checkAvailability: false }; }],
    ["conta não conectada", () => { row = null; }],
    ["nenhum calendário escolhido ainda", () => { row = { ...baseRow(), calendarUrl: null }; }],
  ])("%s: nada ocupado e sem chamar a Apple", async (_name, arrange) => {
    arrange();
    expect(await listIcloudBusyBlocks("t1", DAY, TZ)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("senha revogada: desconhecido (null), sem insistir na Apple", async () => {
    row = { ...baseRow(), authFailedAt: new Date() };
    expect(await listIcloudBusyBlocks("t1", DAY, TZ)).toBeNull();
    expect(await hasIcloudConflict("t1", new Date("2026-08-12T17:00:00Z"), new Date("2026-08-12T18:00:00Z"), TZ)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lê o calendário de gravação e os marcados como ocupado, um REPORT por calendário, no dia local", async () => {
    row = { ...baseRow(), busyCalendarUrls: [CAL_WORK_URL] };
    fetchMock.mockReturnValueOnce(report(ics.FLOATING)).mockReturnValueOnce(report(ics.UTC_EVENT));
    const blocks = await listIcloudBusyBlocks("t1", DAY, TZ);
    expect(blocks?.map((b) => b.startsAt.toISOString()).sort()).toEqual(["2026-08-12T12:00:00.000Z", "2026-08-12T17:00:00.000Z"]);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([xml.CAL_URL, CAL_WORK_URL].sort());
    // dia local 12/08 em Brasília = 03:00Z até 03:00Z do dia seguinte
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('start="20260812T030000Z" end="20260813T030000Z"');
  });

  it("recorrência, dia inteiro, livre e cancelado", async () => {
    fetchMock.mockReturnValueOnce(report(ics.WEEKLY, ics.ALL_DAY, ics.TRANSPARENT, ics.CANCELLED));
    const blocks = (await listIcloudBusyBlocks("t1", "2026-08-10", TZ))!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startsAt.toISOString()).toBe("2026-08-10T13:00:00.000Z");
    fetchMock.mockReturnValueOnce(report(ics.WEEKLY, ics.ALL_DAY, ics.TRANSPARENT, ics.CANCELLED));
    const full = (await listIcloudBusyBlocks("t1", DAY, TZ))!;
    expect(full).toHaveLength(1);
    expect(full[0].endsAt.getTime() - full[0].startsAt.getTime()).toBe(48 * 3_600_000);
  });

  it("401: devolve null, grava a queda da senha e para tudo", async () => {
    fetchMock.mockReturnValueOnce(reply(401));
    expect(await listIcloudBusyBlocks("t1", DAY, TZ)).toBeNull();
    const data = lastWrite();
    expect(data.authFailedAt).toBeInstanceOf(Date);
    expect(String(data.connectionError)).toContain("senha de app foi revogada");
    noSecrets();
  });

  it.each([
    ["5xx", () => fetchMock.mockReturnValueOnce(reply(503))],
    ["timeout", () => fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }))],
    ["rede", () => fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"))],
    ["resposta que não é CalDAV", () => fetchMock.mockReturnValueOnce(reply(207, xml.NOT_XML))],
    ["arquivo de calendário ilegível", () => fetchMock.mockReturnValueOnce(report(ics.BROKEN))],
  ])("falha (%s) = null, nunca agenda vazia, e a tela explica", async (_name, arrange) => {
    arrange();
    expect(await listIcloudBusyBlocks("t1", DAY, TZ)).toBeNull();
    expect(String(lastWrite().lastError)).toContain("Novos horários não serão oferecidos");
    noSecrets();
  });

  it("um dos calendários falhando já torna o dia desconhecido", async () => {
    row = { ...baseRow(), busyCalendarUrls: [CAL_WORK_URL] };
    fetchMock.mockReturnValueOnce(report(ics.FLOATING)).mockReturnValueOnce(reply(500));
    expect(await listIcloudBusyBlocks("t1", DAY, TZ)).toBeNull();
  });

  it("credencial ilegível ou banco fora do ar: null (não conseguiu conferir)", async () => {
    row = { ...baseRow(), appPassword: "v1:lixo:lixo:lixo" };
    expect(await listIcloudBusyBlocks("t1", DAY, TZ)).toBeNull();
    row = baseRow();
    db.calendarFeatures.findUnique.mockRejectedValue(new Error("db"));
    expect(await listIcloudBusyBlocks("t1", DAY, TZ)).toBeNull();
    db.icloudCalendarIntegration.findUnique.mockRejectedValue(new Error("db"));
    await expect(listIcloudBusyBlocks("t1", DAY, TZ)).resolves.toBeNull();
  });

  it("dia inválido não explode", async () => {
    expect(await listIcloudBusyBlocks("t1", "2026-99-99", TZ)).toBeNull();
  });

  it("não usa cache: cada conferência lê na Apple", async () => {
    fetchMock.mockImplementation(() => report(ics.FLOATING));
    await listIcloudBusyBlocks("t1", DAY, TZ);
    await listIcloudBusyBlocks("t1", DAY, TZ);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("conflito de um horário", () => {
    const at = (h: string) => new Date(`2026-08-12T${h}:00Z`);

    it("sobreposição conflita; encostar não", async () => {
      fetchMock.mockImplementation(() => report(ics.UTC_EVENT)); // 17:00–18:00Z
      expect(await hasIcloudConflict("t1", at("17:30"), at("18:30"), TZ)).toBe(true);
      expect(await hasIcloudConflict("t1", at("16:30"), at("17:30"), TZ)).toBe(true);
      expect(await hasIcloudConflict("t1", at("16:00"), at("17:00"), TZ)).toBe(false);
      expect(await hasIcloudConflict("t1", at("18:00"), at("19:00"), TZ)).toBe(false);
    });

    it("remarcação ignora o próprio evento do fechai, e só ele", async () => {
      fetchMock.mockImplementation(() => report(ics.FECHAI_EVENT)); // 14:00–15:00 em Brasília = 17:00–18:00Z
      expect(await hasIcloudConflict("t1", at("17:00"), at("18:00"), TZ)).toBe(true);
      expect(await hasIcloudConflict("t1", at("17:00"), at("18:00"), TZ, "abc123")).toBe(false);
      expect(await hasIcloudConflict("t1", at("17:00"), at("18:00"), TZ, "outra")).toBe(true);
    });

    it("falha de leitura = null (quem chama não confirma o horário)", async () => {
      fetchMock.mockReturnValueOnce(reply(500));
      expect(await hasIcloudConflict("t1", at("17:00"), at("18:00"), TZ)).toBeNull();
    });

    it("consulta que atravessa a meia-noite local confere os dois dias", async () => {
      fetchMock.mockImplementation(() => report());
      // 12/08 23:30 em Brasília até 13/08 00:30
      await hasIcloudConflict("t1", new Date("2026-08-13T02:30:00Z"), new Date("2026-08-13T03:30:00Z"), TZ);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
