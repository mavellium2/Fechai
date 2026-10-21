import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), owned: vi.fn(), saved: vi.fn(), audit: vi.fn(), categories: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "conta-logada", session: { user: { id: "usuario-logado" } } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantAction: { findUnique: mocks.saved },
    // QR liberado pelo admin: ativar as confirmações pelo QR exige o canal.
    tenant: { findUnique: vi.fn(async () => ({ evolutionWhatsappEnabled: true })) },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/modules/agent-engine/agents", () => ({ getAgentOwned: mocks.owned }));
vi.mock("@/modules/scheduling/repository", () => ({ saveScheduleConfig: mocks.save }));
vi.mock("@/modules/whatsapp", () => ({}));
vi.mock("@/lib/widget/deploy", () => ({}));
vi.mock("@/lib/bunny", () => ({}));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ listClinicorpCategories: mocks.categories }));
import { saveScheduleConfigAction } from "@/app/(dashboard)/agentes/actions";
import { QR_RISK_TERMS_VERSION, QR_RISK_TERMS_TEXT, createQrRiskAcceptance } from "@/modules/scheduling/qr-risk-terms";
import { emptyWeek } from "@/modules/scheduling/weekly-availability";

function form(week: unknown = emptyWeek()) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ agentId: "agente", tenantId: "conta-forjada", weeklyAvailability: JSON.stringify(week), startTime: "09:00", endTime: "18:00", durationMinutes: "30", timezone: "America/Sao_Paulo", minNoticeHours: "2", allowCancellation: "true", allowRescheduling: "true", recognizeExisting: "true", reminderEnabled: "false", breaks: "[]", durations: "[]", reminders: "[]" })) data.set(key, value);
  return data;
}
beforeEach(() => { vi.clearAllMocks(); mocks.owned.mockResolvedValue({ id: "agente" }); mocks.saved.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined); mocks.categories.mockResolvedValue({ ok: true, data: [{ id: "123", name: "Avaliação" }] }); });

describe("salvamento da grade semanal", () => {
  it("salva a grade normalizada somente na conta autenticada, sem precisar dos checkboxes antigos", async () => {
    const week = emptyWeek();
    week[0] = [{ start: 1380, end: 1440 }];
    week[2] = [{ start: 540, end: 720 }, { start: 720, end: 780 }];
    expect(await saveScheduleConfigAction(null, form(week))).toMatchObject({ ok: true });
    expect(mocks.owned).toHaveBeenCalledWith("conta-logada", "agente");
    expect(mocks.save).toHaveBeenCalledWith("conta-logada", "agente", expect.objectContaining({ workdays: [0, 2], weeklyAvailability: [week[0], [], [{ start: 540, end: 780 }], [], [], [], []], breaks: [] }));
  });
  it("permite salvar semana totalmente fechada", async () => {
    expect(await saveScheduleConfigAction(null, form())).toMatchObject({ ok: true });
    expect(mocks.save).toHaveBeenCalledWith("conta-logada", "agente", expect.objectContaining({ weeklyAvailability: emptyWeek(), workdays: [] }));
  });
  it("recusa JSON inválido e períodos fora do dia sem gravar", async () => {
    for (const raw of ["{", JSON.stringify([[{ start: 0, end: 1500 }], ...emptyWeek().slice(1)])]) {
      const data = form(); data.set("weeklyAvailability", raw);
      expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false });
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("continua aceitando formulários antigos e recusa agente de outra conta", async () => {
    const data = form(); data.delete("weeklyAvailability"); data.append("workdays", "1");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: true });
    expect(mocks.save.mock.calls[0][2]).not.toHaveProperty("weeklyAvailability");
    mocks.save.mockClear(); mocks.owned.mockResolvedValue(null);
    expect(await saveScheduleConfigAction(null, form())).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("salvamento do público dos lembretes", () => {
  function restricted(enabled = "true") {
    const data = form();
    data.set("reminderEnabled", enabled);
    data.set("reminders", JSON.stringify([{ minutesBefore: 1440, template: "É amanhã." }]));
    data.set("reminderAudience", "selected_types");
    data.set("reminderTypes", JSON.stringify(["Avaliação"]));
    return data;
  }
  it("salva a seleção somente na conta autenticada", async () => {
    expect(await saveScheduleConfigAction(null, restricted())).toMatchObject({ ok: true });
    expect(mocks.save).toHaveBeenCalledWith("conta-logada", "agente", expect.objectContaining({ reminderAudience: "selected_types", reminderTypes: ["Avaliação"] }));
  });
  it("salva vários tipos sem depender das variações de duração", async () => {
    const data = restricted();
    data.set("reminderTypes", JSON.stringify(["Avaliação", "Ortodontia", "Retorno"]));
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: true });
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ reminderTypes: ["Avaliação", "Ortodontia", "Retorno"], durations: [] });
  });
  it("formulário antigo preserva a restrição que já existe", async () => {
    mocks.saved.mockResolvedValue({ config: { reminderAudience: "selected_types", reminderTypes: ["Avaliação"] } });
    expect(await saveScheduleConfigAction(null, form())).toMatchObject({ ok: true });
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ reminderAudience: "selected_types", reminderTypes: ["Avaliação"] });
  });
  it("recusa público restrito vazio quando ligado, mas permite pausar", async () => {
    const data = restricted();
    data.set("reminderTypes", "[]");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false, error: expect.stringContaining("pelo menos um tipo") });
    expect(mocks.save).not.toHaveBeenCalled();
    data.set("reminderEnabled", "false");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: true });
  });
  it.each(["{", "null", '"Avaliação"'])("recusa lista malformada em vez de liberar todos: %s", async (raw) => {
    const data = restricted(); data.set("reminderTypes", raw);
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});


