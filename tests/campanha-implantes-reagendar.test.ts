import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-04 — a lista da recepção: consultas futuras de leads da campanha fora de
 * 18 e 19/11 às 09:00 (hora de Brasília). Só leitura: o prisma simulado prova que
 * nenhuma escrita acontece.
 */

type Appt = {
  id: string;
  tenantId: string;
  leadId: string | null;
  status: string;
  startsAt: Date;
  patientName: string | null;
  clinicorpAppointmentId: string | null;
  serviceType: string | null;
  reminderOverride: unknown;
  remindersSent: number[];
  lead: { name: string | null; phone: string; isTest: boolean } | null;
};

const db = vi.hoisted(() => ({
  appointments: [] as unknown[],
  config: null as unknown,
  configFails: false,
  campaignFails: false,
  writes: [] as string[],
  seen: [] as unknown[],
}));

vi.mock("@/lib/prisma", () => {
  const writer = (model: string, op: string) =>
    vi.fn(async () => {
      db.writes.push(`${model}.${op}`);
      throw new Error("escrita não permitida");
    });
  const writes = (model: string) => ({
    create: writer(model, "create"),
    createMany: writer(model, "createMany"),
    update: writer(model, "update"),
    updateMany: writer(model, "updateMany"),
    upsert: writer(model, "upsert"),
    delete: writer(model, "delete"),
    deleteMany: writer(model, "deleteMany"),
  });
  return {
    prisma: {
      campaignOverride: {
        ...writes("campaignOverride"),
        findMany: vi.fn(async () => [
          {
            id: "o1",
            key: "implantes-2026-11",
            adCodes: ["AD27"],
            adSourceIds: [],
            broadcastCampaignIds: [],
            leadIds: [],
            startsAt: new Date("2026-11-10T00:00:00Z"),
            endsAt: new Date("2026-11-20T02:59:59Z"),
            rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00" },
          },
        ]),
      },
      leadAdOrigin: {
        ...writes("leadAdOrigin"),
        findMany: vi.fn(async ({ where }: { where: { leadId: { in: string[] } } }) =>
          where.leadId.in.filter((id) => id.startsWith("camp-")).map((leadId) => ({ leadId, code: "AD27", sourceId: null })),
        ),
      },
      lead: { ...writes("lead"), findMany: vi.fn(async () => []) },
      broadcastRecipient: { ...writes("broadcastRecipient"), findMany: vi.fn(async () => []) },
      appointment: {
        ...writes("appointment"),
        findMany: vi.fn(async ({ where }: { where: { tenantId: string; status: string; startsAt: { gt: Date } } }) => {
          db.seen.push(where);
          // Devolve tudo da conta, de propósito: o código não pode depender só do filtro do banco.
          return (db.appointments as Appt[]).filter((a) => a.tenantId === where.tenantId);
        }),
      },
    },
  };
});

vi.mock("@/modules/campaigns/active", () => ({
  loadReminderOverrides: vi.fn(async () => {
    if (db.campaignFails) throw new Error("campanhas fora do ar");
    return new Map();
  }),
}));
// Só a leitura da config da conta é simulada: remindersFor e staleReminders são as do worker.
vi.mock("../workers/follow-up-worker/reminders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workers/follow-up-worker/reminders")>()),
  loadAccountScheduleConfigs: vi.fn(async () => {
    if (db.configFails) throw new Error("banco fora do ar");
    return new Map(db.config ? [["t1", db.config]] : []);
  }),
}));

import ExcelJS from "exceljs";
import { DEFAULT_SCHEDULE_CONFIG } from "@/modules/scheduling/config";
import {
  buildRescheduleWorkbook,
  isInEventSlot,
  listRescheduleCandidates,
  reminderLabel,
  rescheduleFileName,
} from "@/modules/campaign-override/reschedule-list";

const TENANT = "t1";
const NOW = new Date("2026-11-13T15:00:00Z");

function appt(id: string, leadId: string, startsAtIso: string, patch: Partial<Appt> = {}): Appt {
  return {
    id,
    tenantId: TENANT,
    leadId,
    status: "scheduled",
    startsAt: new Date(startsAtIso),
    patientName: null,
    clinicorpAppointmentId: null,
    serviceType: null,
    reminderOverride: null,
    remindersSent: [],
    lead: { name: `Nome ${leadId}`, phone: `55149${leadId.length}`, isTest: false },
    ...patch,
  };
}

beforeEach(() => {
  db.appointments = [];
  db.config = { ...DEFAULT_SCHEDULE_CONFIG, reminderEnabled: true, reminders: [
    { minutesBefore: 1440, template: "x" },
    { minutesBefore: 120, template: "x" },
  ] };
  db.configFails = false;
  db.campaignFails = false;
  db.writes = [];
  db.seen = [];
});

