import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  clinicorpIntegration: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  calendarFeatures: { findUnique: vi.fn() },
  appointment: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  lead: { update: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: vi.fn(async () => null) }));
// Estes testes exercitam o contrato HTTP; a fila durável tem sua suíte própria.
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({
  syncAppointmentToClinicorp: async (tenantId: string, _id: string, input: unknown) => {
    const transport = await import("@/modules/scheduling/clinicorp");
    return transport.pushAppointmentToClinicorp(tenantId, input as import("@/modules/scheduling/clinicorp").ClinicorpEventInput);
  },
}));

import {
  cancelAppointmentInClinicorp, clearClinicorpAgendaCache, clinicorpConfirmationPending, getClinicorpStatus, hasClinicorpConflict, listClinicorpAgenda,
  listClinicorpCategories, listClinicorpProfessionals, listClinicorpBusyBlocks, pushAppointmentToClinicorp,
  saveClinicorpCredentials, testClinicorpConnection, verifyClinicorpCredentials,
} from "@/modules/scheduling/clinicorp";
import { createAppointment } from "@/modules/scheduling/repository";

const credentials = { apiUser: "usuario-api-teste", apiToken: "token-api-teste", subscriberId: "assinante-teste" };
const event = {
  title: "Teste", startsAt: new Date("2026-09-14T19:30:00Z"), endsAt: new Date("2026-09-14T19:45:00Z"),
  timeZone: "America/Sao_Paulo", lead: { name: "Paciente de teste", phone: "+55 (11) 99999-0000" },
};
const testLead = { name: "Chat de teste", phone: "sandbox:cmf9x2k7p0001", isTest: true };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let integration: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  clearClinicorpAgendaCache();
  vi.stubEnv("ENCRYPTION_KEY", "chave-de-testes-com-mais-de-32-caracteres");
  integration = {
    tenantId: "tenant-1", ...credentials,
    apiUser: encryptSecret(credentials.apiUser), apiToken: encryptSecret(credentials.apiToken),
    businessId: "4791226171916288", dentistId: "222222222222", categoryDescription: "Avaliação",
    syncEnabled: true, checkAvailability: true, lastError: "Erro anterior", lastSyncAt: null,
  };
  db.clinicorpIntegration.findUnique.mockImplementation(async () => integration);
  db.clinicorpIntegration.update.mockResolvedValue({});
  db.clinicorpIntegration.upsert.mockResolvedValue({});
  db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: true, googleEnabled: false });
  db.appointment.create.mockResolvedValue({ id: "appointment-local" });
  db.appointment.update.mockResolvedValue({});
  db.lead.update.mockResolvedValue({});
  db.lead.findUnique.mockResolvedValue(event.lead);
  fetchMock = vi.fn(async (url: URL) => {
    if (url.pathname.endsWith("/list_categories")) return json([{ id: 1234567890125, Description: "Avaliação" }]);
    if (url.pathname.endsWith("/patient/get")) return json({ PatientId: 333333333333, Status: "ACTIVE", Name: url.searchParams.get("Name") ?? "Paciente de teste" });
    if (url.pathname.endsWith("/business/list")) return json([{ id: 4791226171916288, Name: "Clínica teste" }]);
    return json([{ Status: "CREATED", id: 987654321 }]);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("envio de agendamentos ao Clinicorp", () => {
  const externalRow = { id: 987654321, date: "2026-09-14T00:00:00.000Z", AtomicDate: "2026-09-14", fromTime: "16:30", toTime: "16:45", Clinic_BusinessId: 4791226171916288, Dentist_PersonId: 222222222222, PatientName: "Paciente de teste", MobilePhone: "11999990000" };

  it("reconcilia criação aceita sem ID e reconhece a referência na próxima tentativa sem novo POST", async () => {
    const original = fetchMock.getMockImplementation()!;
    let posted = false;
    fetchMock.mockImplementation(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith("/appointment/list")) return json(posted ? [{ ...externalRow, Notes: "[fechai:envio-1]" }] : []);
      if (url.pathname.endsWith("/create_appointment_by_api")) {
        expect(JSON.parse(String(init.body)).Procedures).toContain("[fechai:envio-1]");
        posted = true; return new Response("", { status: 200 });
      }
      return original(url);
    });
    const tracked = { ...event, referenceId: "envio-1" };
    expect(await pushAppointmentToClinicorp("tenant-1", tracked)).toEqual({ status: "synced", appointmentId: "987654321" });
    expect(await pushAppointmentToClinicorp("tenant-1", tracked)).toEqual({ status: "synced", appointmentId: "987654321" });
    expect(fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/create_appointment_by_api"))).toHaveLength(1);
  });

  it("reconhece pessoa, telefone, profissional e horário exatos quando a agenda não devolve as notas", async () => {
    fetchMock.mockImplementation(async () => json([externalRow]));
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, referenceId: "envio-1" })).toEqual({ status: "synced", appointmentId: "987654321" });
    expect(fetchMock.mock.calls.every(([url]) => url.pathname.endsWith("/appointment/list"))).toBe(true);
  });

  it("não repete uma criação quando a releitura está indisponível ou ambígua", async () => {
    fetchMock.mockImplementation(async () => json({ message: "Offline" }, 503));
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, referenceId: "envio-1" })).toMatchObject({ status: "failed" });
    fetchMock.mockImplementation(async () => json([externalRow, { ...externalRow, id: 987654322 }]));
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, referenceId: "envio-1" })).toMatchObject({ status: "failed" });
    expect(fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/create_appointment_by_api"))).toBe(false);
  });

  it("conserva o assinante original da fila mesmo se a conexão for trocada", async () => {
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, referenceId: "envio-1", target: { subscriberId: "outro", businessId: String(integration.businessId), dentistId: null, categoryDescription: null } })).toMatchObject({ status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não trata credencial ilegível como integração opcional desligada", async () => {
    integration.apiToken = "ilegível";
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "failed" });
    expect(await clinicorpConfirmationPending("tenant-1")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não confirma o espelho quando habilitado sem conexão", async () => {
    db.clinicorpIntegration.findUnique.mockResolvedValue(null);
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "failed" });
    expect(await clinicorpConfirmationPending("tenant-1")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permite confirmação local quando o usuário desligou o espelho", async () => {
    integration.syncEnabled = false;
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toEqual({ status: "skipped" });
    expect(await clinicorpConfirmationPending("tenant-1")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia segunda dia 14 às 16:30 por 15 minutos, ao profissional e à categoria cadastrados", async () => {
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toEqual({ status: "synced", appointmentId: "987654321" });
    const [url, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))! as unknown as [URL, RequestInit];
    expect(url.searchParams.get("subscriber_id")).toBe(credentials.subscriberId);
    expect(init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from(`${credentials.apiUser}:${credentials.apiToken}`).toString("base64")}` });
    expect(JSON.parse(String(init.body))).toMatchObject({
      Clinic_BusinessId: 4791226171916288, Dentist_PersonId: 222222222222,
      Patient_PersonId: 333333333333, CategoryId: 1234567890125,
      date: "2026-09-14T00:00:00.000Z", fromTime: "16:30", toTime: "16:45", MobilePhone: "11999990000",
    });
    expect(db.clinicorpIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: null, lastSyncAt: expect.any(Date) }) }));
  });

  it("usa o nome da paciente mesmo quando outra pessoa conversa pelo WhatsApp", async () => {
    const result = await createAppointment({
      tenantId: "tenant-1", leadId: "lead-1", title: "Maria Souza", patientName: "Maria Souza",
      notes: "Primeira consulta", startsAt: event.startsAt, durationMinutes: 15,
      source: "agent", timezone: event.timeZone,
    });
    expect(result.clinicorpSync.status).toBe("synced");
    expect(db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "Maria Souza", patientName: "Maria Souza", notes: "Primeira consulta" }),
    }));
    expect(fetchMock.mock.calls.some(([url]) => url.pathname.includes("/patient/get"))).toBe(false);
    const [, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))! as unknown as [URL, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.PatientName).toBe("Maria Souza");
    expect(body.Patient_PersonId).toBeUndefined();
    expect(body.MobilePhone).toBe("11999990000");
    expect(body.Procedures).toBe("Primeira consulta");
    expect(body).not.toHaveProperty("Notes");
  });

  it.each([
    ["Ana", "Ana Carolina Almeida de Souza"],
    ["Lúcia", "Lúcia Helena Rodrigues"],
    [null, "Ana Carolina Almeida de Souza"],
  ])("preserva o telefone quando o nome do contato é %s e o paciente é %s", async (contactName, patientName) => {
    const lead = { name: contactName, phone: event.lead.phone };
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, lead, patientName }))
      .toEqual({ status: "synced", appointmentId: "987654321" });
    const [, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))! as unknown as [URL, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ PatientName: patientName, MobilePhone: "11999990000" });
    // Telefone para contato não prova que esse prontuário pertence ao paciente.
    expect(body).not.toHaveProperty("Patient_PersonId");
    expect(fetchMock.mock.calls.some(([url]) => url.pathname.includes("/patient/"))).toBe(false);
    expect(lead).toEqual({ name: contactName, phone: event.lead.phone });
    expect(db.lead.update).not.toHaveBeenCalled();
  });

  it("reconcilia o envio com nome completo e telefone mesmo quando o perfil tem só o primeiro nome", async () => {
    const original = fetchMock.getMockImplementation()!;
    let posted = false;
    const patientName = "Ana Carolina Almeida de Souza";
    fetchMock.mockImplementation(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith("/appointment/list")) return json(posted ? [{ ...externalRow, PatientName: patientName }] : []);
      if (url.pathname.endsWith("/create_appointment_by_api")) {
        expect(JSON.parse(String(init.body))).toMatchObject({ PatientName: patientName, MobilePhone: "11999990000" });
        posted = true;
        return new Response("", { status: 200 });
      }
      return original(url);
    });
    const input = { ...event, lead: { ...event.lead, name: "Ana" }, patientName, referenceId: "envio-nome-completo" };
    expect(await pushAppointmentToClinicorp("tenant-1", input)).toEqual({ status: "synced", appointmentId: "987654321" });
    expect(await pushAppointmentToClinicorp("tenant-1", input)).toEqual({ status: "synced", appointmentId: "987654321" });
    expect(fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/create_appointment_by_api"))).toHaveLength(1);
  });

  it.each([
    ["+55 (11) 99999-0000", "11999990000"],
    ["5511999990000", "11999990000"],
    ["+55 (11) 3333-4444", "1133334444"],
    ["(11) 99999-0000", "11999990000"],
    ["(55) 99999-0000", "55999990000"],
    ["+55 (55) 99999-0000", "55999990000"],
  ])("normaliza %s só no Clinicorp para %s, preservando DDD 55", async (phone, expected) => {
    const lead = { name: event.lead.name, phone };
    await pushAppointmentToClinicorp("tenant-1", { ...event, lead });
    const [lookup] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/patient/get"))!;
    expect(lookup.searchParams.get("Phone")).toBe(expected);
    const [, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))!;
    expect(JSON.parse(String(init.body)).MobilePhone).toBe(expected);
    expect(lead.phone).toBe(phone);
  });

  it("cria paciente e agenda com o mesmo telefone sem código do país", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: URL, init?: RequestInit) => {
      if (url.pathname.endsWith("/patient/get")) return json(null);
      if (url.pathname.endsWith("/patient/create")) return json({ PatientId: 33 });
      return original(url, init);
    });
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "synced" });
    const [, created] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/patient/create"))!;
    const [, booked] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))!;
    expect(JSON.parse(String(created.body))).toMatchObject({ MobilePhone: "11999990000", IgnoreSameName: "X" });
    expect(JSON.parse(String(booked.body))).toMatchObject({ MobilePhone: "11999990000", Patient_PersonId: 33 });
  });

  it("obtém PatientId por consulta quando o cadastro devolve só os dados documentados", async () => {
    const original = fetchMock.getMockImplementation()!;
    let lookups = 0;
    fetchMock.mockImplementation(async (url: URL, init?: RequestInit) => {
      if (url.pathname.endsWith("/patient/get")) return json(++lookups === 1 ? null : { PatientId: 88, Status: "ACTIVE" });
      if (url.pathname.endsWith("/patient/create")) return json({ Name: event.lead.name, MobilePhone: "11999990000" });
      return original(url, init);
    });
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "synced" });
    const lookupsSent = fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/patient/get"));
    expect(lookupsSent).toHaveLength(2);
    for (const [url] of lookupsSent) expect(url.searchParams.get("Phone")).toBe("11999990000");
    expect(fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/patient/create"))).toHaveLength(1);
    const [, booked] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))!;
    expect(JSON.parse(String(booked.body)).Patient_PersonId).toBe(88);
  });

  it("não cria paciente quando a busca pelo telefone falha", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: URL, init?: RequestInit) => url.pathname.endsWith("/patient/get")
      ? json({ Message: "Consulta indisponível" }, 500) : original(url, init));
    await pushAppointmentToClinicorp("tenant-1", event);
    expect(fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/patient/create"))).toBe(false);
    const [, booked] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))!;
    expect(JSON.parse(String(booked.body))).not.toHaveProperty("Patient_PersonId");
  });

  it("envia o tipo e a queixa da avaliação no campo Procedures documentado", async () => {
    const result = await createAppointment({
      tenantId: "tenant-1", leadId: "lead-1", title: event.lead.name,
      notes: "Avaliar possibilidade de implante", serviceType: "Avaliação",
      startsAt: event.startsAt, durationMinutes: 15, source: "agent", timezone: event.timeZone,
    });
    expect(result.clinicorpSync.status).toBe("synced");
    expect(db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notes: "Avaliar possibilidade de implante", serviceType: "Avaliação" }),
    }));
    const [, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))!;
    const body = JSON.parse(String(init.body));
    expect(body.Procedures).toBe("Avaliação\nAvaliar possibilidade de implante");
    expect(body).not.toHaveProperty("Notes");
  });

  it.each([null, [], {}, [{ Status: "CREATED" }], [{ Status: "ERROR", id: 7 }], { error: "recusado" }])("não registra sucesso para resposta 200 sem criação válida: %j", async (body) => {
    integration.categoryDescription = null;
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get") ? json({ PatientId: 33 }) : json(body));
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "failed" });
    expect(db.clinicorpIntegration.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: expect.any(String), lastErrorAt: expect.any(Date) }) }));
  });

  it.each([401, 403, 500])("preserva a agenda local quando o Clinicorp responde %i", async (status) => {
    fetchMock.mockResolvedValue(json({ error: "Falha" }, status));
    const result = await createAppointment({ tenantId: "tenant-1", leadId: "lead-1", title: event.title,
      startsAt: event.startsAt, durationMinutes: 15, source: "manual", timezone: event.timeZone });
    expect(result).toMatchObject({ id: "appointment-local", clinicorpAppointmentId: null, clinicorpSync: { status: "failed" } });
    expect(db.appointment.create).toHaveBeenCalledOnce();
    expect(db.appointment.update).toHaveBeenCalledWith({ where: { id: "appointment-local" }, data: { reminderOverride: Prisma.DbNull } });
  });

  it("não lança com timeout e não informa sincronização bem-sucedida", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    const result = await pushAppointmentToClinicorp("tenant-1", event);
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining("O Clinicorp não respondeu a tempo.") });
  });

  it("não envia sem contato", async () => {
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, lead: null })).toMatchObject({ status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ id: 1, Description: "Avaliação" }, { id: 2, Description: "Avaliação" }] }])("não escolhe categoria ausente ou ambígua: %j", async ({ rows }) => {
    fetchMock.mockResolvedValue(json(rows));
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "failed" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("desligar impede envio, mas permite cancelar o agendamento anterior", async () => {
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false });
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
    await cancelAppointmentInClinicorp("tenant-1", "987654321");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0].pathname).toContain("cancel_appointment");
  });

  it("salva o identificador confirmado junto ao agendamento local", async () => {
    const result = await createAppointment({ tenantId: "tenant-1", leadId: "lead-1", title: event.title,
      startsAt: event.startsAt, durationMinutes: 15, source: "manual", timezone: event.timeZone });
    expect(result.clinicorpAppointmentId).toBe("987654321");
    expect(db.appointment.update).toHaveBeenCalledWith({ where: { id: "appointment-local" }, data: { clinicorpAppointmentId: "987654321", reminderOverride: Prisma.DbNull } });
  });
});

describe("conexão e preferências", () => {
  it.each([null, [], { error: "Token inválido" }])("não considera conexão válida apenas por receber HTTP 200: %j", async (body) => {
    fetchMock.mockResolvedValue(json(body));
    expect(await verifyClinicorpCredentials(credentials)).toMatchObject({ ok: false });
  });

  it("expõe erro ao carregar profissionais, permitindo tentar novamente sem limpar o escolhido", async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    expect(await listClinicorpProfessionals("tenant-1")).toMatchObject({ ok: false, error: expect.any(String) });
    expect(db.clinicorpIntegration.update).not.toHaveBeenCalled();
  });

  it("mapeia os campos oficiais de categorias", async () => {
    expect(await listClinicorpCategories("tenant-1")).toEqual({ ok: true, data: [{ id: "1234567890125", name: "Avaliação" }] });
  });

  it("testa acesso sem criar dados nem apagar falha anterior de envio", async () => {
    expect(await testClinicorpConnection("tenant-1")).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(db.clinicorpIntegration.update).not.toHaveBeenCalled();
  });

  it("não exibe credenciais ilegíveis como conexão ativa nem expõe os segredos na UI", async () => {
    const status = await getClinicorpStatus("tenant-1");
    expect(status).not.toHaveProperty("apiUser");
    expect(status).not.toHaveProperty("apiToken");
    integration.apiToken = "cifra-corrompida";
    expect(await getClinicorpStatus("tenant-1")).toBeNull();
  });

  it("renova credenciais sem sobrescrever o profissional ou a categoria", async () => {
    await saveClinicorpCredentials("tenant-1", credentials);
    const { update } = db.clinicorpIntegration.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("dentistId");
    expect(update).not.toHaveProperty("categoryDescription");
    expect(update.apiToken).not.toBe(credentials.apiToken);
  });
});

describe("disponibilidade", () => {
  it.each([null, {}, { appointments: [] }, [null], [{ fromTime: "16:00" }], [{ fromTime: "16:00", toTime: "inválido" }]])("não transforma resposta incompleta em horário livre: %j", async (body) => {
    fetchMock.mockImplementation(async () => json(body));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBeNull();
    expect(await listClinicorpBusyBlocks("tenant-1", "2026-09-14", event.timeZone)).toBeNull();
  });
  it.each([401, 403, 500])("não oferece disponibilidade se a consulta retorna %i", async (status) => {
    fetchMock.mockImplementation(async () => json({ message: "indisponível" }, status));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBeNull();
    expect(await listClinicorpBusyBlocks("tenant-1", "2026-09-14", event.timeZone)).toBeNull();
  });
  it("distingue timeout e credencial ilegível de uma integração desabilitada", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBeNull();
    integration.apiToken = "credencial-inválida";
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBeNull();
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false });
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBe(false);
    expect(await listClinicorpBusyBlocks("tenant-1", "2026-09-14", event.timeZone)).toEqual([]);
  });
  it("permite agenda realmente vazia e consulta de disponibilidade desligada", async () => {
    fetchMock.mockImplementation(async () => json([]));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBe(false);
    integration.checkAvailability = false;
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await listClinicorpBusyBlocks("tenant-1", "2026-09-14", event.timeZone)).toEqual([]);
  });
  it("bloqueio de dia inteiro cobre também o último minuto", async () => {
    fetchMock.mockResolvedValue(json([{ AllDay: "X", ItemType: "ASSIGN" }]));
    expect(await hasClinicorpConflict("tenant-1", new Date("2026-09-15T02:59Z"), new Date("2026-09-15T03:00Z"), event.timeZone)).toBe(true);
  });
  it("ignora somente o espelho da própria consulta ao reagendar", async () => {
    fetchMock.mockResolvedValue(json([{ id: 123, Dentist_PersonId: 222222222222, fromTime: "16:00", toTime: "17:00" }]));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone, "123")).toBe(false);
    fetchMock.mockResolvedValue(json([
      { id: 123, Dentist_PersonId: 222222222222, fromTime: "16:00", toTime: "17:00" },
      { id: 456, Dentist_PersonId: 222222222222, fromTime: "16:00", toTime: "17:00" },
    ]));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone, "123")).toBe(true);
  });
  it("consulta o profissional escolhido, permite horários encostados e bloqueia sobreposição", async () => {
    fetchMock.mockResolvedValue(json([
      { Dentist_PersonId: 999, fromTime: "16:30", toTime: "17:00" },
      { Dentist_PersonId: 222222222222, fromTime: "16:15", toTime: "16:30" },
    ]));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBe(false);
    fetchMock.mockResolvedValue(json([{ Dentist_PersonId: 222222222222, fromTime: "16:40", toTime: "17:00" }]));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBe(true);
  });
});

// Relato: o Instituto do Sorriso tinha consultas no Clinicorp que não
// apareciam na /agenda — ela só lia o banco do fechai.
describe("agenda do Clinicorp na /agenda", () => {
  const tz = "America/Sao_Paulo";
  const agenda = (rows: unknown, professionals: unknown = [{ id: 222222222222, name: "Dra. Ana" }]) =>
    fetchMock.mockImplementation(async (url: URL) =>
      url.pathname.endsWith("/list_all_professionals") ? json(professionals) : json(rows));
  const list = () => listClinicorpAgenda("tenant-1", "2026-09-01", "2026-09-30", tz);

  it("preserva categoria explícita e não extrai o tipo das notas", async () => {
    agenda([
      { id: 1, AtomicDate: 20260929, fromTime: "08:00", CategoryId: "123456789123456789", CategoryDescription: " Avaliação " },
      { id: 2, AtomicDate: 20260929, fromTime: "09:00", CategoryId: 12 },
      { id: 3, AtomicDate: 20260929, fromTime: "10:00", Notes: "Avaliação", CategoryId: Number.MAX_SAFE_INTEGER + 1 },
    ]);
    const result = await list();
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.items).toEqual([
      expect.objectContaining({ categoryId: "123456789123456789", category: "Avaliação" }),
      expect.objectContaining({ categoryId: "12", category: null }),
      expect.objectContaining({ categoryId: null, category: null }),
    ]);
  });

  it("lê o mês inteiro da clínica escolhida, sem gravar nada", async () => {
    agenda([]);
    expect(await list()).toEqual({ status: "ok", items: [], skipped: 0, fetchedAt: expect.any(Number) });
    const [url] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/appointment/list"))! as unknown as [URL];
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", businessId: "4791226171916288", includeCanceled: "X" });
    expect(url.searchParams.has("includeAssigns")).toBe(false);
    expect(db.clinicorpIntegration.update).not.toHaveBeenCalled();
  });

  it("põe cada consulta no dia local certo, nos três formatos de data", async () => {
    agenda([
      { id: 1, AtomicDate: 20260929, fromTime: "08:00", toTime: "08:30", PatientName: "Atômica" },
      // Dia local à meia-noite UTC, como o próprio fechai envia.
      { id: 2, date: "2026-09-29T00:00:00.000Z", fromTime: "09:00", toTime: "09:30", PatientName: "Meia-noite UTC" },
      // Meia-noite de Brasília em UTC.
      { id: 3, date: "2026-09-29T03:00:00.000Z", fromTime: "10:00", toTime: "10:30", PatientName: "Meia-noite local" },
    ]);
    const result = await list();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.items.map((i) => i.startsAt.toISOString())).toEqual([
      "2026-09-29T11:00:00.000Z", "2026-09-29T12:00:00.000Z", "2026-09-29T13:00:00.000Z",
    ]);
  });

  it("preserva consultas canceladas para exibição, com profissional e sem inventar fim", async () => {
    agenda([
      { id: 4791226171916288, ItemType: "APPOINTMENT", AtomicDate: 20260929, fromTime: "17:45", toTime: "18:00",
        PatientName: "Maria", MobilePhone: "11999990000", Dentist_PersonId: 222222222222, Notes: "Retorno" },
      { id: 5, ItemType: "ASSIGN", AtomicDate: 20260929, fromTime: "12:00", toTime: "13:00", Name: "Almoço" },
      { id: 6, AtomicDate: 20260929, fromTime: "14:00", toTime: "14:30", Canceled: "X" },
      { id: 8, AtomicDate: 20260929, fromTime: "14:30", Deleted: "X", Canceled: "X" },
      { id: 7, AtomicDate: 20260929, fromTime: "15:00", toTime: "inválido", PatientName: "Sem fim" },
    ]);
    const result = await list();
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.items).toEqual([
      expect.objectContaining({ id: "6", canceled: true }),
      expect.objectContaining({ id: "7", canceled: false, patientName: "Sem fim", endsAt: null }),
      expect.objectContaining({ id: "4791226171916288", patientName: "Maria", phone: "11999990000",
        professional: "Dra. Ana", notes: "Retorno", endsAt: new Date("2026-09-29T21:00:00.000Z") }),
    ]);
  });

  it("conta o que não dá para posicionar em vez de esconder calado", async () => {
    agenda([null, { id: 8, fromTime: "09:00" }, { AtomicDate: 20260929, fromTime: "09:00" }, { id: 9, AtomicDate: 20260929 }]);
    expect(await list()).toEqual({ status: "ok", items: [], skipped: 4, fetchedAt: expect.any(Number) });
  });

  it("sem a lista de profissionais, as consultas aparecem sem o nome", async () => {
    agenda([{ id: 1, AtomicDate: 20260929, fromTime: "08:00", Dentist_PersonId: 222222222222 }], { error: "sem acesso" });
    expect(await list()).toMatchObject({ status: "ok", items: [expect.objectContaining({ professional: null })] });
  });

  it.each([401, 500])("devolve erro para a tela avisar quando o Clinicorp responde %i", async (status) => {
    fetchMock.mockResolvedValue(json({ message: "indisponível" }, status));
    expect(await list()).toMatchObject({ status: "error", error: expect.any(String) });
    expect(db.clinicorpIntegration.update).not.toHaveBeenCalled();
  });

  // Relato: a tela ficou travada — cada clique num dia esperava o Clinicorp.
  it("reaproveita a leitura do mês nos cliques seguintes, e o pulso relê de verdade", async () => {
    agenda([{ id: 1, AtomicDate: 20260929, fromTime: "08:00", PatientName: "Primeira" }]);
    const listCalls = () => fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/appointment/list")).length;
    const proCalls = () => fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/list_all_professionals")).length;

    await list();
    await list();
    expect(listCalls()).toBe(1);

    agenda([{ id: 2, AtomicDate: 20260929, fromTime: "09:00", PatientName: "Nova no Clinicorp" }]);
    const fresh = await listClinicorpAgenda("tenant-1", "2026-09-01", "2026-09-30", tz, { fresh: true });
    expect(fresh).toMatchObject({ status: "ok", items: [expect.objectContaining({ patientName: "Nova no Clinicorp" })] });
    // O pulso reabastece o cache: o clique seguinte já vê a consulta nova.
    expect(await list()).toMatchObject({ items: [expect.objectContaining({ patientName: "Nova no Clinicorp" })] });
    expect(listCalls()).toBe(2);
    // Profissional quase nunca muda: uma chamada só.
    expect(proCalls()).toBe(1);
  });

  // Relato: trocar de mês continuava lento — cada volta a um mês esperava o Clinicorp.
  it("serve o mês do cache por muito tempo, dizendo de quando é a leitura", async () => {
    agenda([]);
    const first = await list();
    const later = Date.now() + 20 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const again = await list();
    expect(fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/appointment/list"))).toHaveLength(1);
    // A tela usa isso para perguntar na hora se a leitura é velha.
    expect(again).toMatchObject({ status: "ok", fetchedAt: first.status === "ok" ? first.fetchedAt : -1 });
  });

  it("dois pedidos ao mesmo tempo esperam a mesma chamada", async () => {
    agenda([]);
    await Promise.all([list(), list(), list()]);
    expect(fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/appointment/list"))).toHaveLength(1);
  });

  it("desligar a integração para na hora, mesmo com o mês em cache", async () => {
    agenda([{ id: 1, AtomicDate: 20260929, fromTime: "08:00" }]);
    expect(await list()).toMatchObject({ status: "ok" });
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false });
    expect(await list()).toEqual({ status: "off" });
  });

  it("não chama a API com a integração desligada, sem clínica ou sem credencial legível", async () => {
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false });
    expect(await list()).toEqual({ status: "off" });
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: true });
    integration.businessId = null;
    expect(await list()).toEqual({ status: "off" });
    integration.businessId = "4791226171916288";
    integration.apiToken = "cifra-corrompida";
    expect(await list()).toEqual({ status: "off" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("recusa explícita de horário ocupado (relato da Paula)", () => {
  it("cancela a tentativa recusada por conflito sem marcar o lead nem enviar ao Google", async () => {
    fetchMock.mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith("/list_categories")) return json([{ id: 1234567890125, Description: "Avaliação" }]);
      if (url.pathname.endsWith("/patient/get")) return json({ PatientId: 333333333333 });
      return json({ message: "O horário solicitado encontra-se ocupado" }, 400);
    });
    const result = await createAppointment({ tenantId: "tenant-1", leadId: "lead-1", title: event.title,
      startsAt: event.startsAt, durationMinutes: 15, source: "agent", timezone: event.timeZone });
    expect(result.clinicorpSync).toMatchObject({ status: "failed", reason: "conflict" });
    expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "appointment-local", tenantId: "tenant-1", status: "scheduled" },
      data: { status: "canceled", reminderOverride: [], notes: expect.stringContaining("horário ocupado") },
    }));
    expect(result.status).toBe("canceled");
    expect(db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reminderOverride: [] }) }));
    expect(db.appointment.update).not.toHaveBeenCalled();
    expect(result.googleEventId).toBeNull();
    expect(db.lead.update).not.toHaveBeenCalled();
  });
});

// Relato: "Última tentativa falhou: Vincule um contato com telefone" — vinha do
// chat de teste. O teste precisa marcar em todas as integrações, mas o telefone
// dele é sintético ("sandbox:<agente>").
describe("agendamento do chat de teste", () => {
  const body = () => {
    const [, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))! as unknown as [URL, RequestInit];
    return JSON.parse(String(init.body));
  };

  it("vincula o paciente exclusivo de teste, sem inventar telefone", async () => {
    db.lead.findUnique.mockResolvedValue(testLead);
    const result = await createAppointment({ tenantId: "tenant-1", leadId: "lead-teste", title: event.title,
      startsAt: event.startsAt, durationMinutes: 15, source: "agent", timezone: event.timeZone });

    expect(result.clinicorpSync).toEqual({ status: "synced", appointmentId: "987654321" });
    expect(fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/patient/get") && url.searchParams.get("Name") === "TESTE fechai (chat de teste do agente)")).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/patient/create"))).toBe(false);
    expect(body()).not.toHaveProperty("MobilePhone");
    expect(body().Patient_PersonId).toBe(333333333333);
    expect(body().PatientName).toContain("TESTE");
    expect(body().Procedures).toContain("chat de teste");
    expect(body()).not.toHaveProperty("Notes");
    expect(db.clinicorpIntegration.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: expect.stringContaining("telefone") }) }));
  });

  it("contato real sem telefone continua recusado", async () => {
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, lead: { name: "Fulano", phone: null } })).toMatchObject({ status: "failed" });
  });
});

// Relato: o aviso laranja do card era genérico ("Vincule um contato com
// telefone") — sem dizer qual agendamento, de quem, nem o que o Clinicorp disse.
describe("aviso de falha com o motivo", () => {
  const lastError = () => {
    const calls = db.clinicorpIntegration.update.mock.calls as unknown as [{ data: { lastError?: string } }][];
    return calls.map(([arg]) => arg.data.lastError).filter(Boolean).at(-1) ?? "";
  };

  it("diz de quem é o agendamento, para quando, e o que fazer", async () => {
    await pushAppointmentToClinicorp("tenant-1", { ...event, lead: { name: "Maria Souza", phone: null } });
    expect(lastError()).toContain("Maria Souza");
    expect(lastError()).toMatch(/14 de set\.?,? .*16:30/);
    expect(lastError()).toContain("salvo só no fechai");
    expect(lastError()).toContain("Adicione o telefone em Contatos");
  });

  it("repassa a mensagem que o Clinicorp escreveu no erro HTTP", async () => {
    integration.categoryDescription = null;
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get")
      ? json({ PatientId: 33 })
      : json({ message: "Profissional sem agenda neste horário" }, 400));
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ error: expect.stringContaining("Profissional sem agenda neste horário") });
    expect(lastError()).toContain('erro 400: "Profissional sem agenda neste horário"');
  });

  it("cria uma única vez o cadastro sem telefone e confere o id antes de enviar", async () => {
    const original = fetchMock.getMockImplementation()!;
    let lookups = 0;
    fetchMock.mockImplementation(async (url: URL, init?: RequestInit) => {
      if (url.pathname.endsWith("/patient/get")) return json(++lookups === 1 ? null : { PatientId: 88, Name: "TESTE fechai (chat de teste do agente)", Status: "ACTIVE" });
      if (url.pathname.endsWith("/patient/create")) return json({ Name: "TESTE fechai (chat de teste do agente)" });
      if (url.pathname.endsWith("/create_appointment_by_api") && !JSON.parse(String(init?.body)).Patient_PersonId) return json([]);
      return original(url, init);
    });
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, lead: testLead })).toMatchObject({ status: "synced" });
    const creates = fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/patient/create"));
    expect(creates).toHaveLength(1);
    const patient = JSON.parse(String(creates[0][1]?.body));
    expect(patient.Name).toBe("TESTE fechai (chat de teste do agente)");
    expect(patient).not.toHaveProperty("MobilePhone");
    expect(patient).not.toHaveProperty("IgnoreSameName");
    const [, booked] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))!;
    expect(JSON.parse(String(booked?.body)).Patient_PersonId).toBe(88);
  });

  it.each([json({ Name: "Paciente real", PatientId: 88 }), json(null, 500), json([{ PatientId: 88 }, { PatientId: 99 }])])("não cria cadastro ou horário quando a busca do teste é ambígua ou falha", async (response) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: URL, init?: RequestInit) => url.pathname.endsWith("/patient/get") ? response.clone() : original(url, init));
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, lead: testLead })).toMatchObject({ status: "failed" });
    expect(fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/patient/create") || url.pathname.endsWith("/create_appointment_by_api"))).toBe(false);
  });

  it.each([200, 204])("explica resposta HTTP %i vazia e mantém uma única reserva local", async (status) => {
    integration.categoryDescription = null;
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get")
      ? json({ PatientId: 33 }) : new Response(status === 204 ? null : "", { status }));
    const result = await createAppointment({
      tenantId: "tenant-1", leadId: "lead-1", title: event.title,
      startsAt: event.startsAt, durationMinutes: 15, source: "agent", timezone: event.timeZone,
    });
    expect(result).toMatchObject({ id: "appointment-local", clinicorpAppointmentId: null, clinicorpSync: { status: "failed" } });
    expect(lastError()).toContain(`Resposta HTTP ${status} sem conteúdo`);
    expect(db.appointment.create).toHaveBeenCalledOnce();
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => url.pathname.endsWith("/create_appointment_by_api"))).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith("[clinicorp] criar agendamento sem confirmação", expect.objectContaining({
      httpStatus: status, emptyBody: true, responseType: "null", responseFields: [],
    }));
  });

  it("mostra motivo em resposta 200 sem id e registra só a estrutura sem dados privados", async () => {
    integration.categoryDescription = null;
    const response = { Message: "Cadastro do paciente obrigatório", PatientName: "Nome privado", MobilePhone: "11999990000", token: "token-privado" };
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get")
      ? json({ PatientId: 33 }) : json(response));
    const result = await pushAppointmentToClinicorp("tenant-1", event);
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining('Motivo informado: "Cadastro do paciente obrigatório"') });
    expect(lastError()).toContain("Cadastro do paciente obrigatório");
    const diagnostics = vi.mocked(console.error).mock.calls.find(([label]) => label === "[clinicorp] criar agendamento sem confirmação")!;
    expect(diagnostics[1]).toMatchObject({ httpStatus: 200, responseType: "object", hasId: false });
    const logged = JSON.stringify(diagnostics);
    for (const privateValue of [response.PatientName, response.MobilePhone, response.token, credentials.apiUser, credentials.apiToken]) {
      expect(logged).not.toContain(privateValue);
    }
  });

  it("distingue status sem confirmação de identificador ausente", async () => {
    integration.categoryDescription = null;
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get")
      ? json({ PatientId: 33 }) : json([{ Status: "PENDING", id: 7 }]));
    const result = await pushAppointmentToClinicorp("tenant-1", event);
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining("O status retornado não confirma a criação") });
    expect(lastError()).toContain('status "PENDING"');
    expect(lastError()).not.toContain("não contém um identificador");
  });

  it("repassa o motivo de uma recusa em 200 e ignora página HTML", async () => {
    integration.categoryDescription = null;
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get")
      ? json({ PatientId: 33 })
      : json([{ Status: "ERROR", error: "Horário bloqueado" }]));
    await pushAppointmentToClinicorp("tenant-1", event);
    expect(lastError()).toContain('O Clinicorp recusou: "Horário bloqueado"');

    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get")
      ? json({ PatientId: 33 })
      : new Response("<html><body>Bad Gateway</body></html>", { status: 502 }));
    await pushAppointmentToClinicorp("tenant-1", event);
    expect(lastError()).toContain("erro 502 sem explicar o motivo");
    expect(lastError()).not.toContain("<html>");
  });

  it("aponta a categoria pelo nome quando ela sumiu do Clinicorp", async () => {
    integration.categoryDescription = "Retorno";
    await pushAppointmentToClinicorp("tenant-1", event);
    expect(lastError()).toContain('A categoria "Retorno" não existe mais no Clinicorp');
  });
});