describe("aceite obrigatório dos riscos da Evolution", () => {
  function activating() {
    const data = form();
    for (const [key, value] of Object.entries({ clinicorpQrEnabled: "true", clinicorpQrConsent: "true", clinicorpQrRiskAccepted: "true",
      clinicorpQrRiskVersion: QR_RISK_TERMS_VERSION, clinicorpQrResponsibleName: "  Márcio  Silva  ", reminderEnabled: "true",
      reminderAudience: "selected_types", reminderTypes: JSON.stringify(["Avaliação"]), reminders: JSON.stringify([{ minutesBefore: 1440, template: "É amanhã." }]) })) data.set(key, value);
    return data;
  }
  it.each(["clinicorpQrRiskAccepted", "clinicorpQrResponsibleName", "clinicorpQrRiskVersion"])("POST sem %s não ativa nem grava aceite", async (field) => {
    const data = activating(); data.delete(field);
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.categories).not.toHaveBeenCalled();
  });
  it.each(["", "  ", "12", "1234", "a".repeat(121), "Ana\nSilva"])("recusa responsável inválido %j", async (name) => {
    const data = activating(); data.set("clinicorpQrResponsibleName", name);
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false }); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("versão antiga e checkbox falso não equivalem a aceite", async () => {
    const data = activating(); data.set("clinicorpQrRiskVersion", "old");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false });
    data.set("clinicorpQrRiskVersion", QR_RISK_TERMS_VERSION); data.set("clinicorpQrRiskAccepted", "false");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false }); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("grava nome, texto/versão e ator/data do servidor junto da ativação", async () => {
    const data = activating(); data.set("acceptedByUserId", "ator-forjado"); data.set("acceptedAt", "1990-01-01T00:00:00Z");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: true });
    const saved = mocks.save.mock.calls[0][2];
    expect(saved).toMatchObject({ clinicorpQrEnabled: true, clinicorpReminderCategoryIds: ["123"], clinicorpQrRiskAcceptance: {
      responsibleName: "Márcio Silva", acceptedByUserId: "usuario-logado", version: QR_RISK_TERMS_VERSION, termsText: QR_RISK_TERMS_TEXT } });
    expect(Date.parse(saved.clinicorpQrRiskAcceptance.acceptedAt)).toBeGreaterThan(Date.now() - 5000);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ event: "scheduling.qr_risk_accepted", tenantId: "conta-logada" }));
  });
  it("recusa agente de outra conta mesmo com todos os campos de aceite", async () => {
    mocks.owned.mockResolvedValue(null); expect(await saveScheduleConfigAction(null, activating())).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("formulário aberto antes da mudança não ativa QR sem os novos termos", async () => {
    mocks.saved.mockResolvedValue({ config: { clinicorpQrEnabled: true, clinicorpQrConsentAt: new Date().toISOString() } });
    const data = activating(); data.delete("clinicorpQrRiskAccepted");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false }); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("salvamento normal mantém um aceite válido sem inventar outra assinatura", async () => {
    const acceptance = createQrRiskAcceptance("Ana Costa", "user-anterior");
    mocks.saved.mockResolvedValue({ config: { clinicorpQrEnabled: true, clinicorpQrRiskAcceptance: acceptance } });
    const data = activating(); data.delete("clinicorpQrRiskAccepted"); data.delete("clinicorpQrRiskVersion"); data.delete("clinicorpQrResponsibleName");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: true });
    expect(mocks.save.mock.calls[0][2].clinicorpQrRiskAcceptance).toEqual(acceptance); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("desativar preserva o aceite, mas reativar exige um novo", async () => {
    const acceptance = createQrRiskAcceptance("Ana Costa", "user-anterior");
    mocks.saved.mockResolvedValue({ config: { clinicorpQrEnabled: false, clinicorpQrRiskAcceptance: acceptance } });
    const data = activating(); data.delete("clinicorpQrRiskAccepted"); expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false });
    data.set("clinicorpQrEnabled", "false"); expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: true });
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ clinicorpQrEnabled: false, clinicorpQrRiskAcceptance: acceptance }); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
