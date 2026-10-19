import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testes dos lembretes pré-consulta.
 *
 * O estrago que cada regra evita é concreto:
 *
 * - config antiga (lembrete único, em campos soltos) perdendo o que a conta
 *   já tinha configurado — a mesma armadilha do `delayHours` do follow-up;
 * - config antiga ligando lembrete sozinha, mandando mensagem para a base de
 *   pacientes de quem nunca pediu;
 * - dois lembretes no mesmo instante virando duas mensagens coladas;
 * - um disparo calando os outros da mesma consulta;
 * - worker parado acordando e avisando "sua consulta é amanhã" para quem já
 *   foi atendido;
 * - ação de agendamento desligada continuando a mandar lembrete.
 */

const db = vi.hoisted(() => ({
  tenantAction: { findMany: vi.fn() },
  agent: { findMany: vi.fn() },
  appointment: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  whatsappInstance: { findMany: vi.fn() },
  whatsappBlockedNumber: { findUnique: vi.fn() },
  message: { create: vi.fn() },
}));
const provider = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn((...args: [string, string, string]) => {
    void args;
    return Promise.resolve("wamid-1");
  }),
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/modules/whatsapp", () => ({ getWhatsAppProvider: () => provider }));

vi.mock("@/modules/scheduling/reminder-dispatch", () => ({
  blockReminder: vi.fn(), claimReminder: vi.fn(async () => ({ id: "dispatch", token: "token", tenantId: "tenant-1" })),
  finishReminder: vi.fn(), markReminderManual: vi.fn(async () => true), reminderAlreadyHandled: vi.fn(async () => null),
  reminderSource: (id: string, remote?: string) => remote ? `clinicorp:${remote}` : `appointment:${id}`,
}));

import {
  DEFAULT_REMINDER_MINUTES,
  DEFAULT_REMINDER_TEMPLATE,
  MAX_REMINDER_MINUTES,
  REMINDER_VARIABLES,
  describeSchedule,
  formatReminderLead,
  parseScheduleConfig,
  renderReminder,
  splitReminderLead,
  validateReminders,
} from "@/modules/scheduling/config";
import { parseReminderOverride, serializeReminderOverride } from "@/modules/scheduling/reminder-override";
import {
  dueReminders,
  reminderDueAt,
  remindersFor,
  scanAndSendReminders,
  staleReminders,
} from "../workers/follow-up-worker/reminders";

const AGENTE = "agente-1";
const CONTA = "tenant-1";
const AGORA = new Date("2026-09-16T12:00:00.000Z");
const UM_DIA = 24 * 60;
const UMA_SEMANA = 7 * 24 * 60;