describe("listRescheduleCandidates", () => {
  it("lead da campanha às 09:30 em 18/11 aparece; em 20/11 aparece", async () => {
    db.appointments = [appt("a1", "camp-1", "2026-11-18T12:30:00Z"), appt("a2", "camp-2", "2026-11-20T12:00:00Z")];
    const rows = await listRescheduleCandidates(TENANT, NOW);
    expect(rows.map((r) => [r.date, r.time])).toEqual([
      ["2026-11-18", "09:30"],
      ["2026-11-20", "09:00"],
    ]);
    expect(rows[0].origin).toBe("anúncio AD27");
  });

  it("lead da campanha em 19/11 às 09:00 (-03:00) não aparece, nem em 18/11 às 09:00", async () => {
    db.appointments = [appt("a1", "camp-1", "2026-11-19T12:00:00Z"), appt("a2", "camp-2", "2026-11-18T12:00:00Z")];
    expect(await listRescheduleCandidates(TENANT, NOW)).toEqual([]);
  });

  it("respeita o fuso: o dia e a hora são locais, nunca UTC", async () => {
    db.appointments = [
      appt("a2", "camp-2", "2026-11-18T00:30:00Z"), // 17/11 21:30 local: fora do dia
      appt("a3", "camp-3", "2026-11-19T00:00:00Z"), // 18/11 21:00 local: fora da hora
      appt("a1", "camp-1", "2026-11-19T09:00:00Z"), // 06:00 local: fora da hora
    ];
    const rows = await listRescheduleCandidates(TENANT, NOW);
    expect(rows.map((r) => `${r.date} ${r.time}`)).toEqual(["2026-11-17 21:30", "2026-11-18 21:00", "2026-11-19 06:00"]);
    expect(isInEventSlot(new Date("2026-11-19T12:00:00Z"), { dates: ["2026-11-19"], time: "09:00" })).toBe(true);
    expect(isInEventSlot(new Date("2026-11-20T00:00:00Z"), { dates: ["2026-11-19"], time: "21:00" })).toBe(true);
  });

  it("lead fora da campanha não aparece", async () => {
    db.appointments = [appt("a1", "organico-1", "2026-11-25T12:00:00Z")];
    expect(await listRescheduleCandidates(TENANT, NOW)).toEqual([]);
  });

  it("consulta cancelada ou passada não aparece, e o lead de teste fica de fora", async () => {
    db.appointments = [
      appt("a1", "camp-1", "2026-11-25T12:00:00Z", { status: "canceled" }),
      appt("a2", "camp-2", "2026-11-12T12:00:00Z"),
      appt("a3", "camp-3", "2026-11-26T12:00:00Z"),
    ];
    const rows = await listRescheduleCandidates(TENANT, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-11-26");
    expect(db.seen[0]).toMatchObject({ tenantId: TENANT, status: "scheduled", startsAt: { gt: NOW }, lead: { isTest: false } });
  });

  it("traz o ID do Clinicorp", async () => {
    db.appointments = [appt("a1", "camp-1", "2026-11-25T12:00:00Z", { clinicorpAppointmentId: "4791226171916288" }), appt("a2", "camp-2", "2026-11-26T12:00:00Z")];
    const rows = await listRescheduleCandidates(TENANT, NOW);
    expect(rows.map((r) => r.clinicorpAppointmentId)).toEqual(["4791226171916288", null]);
  });

  it("o nome é o do paciente da consulta; sem ele, o do contato; o telefone é o do contato", async () => {
    db.appointments = [
      appt("a1", "camp-1", "2026-11-25T12:00:00Z", { patientName: " Paciente Real " }),
      appt("a2", "camp-2", "2026-11-26T12:00:00Z", { patientName: "  " }),
      appt("a3", "camp-3", "2026-11-27T12:00:00Z", { patientName: null, lead: { name: null, phone: "5514900", isTest: false } }),
    ];
    const rows = await listRescheduleCandidates(TENANT, NOW);
    expect(rows.map((r) => r.name)).toEqual(["Paciente Real", "Nome camp-2", "(sem nome)"]);
    expect(rows[0].phone).toBe("55149" + "6");
  });
});

describe("--evento (consultas dentro da regra também)", () => {
  it("lista as consultas de 18/19 às 09:00 junto com as que precisam reagendar, marcadas com inEvent", async () => {
    db.appointments = [
      appt("a1", "camp-1", "2026-11-18T12:00:00Z"),
      appt("a2", "camp-2", "2026-11-20T12:00:00Z"),
      appt("a3", "organico-1", "2026-11-19T12:00:00Z"),
    ];
    const rows = await listRescheduleCandidates(TENANT, NOW, undefined, { includeEvent: true });
    expect(rows.map((r) => [r.date, r.time, r.inEvent])).toEqual([
      ["2026-11-18", "09:00", true],
      ["2026-11-20", "09:00", false],
    ]);
    // Sem a opção, a lista segue como antes (só as fora da regra, sem o campo novo).
    const plain = await listRescheduleCandidates(TENANT, NOW);
    expect(plain.map((r) => r.date)).toEqual(["2026-11-20"]);
    expect(plain[0].inEvent).toBeUndefined();
    expect(db.writes).toEqual([]);
  });

  it("a planilha ganha a coluna 'O que fazer'; sem --evento as colunas não mudam", () => {
    const row = { name: "Maria", phone: "5514998586900", date: "2026-11-18", time: "09:00", origin: "manual", clinicorpAppointmentId: null, reminder: { status: "no" as const, pending: 0 } };
    const withEvent = buildRescheduleWorkbook([{ ...row, inEvent: true }, { ...row, date: "2026-11-20", inEvent: false }], { withEvent: true }).getWorksheet("Reagendar")!;
    expect(withEvent.getRow(1).getCell(8).value).toBe("O que fazer");
    expect(withEvent.getRow(2).getCell(8).value).toBe("Lançar no Clinicorp");
    expect(withEvent.getRow(3).getCell(8).value).toBe("Reagendar");
    expect(buildRescheduleWorkbook([row]).getWorksheet("Reagendar")!.getRow(1).cellCount).toBe(7);
  });
});

describe("lembrete agendado (mesma regra do worker)", () => {
  const plan = async () => (await listRescheduleCandidates(TENANT, NOW)).map((r) => reminderLabel(r.reminder));

  it("conta os disparos que ainda vão sair: config da conta menos os já enviados", async () => {
    db.appointments = [
      appt("a1", "camp-1", "2026-11-25T12:00:00Z"),
      appt("a2", "camp-2", "2026-11-26T12:00:00Z", { remindersSent: [1440, 120] }),
      appt("a3", "camp-3", "2026-11-27T12:00:00Z", { remindersSent: [1440] }),
    ];
    expect(await plan()).toEqual(["sim (2 pendentes)", "não", "sim (1 pendente)"]);
  });

  it("override da consulta vence a conta; lista vazia é 'esta não recebe'", async () => {
    db.appointments = [
      appt("a1", "camp-1", "2026-11-25T12:00:00Z", { reminderOverride: [] }),
      appt("a2", "camp-2", "2026-11-26T12:00:00Z", { reminderOverride: [{ minutesBefore: 60, template: "x" }] }),
    ];
    expect(await plan()).toEqual(["não", "sim (1 pendente)"]);
  });

  it("disparo que já perdeu a janela não conta", async () => {
    // 14:00 local de hoje: o de 1 dia antes já passou do dia previsto; o de 2h está na hora.
    db.appointments = [appt("a1", "camp-1", "2026-11-13T17:00:00Z")];
    expect(await plan()).toEqual(["sim (1 pendente)"]);
  });

  it("lembretes desligados, conta sem config ou público não atendido: não", async () => {
    db.appointments = [appt("a1", "camp-1", "2026-11-25T12:00:00Z")];
    db.config = { ...(db.config as object), reminderEnabled: false };
    expect(await plan()).toEqual(["não"]);
    db.config = null;
    expect(await plan()).toEqual(["não"]);
    db.config = { ...DEFAULT_SCHEDULE_CONFIG, reminderEnabled: true, reminderAudience: "selected_types", reminderTypes: ["Avaliação"], reminders: [{ minutesBefore: 60, template: "x" }] };
    expect(await plan()).toEqual(["não"]);
  });

  it("falha ao ler a config ou as campanhas vira 'não sei', nunca 'não', e a lista segue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.appointments = [appt("a1", "camp-1", "2026-11-25T12:00:00Z")];
    db.configFails = true;
    expect(await plan()).toEqual(["não sei"]);
    db.configFails = false;
    db.campaignFails = true;
    expect(await plan()).toEqual(["não sei"]);
  });
});

