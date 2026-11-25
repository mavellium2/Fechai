import { describe, expect, it } from "vitest";
import { businessMinutesBetween, parseHandoffSla, slaMinutes, type BusinessCalendar } from "@/modules/crm/handoff-sla";
import { crmSlaLabel, crmSlaLevel } from "@/modules/crm/sla";

/** CRM-10: o relógio do prazo do transbordo (puro, sem banco). */

const TZ = "America/Sao_Paulo"; // UTC-3, sem horário de verão
const weekday = [{ start: 8 * 60, end: 12 * 60 }, { start: 13 * 60, end: 18 * 60 }];
const calendar: BusinessCalendar = {
  timezone: TZ,
  // Domingo = 0. Segunda a sexta, 8h–12h e 13h–18h; sábado e domingo fechado.
  week: [[], weekday, weekday, weekday, weekday, weekday, []],
  blocked: new Set(["2026-12-25"]),
};
const at = (iso: string) => new Date(iso);

describe("minutos dentro do expediente", () => {
  it("conta só o horário aberto, pulando o almoço", () => {
    // Quarta, 11h50 → 13h10 (horário de Brasília): 10 min de manhã + 10 min à tarde.
    expect(businessMinutesBetween(at("2026-11-25T14:50:00Z"), at("2026-11-25T16:10:00Z"), calendar)).toBe(20);
  });

  it("noite e fim de semana não contam", () => {
    // Sexta 17h50 → segunda 8h10: 10 min na sexta + 10 min na segunda.
    expect(businessMinutesBetween(at("2026-11-27T20:50:00Z"), at("2026-11-30T11:10:00Z"), calendar)).toBe(20);
    // Transbordo às 22h: às 8h15 do dia seguinte são 15 min de prazo.
    expect(businessMinutesBetween(at("2026-11-26T01:00:00Z"), at("2026-11-26T11:15:00Z"), calendar)).toBe(15);
    // Sábado inteiro: zero.
    expect(businessMinutesBetween(at("2026-11-28T11:00:00Z"), at("2026-11-28T20:00:00Z"), calendar)).toBe(0);
  });

  it("dia bloqueado (feriado) não conta", () => {
    // 25/12/2026 é sexta: bloqueado.
    expect(businessMinutesBetween(at("2026-12-25T11:00:00Z"), at("2026-12-25T20:00:00Z"), calendar)).toBe(0);
  });

  it("sem expediente cadastrado, ou com a opção desligada, conta o tempo corrido", () => {
    const from = at("2026-11-28T11:00:00Z");
    const now = at("2026-11-28T12:30:00Z");
    expect(slaMinutes(from, now, parseHandoffSla(null), null)).toBe(90);
    expect(slaMinutes(from, now, parseHandoffSla({ businessHoursOnly: false }), calendar)).toBe(90);
    expect(slaMinutes(from, now, parseHandoffSla(null), calendar)).toBe(0);
  });
});

describe("configuração dos prazos", () => {
  it("sem linha valem os padrões: 15 e 60 min, só no expediente, e-mail ligado", () => {
    expect(parseHandoffSla(null)).toEqual({ alertMinutes: 15, escalateMinutes: 60, businessHoursOnly: true, escalateByEmail: true });
  });

  it("valor estranho cai no padrão e o escalonamento sempre vem depois do alerta", () => {
    expect(parseHandoffSla({ alertMinutes: -3, escalateMinutes: 0 })).toMatchObject({ alertMinutes: 15, escalateMinutes: 60 });
    expect(parseHandoffSla({ alertMinutes: 90, escalateMinutes: 30 })).toMatchObject({ alertMinutes: 90, escalateMinutes: 91 });
    expect(parseHandoffSla({ alertMinutes: 10, escalateMinutes: 20 })).toMatchObject({ alertMinutes: 10, escalateMinutes: 20 });
  });

  it("o selo do quadro segue os prazos da conta, com o tempo escrito (não só a cor)", () => {
    const limits = { alertMinutes: 10, escalateMinutes: 20 };
    expect(crmSlaLevel(9, limits)).toBe("ok");
    expect(crmSlaLevel(10, limits)).toBe("alert");
    expect(crmSlaLevel(20, limits)).toBe("late");
    expect(crmSlaLabel(25, limits)).toBe("Atrasado · aguardando há 25 min");
    // Sem a conta, continuam os padrões do CRM-03.
    expect(crmSlaLevel(14)).toBe("ok");
    expect(crmSlaLevel(15)).toBe("alert");
  });
});