describe("Leitura da config (parseScheduleConfig)", () => {
  it("não liga o lembrete numa config antiga, que não tem o campo", () => {
    expect(parseScheduleConfig({ startTime: "09:00" }).reminderEnabled).toBe(false);
    expect(parseScheduleConfig(null).reminderEnabled).toBe(false);
  });

  it("converte o formato antigo de lembrete único, sem perder o que estava salvo", () => {
    // Toda conta que configurou lembrete antes da lista existir tem
    // `reminderMinutesBefore`/`reminderTemplate` no banco. Ignorá-los faria o
    // lembrete escolhido virar o padrão em silêncio.
    const cfg = parseScheduleConfig({
      reminderEnabled: true,
      reminderMinutesBefore: 120,
      reminderTemplate: "Texto antigo {{nome}}",
    });
    expect(cfg.reminders).toEqual([{ minutesBefore: 120, template: "Texto antigo {{nome}}" }]);
  });

  it("prefere a lista nova quando os dois formatos existem", () => {
    const cfg = parseScheduleConfig({
      reminderMinutesBefore: 120,
      reminderTemplate: "antigo",
      reminders: [{ minutesBefore: UM_DIA, template: "novo" }],
    });
    expect(cfg.reminders).toEqual([{ minutesBefore: UM_DIA, template: "novo" }]);
  });

  it("preserva o horário fixo válido e ignora um horário inválido na leitura", () => {
    const cfg = parseScheduleConfig({ reminders: [
      { minutesBefore: UM_DIA, sendTime: "08:30", template: "confirme" },
      { minutesBefore: 120, sendTime: "08:30", template: "em duas horas" },
    ] });
    expect(cfg.reminders).toEqual([
      { minutesBefore: UM_DIA, sendTime: "08:30", template: "confirme" },
      { minutesBefore: 120, template: "em duas horas" },
    ]);
  });

  it("ordena do mais distante para o mais próximo — a ordem dos disparos", () => {
    const cfg = parseScheduleConfig({
      reminders: [
        { minutesBefore: 120, template: "a" },
        { minutesBefore: UMA_SEMANA, template: "b" },
        { minutesBefore: UM_DIA, template: "c" },
      ],
    });
    expect(cfg.reminders.map((r) => r.minutesBefore)).toEqual([UMA_SEMANA, UM_DIA, 120]);
  });

  it("descarta linha inválida e duplicata sem lançar", () => {
    const cfg = parseScheduleConfig({
      reminders: [
        { minutesBefore: UM_DIA, template: "ok" },
        { minutesBefore: UM_DIA, template: "duplicado" },
        { minutesBefore: 0, template: "curto demais" },
        { minutesBefore: MAX_REMINDER_MINUTES + 1, template: "longe demais" },
        "lixo",
      ],
    });
    expect(cfg.reminders).toEqual([{ minutesBefore: UM_DIA, template: "ok" }]);
  });

  it("template vazio cai no texto padrão — lembrete nunca sai em branco", () => {
    const cfg = parseScheduleConfig({ reminders: [{ minutesBefore: 60, template: "   " }] });
    expect(cfg.reminders[0].template).toBe(DEFAULT_REMINDER_TEMPLATE);
  });

  it("sem nenhum lembrete salvo, nasce com um de um dia antes", () => {
    expect(parseScheduleConfig({}).reminders).toEqual([
      { minutesBefore: DEFAULT_REMINDER_MINUTES, template: DEFAULT_REMINDER_TEMPLATE },
    ]);
    expect(DEFAULT_REMINDER_MINUTES).toBe(UM_DIA);
  });

  it("o resumo do card conta os lembretes, sem estourar a linha", () => {
    const um = parseScheduleConfig({ reminderEnabled: true, reminders: [{ minutesBefore: UM_DIA, template: "x" }] });
    expect(describeSchedule(um)).toContain("lembrete 1 dia antes");

    const varios = parseScheduleConfig({
      reminderEnabled: true,
      reminders: [
        { minutesBefore: UMA_SEMANA, template: "x" },
        { minutesBefore: UM_DIA, template: "y" },
        { minutesBefore: 120, template: "z" },
      ],
    });
    expect(describeSchedule(varios)).toContain("3 lembretes (a partir de 1 semana antes)");

    const desligado = parseScheduleConfig({ reminderEnabled: false, reminders: [{ minutesBefore: UM_DIA, template: "x" }] });
    expect(describeSchedule(desligado)).not.toContain("lembrete");
  });
});

describe("Unidades da antecedência (minutos a semanas)", () => {
  it("reabre o valor na maior unidade inteira", () => {
    expect(splitReminderLead(UMA_SEMANA)).toEqual({ amount: 1, unit: "weeks" });
    expect(splitReminderLead(UM_DIA)).toEqual({ amount: 1, unit: "days" });
    expect(splitReminderLead(120)).toEqual({ amount: 2, unit: "hours" });
    expect(splitReminderLead(30)).toEqual({ amount: 30, unit: "minutes" });
    // 90 min não é hora cheia: fica em minutos em vez de virar 1,5h.
    expect(splitReminderLead(90)).toEqual({ amount: 90, unit: "minutes" });
  });

  it("escreve a antecedência como gente fala", () => {
    expect(formatReminderLead(2 * UMA_SEMANA)).toBe("2 semanas");
    expect(formatReminderLead(UM_DIA)).toBe("1 dia");
    expect(formatReminderLead(120)).toBe("2 horas");
    expect(formatReminderLead(30)).toBe("30 minutos");
  });
});

describe("Validação da lista (validateReminders)", () => {
  it("aceita uma lista longa — não há teto de quantidade", () => {
    // Quantos lembretes o paciente aguenta é decisão de quem conhece a base;
    // a tela avisa e interrompe com um popup, mas não impede.
    const muitos = Array.from({ length: 30 }, (_, i) => ({
      minutesBefore: i + 1,
      template: "oi",
    }));
    expect(validateReminders(muitos)).toBeNull();
  });

  it("recusa dois lembretes no mesmo momento", () => {
    // "1 dia" e "24 horas" digitados sem perceber que são a mesma coisa.
    const erro = validateReminders([
      { minutesBefore: UM_DIA, template: "a" },
      { minutesBefore: UM_DIA, template: "b" },
    ]);
    expect(erro).toContain("já tem um lembrete");
  });

  it("recusa texto vazio e antecedência fora da faixa", () => {
    expect(validateReminders([{ minutesBefore: UM_DIA, template: "  " }])).toContain("mensagem");
    expect(validateReminders([{ minutesBefore: 0, template: "oi" }])).toContain("1 minuto");
    expect(validateReminders([{ minutesBefore: MAX_REMINDER_MINUTES + 1, template: "oi" }]))
      .toContain("máxima");
  });

  it("aceita horário fixo na véspera e recusa horários inválidos", () => {
    expect(validateReminders([{ minutesBefore: UM_DIA, sendTime: "08:30", template: "Confirme" }]))
      .toBeNull();
    expect(validateReminders([{ minutesBefore: 120, sendTime: "08:30", template: "Confirme" }]))
      .toContain("dias ou semanas");
    expect(validateReminders([{ minutesBefore: UM_DIA, sendTime: "25:00", template: "Confirme" }]))
      .toContain("00:00");
  });
});