describe("listRescheduleCandidates — escrita", () => {
  it("não escreve em nenhuma tabela", async () => {
    db.appointments = [appt("a1", "camp-1", "2026-11-25T12:00:00Z")];
    await listRescheduleCandidates(TENANT, NOW);
    expect(db.writes).toEqual([]);
  });

  it("falha de banco lança (a lista não pode virar 'ninguém para reagendar')", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.leadAdOrigin.findMany).mockRejectedValueOnce(new Error("fora do ar"));
    db.appointments = [appt("a1", "camp-1", "2026-11-25T12:00:00Z")];
    await expect(listRescheduleCandidates(TENANT, NOW)).rejects.toThrow();
  });
});

describe("planilha", () => {
  it("tem as colunas pedidas e o nome do arquivo não leva dado pessoal", async () => {
    const workbook = buildRescheduleWorkbook([
      { name: "Maria", phone: "5514998586900", date: "2026-11-25", time: "09:30", origin: "anúncio AD27", clinicorpAppointmentId: null, reminder: { status: "yes", pending: 2 } },
    ]);
    const sheet = workbook.getWorksheet("Reagendar")!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "Nome",
      "Telefone",
      "Data atual",
      "Hora atual",
      "Origem",
      "ID Clinicorp",
      "Lembrete agendado",
    ]);
    expect(sheet.getRow(2).getCell(3).value).toBe("25/11/2026");
    expect(sheet.getRow(2).getCell(7).value).toBe("sim (2 pendentes)");
    const buffer = await workbook.xlsx.writeBuffer();
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(buffer as ArrayBuffer);
    expect(reread.getWorksheet("Reagendar")!.rowCount).toBe(2);
    expect(rescheduleFileName(new Date("2026-11-13T15:05:00Z"))).toBe("campanha-implantes-reagendar-20261113-1205.xlsx");
  });
});
