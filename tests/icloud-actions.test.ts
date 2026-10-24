import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  features: vi.fn(), verify: vi.fn(), save: vi.fn(), list: vi.fn(), move: vi.fn(), clear: vi.fn(), disconnect: vi.fn(), test: vi.fn(),
  update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), audit: vi.fn(), change: vi.fn(), encryption: vi.fn(),
  setFeature: vi.fn(), calendarFeatures: { findUnique: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "tenant-logado" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  icloudCalendarIntegration: { update: mocks.update, updateMany: mocks.updateMany, findUnique: mocks.findUnique },
  calendarFeatures: mocks.calendarFeatures,
} }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: vi.fn(), isEncryptionConfigured: mocks.encryption }));
vi.mock("@/modules/whatsapp", () => ({}));
vi.mock("@/lib/widget/deploy", () => ({}));
vi.mock("@/lib/bunny", () => ({}));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit, recordChange: mocks.change }));
vi.mock("@/modules/scheduling/google", () => ({}));
vi.mock("@/modules/scheduling/clinicorp", () => ({}));
vi.mock("@/modules/scheduling/features", () => ({
  getCalendarFeatures: mocks.features, setCalendarFeature: mocks.setFeature,
  CALENDAR_FEATURE_FIELDS: { google: "googleEnabled", clinicorp: "clinicorpEnabled", icloud: "icloudEnabled" },
}));
vi.mock("@/modules/scheduling/icloud", () => ({
  verifyIcloudCredentials: mocks.verify, saveIcloudCredentials: mocks.save, listIcloudCalendars: mocks.list,
  moveIcloudEvents: mocks.move, clearIcloudAgendaCache: mocks.clear, disconnectIcloud: mocks.disconnect,
  testIcloudConnection: mocks.test,
}));

import {
  connectIcloudAction, disconnectIcloudAction, saveIcloudSettingsAction, setCalendarFeatureAction, setIcloudToggle,
  testIcloudConnectionAction,
} from "@/app/(dashboard)/integracoes/actions";

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}
const CAL_A = "https://p1-caldav.icloud.com/1/calendars/a/";
const CAL_B = "https://p1-caldav.icloud.com/1/calendars/b/";
const CAL_C = "https://p1-caldav.icloud.com/1/calendars/c/";
const calendars = [{ url: CAL_A, name: "Consultório", color: null }, { url: CAL_B, name: "Pessoal", color: null }, { url: CAL_C, name: "Casa", color: null }];
const connect = { appleId: "Dona@iCloud.com ", appPassword: " abcd efgh ijkl mnop " };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encryption.mockReturnValue(true);
  mocks.features.mockResolvedValue({ icloudEnabled: true });
  mocks.verify.mockResolvedValue({ ok: true, data: { principalUrl: "https://caldav.icloud.com/1/principal/", calendarHomeUrl: "https://p1-caldav.icloud.com/1/calendars/", calendars } });
  mocks.list.mockResolvedValue({ ok: true, data: calendars });
  mocks.findUnique.mockResolvedValue({ calendarUrl: CAL_A });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.calendarFeatures.findUnique.mockResolvedValue({ id: "f1", googleEnabled: false, clinicorpEnabled: false, icloudEnabled: false });
});