describe("Texto do lembrete (renderReminder)", () => {
  const vars = { nome: "Maria", data: "quinta-feira, 18 de setembro", hora: "15:00" };

  it("troca as quatro variáveis documentadas", () => {
    const texto = renderReminder("{{nome}} · {{data}} · {{hora}} ·{{local}}", {
      ...vars,
      local: "no consultório",
    });
    expect(texto).toBe("Maria · quinta-feira, 18 de setembro · 15:00 · no consultório");
  });

  it("some com {{local}} quando a conta não configurou local", () => {
    const texto = renderReminder(DEFAULT_REMINDER_TEMPLATE, { ...vars, local: "" });
    expect(texto).toContain("às 15:00.");
    expect(texto).not.toContain("  ");
  });

  it("não deixa espaço nem pontuação órfã com contato sem nome", () => {
    const texto = renderReminder("Oi {{nome}}! Consulta {{data}}.", { ...vars, nome: "" });
    expect(texto).toBe("Oi! Consulta quinta-feira, 18 de setembro.");
  });

  it("apaga token desconhecido em vez de mandá-lo cru ao paciente", () => {
    const texto = renderReminder("Consulta com {{medico}} {{data}}.", vars);
    expect(texto).not.toContain("{{");
  });

  it("usa variável da conversa e remove tokens desconhecidos com acento ou hífen", () => {
    const texto = renderReminder("Oi {{nome}}! {{procedimento}} {{médico}} {{sem-valor}}", {
      ...vars,
      extras: { procedimento: "Limpeza" },
    });
    expect(texto).toBe("Oi Maria! Limpeza");
  });

  it("o template padrão usa só variáveis que existem", () => {
    const tokens = DEFAULT_REMINDER_TEMPLATE.match(/\{\{\s*\w+\s*\}\}/g) ?? [];
    const conhecidos = REMINDER_VARIABLES.map((v) => v.token);
    for (const token of tokens) expect(conhecidos).toContain(token);
  });
});

describe("Lembretes de uma consulta (override)", () => {
  const doAgente = [{ minutesBefore: UM_DIA, template: "do agente" }];

  it("sem override, a consulta segue o agente", () => {
    const regras = remindersFor({ reminderOverride: null }, {
      reminderEnabled: true,
      reminders: doAgente,
    });
    expect(regras).toEqual(doAgente);
  });

  it("lista vazia é uma escolha: esta consulta não recebe nada", () => {
    // O ponto central do override. Se `[]` fosse tratado como "não
    // configurado", a consulta que a clínica marcou para NÃO lembrar
    // receberia os lembretes do agente assim mesmo.
    const regras = remindersFor({ reminderOverride: [] }, {
      reminderEnabled: true,
      reminders: doAgente,
    });
    expect(regras).toEqual([]);
  });

  it("override com lista substitui o padrão do agente", () => {
    const regras = remindersFor(
      { reminderOverride: [{ minutesBefore: 120, template: "só desta" }] },
      { reminderEnabled: true, reminders: doAgente },
    );
    expect(regras).toEqual([{ minutesBefore: 120, template: "só desta" }]);
  });

  it("com o lembrete desligado no agente, sem override não manda nada", () => {
    const regras = remindersFor({ reminderOverride: null }, {
      reminderEnabled: false,
      reminders: doAgente,
    });
    expect(regras).toEqual([]);
  });

  it("override vale mesmo com o lembrete desligado no agente", () => {
    // Desligar o padrão não pode apagar a escolha feita para uma consulta
    // específica: são duas decisões diferentes.
    const regras = remindersFor(
      { reminderOverride: [{ minutesBefore: 60, template: "esta sim" }] },
      { reminderEnabled: false, reminders: doAgente },
    );
    expect(regras).toEqual([{ minutesBefore: 60, template: "esta sim" }]);
  });

  it("override corrompido não derruba a varredura — vira 'segue o agente'", () => {
    expect(parseReminderOverride("lixo")).toBeNull();
    expect(parseReminderOverride(undefined)).toBeNull();
    expect(parseReminderOverride([{ minutesBefore: "amanhã" }])).toEqual([]);
  });

  it("serializar null limpa o override", () => {
    expect(serializeReminderOverride(null)).toBeNull();
    expect(serializeReminderOverride([])).toEqual([]);
  });

  it("preserva o horário fixo no lembrete próprio da consulta", () => {
    const rules = [{ minutesBefore: UM_DIA, sendTime: "08:30", template: "Confirme" }];
    expect(parseReminderOverride(serializeReminderOverride(rules))).toEqual(rules);
  });
});