describe("conectar", () => {
  it("normaliza Apple ID e senha, só grava depois do iCloud aceitar, e audita sem credencial", async () => {
    const res = await connectIcloudAction(null, form(connect));
    expect(res).toMatchObject({ ok: true });
    expect(mocks.verify).toHaveBeenCalledWith("dona@icloud.com", "abcdefghijklmnop");
    expect(mocks.save).toHaveBeenCalledWith("tenant-logado", expect.objectContaining({ appleId: "dona@icloud.com", appPassword: "abcdefghijklmnop" }), { calendarUrl: null, calendarName: null });
    const audit = JSON.stringify(mocks.audit.mock.calls);
    expect(audit).not.toContain("abcdefghijklmnop");
    expect(audit).not.toContain("dona@icloud.com");
    expect(res.info).toContain("Escolha o calendário");
  });

  it("com um calendário só, ele já fica escolhido", async () => {
    mocks.verify.mockResolvedValue({ ok: true, data: { principalUrl: "p", calendarHomeUrl: "h", calendars: [calendars[0]] } });
    const res = await connectIcloudAction(null, form(connect));
    expect(res.info).toBe("Calendário da Apple conectado.");
    expect(mocks.save).toHaveBeenCalledWith("tenant-logado", expect.anything(), { calendarUrl: CAL_A, calendarName: "Consultório" });
  });

  it("senha recusada pelo iCloud: nada é gravado", async () => {
    mocks.verify.mockResolvedValue({ ok: false, error: "O Apple ID ou a senha de app foram recusados." });
    expect(await connectIcloudAction(null, form(connect))).toEqual({ ok: false, error: "O Apple ID ou a senha de app foram recusados." });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("recusa Apple ID inválido, senha vazia, calendário não habilitado e instalação sem chave", async () => {
    expect(await connectIcloudAction(null, form({ ...connect, appleId: "sem-arroba" }))).toMatchObject({ ok: false });
    expect(await connectIcloudAction(null, form({ ...connect, appPassword: "  " }))).toMatchObject({ ok: false });
    mocks.features.mockResolvedValue({ icloudEnabled: false });
    expect(await connectIcloudAction(null, form(connect))).toMatchObject({ ok: false, error: expect.stringContaining("Habilite") });
    mocks.features.mockResolvedValue({ icloudEnabled: true });
    mocks.encryption.mockReturnValue(false);
    expect(await connectIcloudAction(null, form(connect))).toMatchObject({ ok: false, error: expect.stringContaining("chave de criptografia") });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("salvar preferências", () => {
  it("grava só calendários que o iCloud acabou de listar para esta conta", async () => {
    const res = await saveIcloudSettingsAction(null, form({ calendarUrl: CAL_A, busyCalendarUrls: [CAL_B, "https://evil.example/c/", CAL_A, CAL_B] }));
    expect(res).toEqual({ ok: true, info: "Preferências salvas." });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { tenantId: "tenant-logado" },
      data: { calendarUrl: CAL_A, calendarName: "Consultório", busyCalendarUrls: [CAL_B], connectionError: null, connectionErrorAt: null },
    });
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledWith("tenant-logado");
  });

  it("recusa calendário fora da lista e não grava nada", async () => {
    const res = await saveIcloudSettingsAction(null, form({ calendarUrl: "https://p1-caldav.icloud.com/1/calendars/outro/" }));
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("não existe mais") });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("exige calendário escolhido (a opção vazia não vale)", async () => {
    expect(await saveIcloudSettingsAction(null, form({ calendarUrl: "" }))).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("trocar o calendário de gravação move os eventos futuros", async () => {
    await saveIcloudSettingsAction(null, form({ calendarUrl: CAL_C }));
    expect(mocks.move).toHaveBeenCalledWith("tenant-logado");
  });

  it("iCloud fora do ar ou conta desconectada: preserva o que estava salvo", async () => {
    mocks.list.mockResolvedValue({ ok: false, error: "Não foi possível falar com o iCloud agora." });
    expect(await saveIcloudSettingsAction(null, form({ calendarUrl: CAL_A }))).toMatchObject({ ok: false });
    mocks.findUnique.mockResolvedValue(null);
    expect(await saveIcloudSettingsAction(null, form({ calendarUrl: CAL_A }))).toMatchObject({ ok: false, error: expect.stringContaining("não está conectado") });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("chaves, teste e desconexão", () => {
  it("só a conta logada é alterada", async () => {
    expect(await setIcloudToggle("checkAvailability", false)).toEqual({ ok: true });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-logado" }, data: { checkAvailability: false } });
    expect(await setIcloudToggle("lastError" as "syncEnabled", true)).toMatchObject({ ok: false });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect(await setIcloudToggle("syncEnabled", true)).toMatchObject({ ok: false });
  });

  it("habilitar grava a coluna do iCloud e audita o antes e o depois", async () => {
    await setCalendarFeatureAction("icloud", true);
    expect(mocks.setFeature).toHaveBeenCalledWith("tenant-logado", "icloud", true);
    expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({
      before: { icloudEnabled: false }, after: { icloudEnabled: true }, meta: { calendario: "icloud" },
    }));
  });

  it("teste de conexão devolve a mensagem do iCloud e o erro quando falha", async () => {
    mocks.test.mockResolvedValue({ ok: true, data: "Conexão com o iCloud funcionando (2 calendários)." });
    expect(await testIcloudConnectionAction()).toEqual({ ok: true, info: "Conexão com o iCloud funcionando (2 calendários)." });
    mocks.test.mockResolvedValue({ ok: false, error: "fora" });
    expect(await testIcloudConnectionAction()).toEqual({ ok: false, error: "fora" });
  });

  it("desconectar apaga as credenciais e audita", async () => {
    expect(await disconnectIcloudAction()).toMatchObject({ ok: true });
    expect(mocks.disconnect).toHaveBeenCalledWith("tenant-logado");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ event: "integration.removed" }));
  });
});