describe("Quais disparos estão vencidos (dueReminders)", () => {
  it("envia um dia antes às 08:30 no fuso da agenda, qualquer que seja a hora da consulta", () => {
    const rule = { minutesBefore: UM_DIA, sendTime: "08:30", template: "Confirme sua consulta" };
    const startsAt = new Date("2026-09-23T18:00:00.000Z"); // 15h em São Paulo
    expect(reminderDueAt(startsAt, rule, "America/Sao_Paulo").toISOString())
      .toBe("2026-09-22T11:30:00.000Z");
    const appt = { status: "scheduled", startsAt, remindersSent: [] };
    expect(dueReminders(appt, [rule], new Date("2026-09-22T11:29:00.000Z"))).toEqual([]);
    expect(dueReminders(appt, [rule], new Date("2026-09-22T11:30:00.000Z"))).toEqual([rule]);
  });

  it("calcula o dia anterior no calendário local mesmo na virada de mês", () => {
    const rule = { minutesBefore: UM_DIA, sendTime: "08:30", template: "Confirme" };
    const startsAt = new Date("2026-10-01T02:00:00.000Z"); // 30/09 às 23h em São Paulo
    expect(reminderDueAt(startsAt, rule, "America/Sao_Paulo").toISOString())
      .toBe("2026-09-29T11:30:00.000Z");
  });

  const regras = [
    { minutesBefore: UMA_SEMANA, template: "semana" },
    { minutesBefore: UM_DIA, template: "dia" },
    { minutesBefore: 120, template: "duas horas" },
  ];
  const consulta = (startsAt: string, over: Partial<{ status: string; remindersSent: number[] }> = {}) => ({
    status: over.status ?? "scheduled",
    startsAt: new Date(startsAt),
    remindersSent: over.remindersSent ?? [],
  });

  it("dispara só os que já entraram na janela", () => {
    // Consulta daqui a 20h: a de 1 semana expirou, a de 1 dia vale hoje, a de 2h não venceu.
    const due = dueReminders(consulta("2026-09-17T08:00:00.000Z"), regras, AGORA);
    expect(due.map((r) => r.minutesBefore)).toEqual([UM_DIA]);
  });

  it("não repete um disparo já enviado", () => {
    // O ponto da lista em vez do booleano: o de 1 semana já saiu, o de 1 dia
    // ainda precisa sair.
    const due = dueReminders(
      consulta("2026-09-17T08:00:00.000Z", { remindersSent: [UMA_SEMANA] }),
      regras,
      AGORA,
    );
    expect(due.map((r) => r.minutesBefore)).toEqual([UM_DIA]);
  });

  it("não recupera o de uma semana três dias antes nem antecipa os seguintes", () => {
    const due = dueReminders(consulta("2026-09-19T12:00:00.000Z"), regras, AGORA);
    expect(due).toEqual([]);
  });

  it.each([undefined, "08:30"])("confirmação da véspera expira à meia-noite local (horário fixo: %s)", (sendTime) => {
    const startsAt = new Date("2026-09-17T18:00:00Z");
    const rule = { minutesBefore: UM_DIA, template: "É amanhã", ...(sendTime ? { sendTime } : {}) };
    const appt = { status: "scheduled", startsAt, remindersSent: [] };
    const before = new Date("2026-09-17T02:59:59Z"); // 23:59:59 da véspera
    const midnight = new Date("2026-09-17T03:00:00Z"); // 00:00 da consulta
    expect(dueReminders(appt, [rule], before)).toEqual([rule]);
    expect(staleReminders(appt, [rule], before)).toEqual([]);
    expect(dueReminders(appt, [rule], midnight)).toEqual([]);
    expect(staleReminders(appt, [rule], midnight)).toEqual([rule]);
  });

  it("usa o fuso da clínica na virada do mês, sem confundir o dia UTC", () => {
    const appt = consulta("2026-10-01T02:00:00Z"); // 30/09, 21h em Rio Branco
    const now = new Date("2026-09-30T04:30:00Z"); // ainda 29/09, 23h30
    expect(dueReminders(appt, [regras[1]], now, "America/Rio_Branco")).toEqual([regras[1]]);
    expect(dueReminders(appt, [regras[1]], now, "America/Sao_Paulo")).toEqual([]);
    expect(staleReminders(appt, [regras[1]], now, "America/Rio_Branco")).toEqual([]);
    expect(staleReminders(appt, [regras[1]], now, "America/Sao_Paulo")).toEqual([regras[1]]);
  });

  it("preserva o lembrete de duas horas no dia da consulta e dispensa os antigos", () => {
    const appt = consulta("2026-09-16T14:00:00Z");
    expect(dueReminders(appt, regras, AGORA)).toEqual([regras[2]]);
    expect(staleReminders(appt, regras, AGORA)).toEqual([regras[0], regras[1]]);
  });

  it("não lembra de consulta que já passou", () => {
    expect(dueReminders(consulta("2026-09-16T09:00:00.000Z"), regras, AGORA)).toEqual([]);
  });

  it("ignora consulta cancelada ou já realizada", () => {
    const amanha = "2026-09-17T08:00:00.000Z";
    expect(dueReminders(consulta(amanha, { status: "canceled" }), regras, AGORA)).toEqual([]);
    expect(dueReminders(consulta(amanha, { status: "done" }), regras, AGORA)).toEqual([]);
  });

  it("consulta passada tem seus disparos pendentes fechados (staleReminders)", () => {
    const pendentes = staleReminders(
      consulta("2026-09-16T09:00:00.000Z", { remindersSent: [UMA_SEMANA] }),
      regras,
      AGORA,
    );
    expect(pendentes.map((r) => r.minutesBefore)).toEqual([UM_DIA, 120]);
  });

  it("consulta futura fecha só o lembrete cujo dia já passou", () => {
    expect(staleReminders(consulta("2026-09-17T08:00:00.000Z"), regras, AGORA)).toEqual([regras[0]]);
  });
});

describe("Varredura (scanAndSendReminders)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.appointment.findFirst.mockImplementation(async (args: { where: { id: string } }) => (await db.appointment.findMany({ where: {} })).find((a: { id: string }) => a.id === args.where.id) ?? null);
    db.appointment.update.mockResolvedValue({});
    db.message.create.mockResolvedValue({});
    provider.isConfigured.mockReturnValue(true);
    provider.sendMessage.mockResolvedValue("wamid-1");
    db.whatsappInstance.findMany.mockResolvedValue([{ externalId: "inst-1", status: "connected" }]);
    db.whatsappBlockedNumber.findUnique.mockResolvedValue(null);
  });

  function acaoConfigurada(over: { enabled?: boolean; reminderEnabled?: boolean; reminders?: unknown; reminderAudience?: string; reminderTypes?: string[] } = {}) {
    // `AGENTE` é o principal da conta — o que atende o WhatsApp.
    db.agent.findMany.mockResolvedValue([{ id: AGENTE, tenantId: CONTA }]);
    db.tenantAction.findMany.mockResolvedValue(
      (over.enabled ?? true)
        ? [{
            tenantId: CONTA,
            agentId: AGENTE,
            config: {
              reminderEnabled: over.reminderEnabled ?? true,
              reminderAudience: over.reminderAudience ?? "all",
              reminderTypes: over.reminderTypes ?? [],
              reminders: over.reminders ?? [
                { minutesBefore: UMA_SEMANA, template: "Falta uma semana, {{nome}}." },
                { minutesBefore: UM_DIA, template: "É amanhã, {{nome}}, às {{hora}}." },
              ],
              timezone: "America/Sao_Paulo",
            },
          }]
        : [],
    );
  }

  /**
   * O worker faz duas buscas: as consultas que vêm aí e as que já passaram
   * com disparo pendente. O mock responde pela forma do `where` em vez da
   * ordem das chamadas — assim o teste não quebra se as duas trocarem de
   * lugar no código.
   */
  function consultas(rows: unknown[], overdue: unknown[] = []) {
    db.appointment.findMany.mockImplementation((args: { where?: { startsAt?: { lt?: Date } } }) =>
      Promise.resolve(args?.where?.startsAt && "lt" in args.where.startsAt ? overdue : rows),
    );
  }

  const consultaAmanha = (over: Partial<{ remindersSent: number[]; reminderOverride: unknown }> = {}) => ({
    id: "appt-1",
    tenantId: "tenant-1",
    agentId: AGENTE,
    conversationId: "conv-1",
    status: "scheduled",
    startsAt: new Date("2026-09-17T08:00:00.000Z"),
    remindersSent: over.remindersSent ?? [],
    reminderOverride: over.reminderOverride ?? null,
    lead: { phone: "5511999990000", name: "Maria", isTest: false },
  });

  it.each(["Ortodontia", "Reavaliação", null])("lembrete próprio não contorna o público da conta: %s", async (serviceType) => {
    acaoConfigurada({ reminderAudience: "selected_types", reminderTypes: ["Avaliação"] });
    consultas([{ ...consultaAmanha({ reminderOverride: [{ minutesBefore: UM_DIA, template: "Confirme." }] }), serviceType }]);
    expect(await scanAndSendReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it("envia avaliação local e exclui as outras consultas da mesma conta", async () => {
    acaoConfigurada({ reminderAudience: "selected_types", reminderTypes: ["Avaliação"] });
    consultas([
      { ...consultaAmanha(), serviceType: "avaliacao" },
      { ...consultaAmanha(), id: "outra", serviceType: "Cirurgia" },
      { ...consultaAmanha(), id: "sem-tipo", serviceType: null },
    ]);
    expect(await scanAndSendReminders(AGORA)).toMatchObject({ sent: 1 });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("envia o disparo válido de hoje e fecha o da semana que perdeu o dia", async () => {
    acaoConfigurada();
    consultas([consultaAmanha()]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(1);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const [, , texto] = provider.sendMessage.mock.calls[0];
    expect(texto).toContain("É amanhã");
    expect(texto).not.toContain("uma semana");
    // Os dois ficam marcados: o que saiu e o que perdeu a hora.
    expect(db.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remindersSent: { set: [UMA_SEMANA, UM_DIA] } }),
      }),
    );
  });

  it.each(["marcada hoje", "remarcada para hoje", "worker voltou hoje"])("%s: dispensa a confirmação da véspera sem envio", async (scenario) => {
    acaoConfigurada({ reminders: [{ minutesBefore: UM_DIA, template: "É amanhã às {{hora}}." }] });
    consultas([{
      ...consultaAmanha(), startsAt: new Date("2026-09-16T18:00:00Z"),
      createdAt: scenario === "marcada hoje" ? AGORA : new Date("2026-09-10T12:00:00Z"),
      rescheduledAt: scenario === "remarcada para hoje" ? AGORA : null,
    }]);
    expect(await scanAndSendReminders(AGORA)).toMatchObject({ sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" }, data: { remindersSent: { set: [UM_DIA] } },
    });
  });

  it("envio manual não recupera o modelo da véspera no dia da consulta", async () => {
    acaoConfigurada({ reminders: [{ minutesBefore: UM_DIA, template: "É amanhã." }] });
    consultas([{ ...consultaAmanha(), startsAt: new Date("2026-09-16T18:00:00Z") }]);
    expect(await scanAndSendReminders(AGORA, { tenantId: CONTA, id: "appt-1", operation: "send", userId: "u" }))
      .toMatchObject({ sent: 0, reason: "outside_window" });
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("a equipe ainda pode registrar uma confirmação feita por fora no próprio dia", async () => {
    acaoConfigurada({ reminders: [{ minutesBefore: UM_DIA, template: "É amanhã." }] });
    consultas([{ ...consultaAmanha(), startsAt: new Date("2026-09-16T18:00:00Z") }]);
    expect(await scanAndSendReminders(AGORA, { tenantId: CONTA, id: "appt-1", operation: "manual", userId: "u" }))
      .toMatchObject({ sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" }, data: { remindersSent: { set: [UM_DIA] } },
    });
  });

  it("envio manual não antecipa um modelo de amanhã para dois dias antes", async () => {
    acaoConfigurada({ reminders: [{ minutesBefore: UM_DIA, template: "É amanhã." }] });
    consultas([{ ...consultaAmanha(), startsAt: new Date("2026-09-18T18:00:00Z") }]);
    expect(await scanAndSendReminders(AGORA, { tenantId: CONTA, id: "appt-1", operation: "send", userId: "u" }))
      .toMatchObject({ sent: 0, reason: "outside_window" });
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("envio manual pode antecipar o horário dentro da própria véspera", async () => {
    acaoConfigurada({ reminders: [{ minutesBefore: UM_DIA, sendTime: "16:00", template: "É amanhã." }] });
    consultas([consultaAmanha()]);
    expect(await scanAndSendReminders(AGORA, { tenantId: CONTA, id: "appt-1", operation: "send", userId: "u" }))
      .toMatchObject({ sent: 1 });
    expect(provider.sendMessage).toHaveBeenCalledOnce();
  });

  it("lembrete próprio de duas horas continua saindo hoje sem enviar o da véspera", async () => {
    acaoConfigurada();
    consultas([{
      ...consultaAmanha({ reminderOverride: [
        { minutesBefore: UM_DIA, template: "É amanhã." },
        { minutesBefore: 120, template: "Sua consulta é hoje às {{hora}}." },
      ] }), startsAt: new Date("2026-09-16T14:00:00Z"),
    }]);
    expect(await scanAndSendReminders(AGORA)).toMatchObject({ sent: 1 });
    expect(provider.sendMessage).toHaveBeenCalledWith("inst-1", "5511999990000", "Sua consulta é hoje às 11:00.");
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" }, data: { remindersSent: { set: [UM_DIA, 120] }, reminderSentAt: AGORA },
    });
  });

  it("inclui consulta noturna na busca e envia às 08:30 da véspera", async () => {
    acaoConfigurada({ reminders: [{ minutesBefore: UM_DIA, sendTime: "08:30", template: "Confirme, {{nome}}." }] });
    const now = new Date("2026-09-22T11:30:00.000Z");
    consultas([{ ...consultaAmanha(), startsAt: new Date("2026-09-24T02:00:00.000Z") }]);

    const result = await scanAndSendReminders(now);

    expect(result.sent).toBe(1);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const query = db.appointment.findMany.mock.calls[0][0];
    expect(query.where.OR[0].startsAt.lte.getTime() - now.getTime()).toBe(2 * UM_DIA * 60_000);
  });

  it("um disparo enviado não cala os seguintes", async () => {
    // O motivo de `remindersSent` ser lista e não booleano.
    acaoConfigurada();
    consultas([consultaAmanha({ remindersSent: [UMA_SEMANA] })]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(1);
    const [, , texto] = provider.sendMessage.mock.calls[0];
    expect(texto).toContain("É amanhã");
  });

  it("não reenvia o que já saiu", async () => {
    acaoConfigurada();
    consultas([consultaAmanha({ remindersSent: [UMA_SEMANA, UM_DIA] })]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("lembra consulta à meia-noite às 23h da véspera", () => {
    const rule = { minutesBefore: UM_DIA, sendTime: "23:00", template: "Confirme" };
    const startsAt = new Date("2026-09-24T03:00:00.000Z");
    expect(reminderDueAt(startsAt, rule, "America/Sao_Paulo").toISOString())
      .toBe("2026-09-24T02:00:00.000Z");
    const appt = { status: "scheduled", startsAt, remindersSent: [] };
    expect(dueReminders(appt, [rule], new Date("2026-09-24T02:02:00.000Z"))).toEqual([rule]);
    expect(dueReminders(appt, [rule], startsAt)).toEqual([]);
  });

  it("fecha lembretes de número bloqueado sem enviar nem registrar mensagem", async () => {
    acaoConfigurada();
    consultas([consultaAmanha()]);
    db.whatsappBlockedNumber.findUnique.mockResolvedValue({ id: "bloqueio-1" });

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(db.whatsappBlockedNumber.findUnique).toHaveBeenCalledWith({
      where: { tenantId_phone: { tenantId: "tenant-1", phone: "1199990000" } },
      select: { id: true },
    });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" },
      data: { remindersSent: { set: [UMA_SEMANA, UM_DIA] } },
    });
  });

  it("respeita os lembretes próprios da consulta", async () => {
    acaoConfigurada();
    consultas([consultaAmanha({
      reminderOverride: [{ minutesBefore: UM_DIA, template: "Texto só desta consulta." }],
    })]);

    await scanAndSendReminders(AGORA);

    const [, , texto] = provider.sendMessage.mock.calls[0];
    expect(texto).toBe("Texto só desta consulta.");
  });

  it("consulta marcada para não lembrar não recebe nada", async () => {
    acaoConfigurada();
    consultas([consultaAmanha({ reminderOverride: [] })]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("grava a mensagem na conversa, para a resposta do paciente ter contexto", async () => {
    acaoConfigurada();
    consultas([consultaAmanha()]);

    await scanAndSendReminders(AGORA);

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ conversationId: "conv-1", role: "assistant" }),
      }),
    );
  });

  it("não manda nada com a ação de agendamento desligada", async () => {
    acaoConfigurada({ enabled: false });
    consultas([consultaAmanha()]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });

  it("não manda nada com a ação ligada mas o lembrete desligado", async () => {
    acaoConfigurada({ reminderEnabled: false });
    consultas([consultaAmanha()]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  // O bug: a consulta seguia a config do `agentId` gravado nela, e a agenda
  // mostrava a do principal. Só disparava depois de salvar lembretes próprios.
  it("consulta de outro agente (ou sem agente) segue os lembretes gerais da conta", async () => {
    acaoConfigurada();
    consultas([
      { ...consultaAmanha(), id: "appt-agente-antigo", agentId: "agente-antigo" },
      { ...consultaAmanha(), id: "appt-sem-agente", agentId: null },
    ]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(2);
    expect(db.appointment.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: { in: [CONTA] } }),
      }),
    );
  });

  it("lembrete configurado em agente que não atende o WhatsApp não vale", async () => {
    // A agenda mostra a config do principal; um secundário com lembrete
    // ligado não pode mandar o que a tela não mostra.
    db.agent.findMany.mockResolvedValue([
      { id: "agente-principal", tenantId: CONTA },
      { id: AGENTE, tenantId: CONTA },
    ]);
    db.tenantAction.findMany.mockResolvedValue([{
      tenantId: CONTA,
      agentId: AGENTE,
      config: { reminderEnabled: true, reminders: [{ minutesBefore: UM_DIA, template: "Oi" }] },
    }]);
    consultas([consultaAmanha()]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });

  it("a busca no banco exclui conversa de teste e consulta já passada", async () => {
    acaoConfigurada();
    consultas([]);

    await scanAndSendReminders(AGORA);

    expect(db.appointment.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          lead: { isTest: false },
          status: "scheduled",
          startsAt: { gte: AGORA },
        }),
      }),
    );
  });

  it("fecha sem enviar os disparos de uma consulta que já passou", async () => {
    // Worker parado: a consulta passou com lembrete pendente. Marcar evita
    // reavaliá-la para sempre; `reminderSentAt` NÃO é gravado, senão a tela
    // diria "lembrete enviado" sobre algo que nunca saiu.
    acaoConfigurada();
    consultas([], [{
      id: "appt-velha",
      tenantId: CONTA,
      agentId: AGENTE,
      status: "scheduled",
      startsAt: new Date("2026-09-16T09:00:00.000Z"),
      remindersSent: [],
      reminderOverride: null,
    }]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(provider.sendMessage).not.toHaveBeenCalled();
    const call = db.appointment.update.mock.calls.find(
      ([arg]) => arg.where.id === "appt-velha",
    );
    expect(call?.[0].data.remindersSent).toEqual({ set: [UMA_SEMANA, UM_DIA] });
    expect(call?.[0].data.reminderSentAt).toBeUndefined();
  });

  it("WhatsApp desconectado não consome o lembrete: tenta novamente antes da consulta", async () => {
    acaoConfigurada();
    consultas([consultaAmanha()]);
    db.whatsappInstance.findMany.mockResolvedValue([{ externalId: "inst-1", status: "disconnected" }]);

    const r = await scanAndSendReminders(AGORA);

    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it("falha temporária no envio não registra mensagem nem consome o lembrete", async () => {
    acaoConfigurada();
    consultas([consultaAmanha()]);
    provider.sendMessage.mockRejectedValue(new Error("WhatsApp indisponível"));

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
});

describe("Lembretes com as duas conexões (QR e Meta)", () => {
  const QR = { provider: "evolution", externalId: "inst-qr", status: "connected" };
  const META = { provider: "meta", externalId: "phone-meta", status: "connected" };

  beforeEach(() => {
    vi.clearAllMocks();
    db.appointment.findFirst.mockImplementation(async (args: { where: { id: string } }) => (await db.appointment.findMany({ where: {} })).find((a: { id: string }) => a.id === args.where.id) ?? null);
    db.appointment.update.mockResolvedValue({});
    db.message.create.mockResolvedValue({});
    db.whatsappBlockedNumber.findUnique.mockResolvedValue(null);
    provider.isConfigured.mockReturnValue(true);
    provider.sendMessage.mockResolvedValue("wamid-1");
    db.agent.findMany.mockResolvedValue([{ id: AGENTE, tenantId: CONTA }]);
    db.tenantAction.findMany.mockResolvedValue([{
      tenantId: CONTA,
      agentId: AGENTE,
      config: {
        reminderEnabled: true,
        reminderAudience: "all",
        reminderTypes: [],
        reminders: [{ minutesBefore: UM_DIA, template: "É amanhã, {{nome}}." }],
        timezone: "America/Sao_Paulo",
      },
    }]);
  });

  function consulta(conversation: unknown, leadConversation: unknown = null) {
    db.appointment.findMany.mockImplementation((args: { where?: { startsAt?: { lt?: Date } } }) =>
      Promise.resolve(
        args?.where?.startsAt && "lt" in args.where.startsAt
          ? []
          : [{
              id: "appt-1",
              tenantId: CONTA,
              agentId: AGENTE,
              conversationId: conversation ? "conv-1" : null,
              status: "scheduled",
              startsAt: new Date("2026-09-17T08:00:00.000Z"),
              remindersSent: [],
              reminderOverride: null,
              conversation,
              lead: { phone: "5511999990000", name: "Maria", isTest: false, conversation: leadConversation },
            }],
      ),
    );
  }

  it("o paciente que escreve pela Meta recebe o lembrete pela Meta, com o QR também de pé", async () => {
    consulta({ variables: {}, whatsappProvider: "meta" });
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(1);
    expect(provider.sendMessage).toHaveBeenCalledWith("phone-meta", "5511999990000", expect.any(String));
  });

  it("consulta marcada à mão (sem conversationId) usa o canal da conversa do lead", async () => {
    consulta(null, { whatsappProvider: "meta" });
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);

    await scanAndSendReminders(AGORA);

    expect(provider.sendMessage).toHaveBeenCalledWith("phone-meta", "5511999990000", expect.any(String));
  });

  it("paciente do QR recebe pelo QR", async () => {
    consulta({ variables: {}, whatsappProvider: "evolution" });
    db.whatsappInstance.findMany.mockResolvedValue([META, QR]);

    await scanAndSendReminders(AGORA);

    expect(provider.sendMessage).toHaveBeenCalledWith("inst-qr", "5511999990000", expect.any(String));
  });

  it("o número do paciente fora do ar espera: não usa o outro e não consome o disparo", async () => {
    consulta({ variables: {}, whatsappProvider: "meta" });
    db.whatsappInstance.findMany.mockResolvedValue([QR, { ...META, status: "disconnected" }]);

    const r = await scanAndSendReminders(AGORA);

    expect(r.sent).toBe(0);
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.appointment.update).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });
});
