import { describe, expect, it } from "vitest";
import { crmSlaLabel, crmSlaLevel, crmWaitMinutes } from "@/modules/crm/sla";

const entered = "2026-11-24T12:00:00.000Z";
const at = (minutes: number) => Date.parse(entered) + minutes * 60_000;

describe("selo de espera em Aguardando humano", () => {
  it.each([
    [0, "ok"], [14, "ok"], [15, "alert"], [59, "alert"], [60, "late"], [600, "late"],
  ] as const)("aos %i min é %s", (minutes, level) => {
    expect(crmSlaLevel(crmWaitMinutes(entered, at(minutes)))).toBe(level);
  });

  it("sem registro de entrada não presume prazo", () => {
    expect(crmWaitMinutes(null, at(30))).toBeNull();
    expect(crmWaitMinutes("data-invalida", at(30))).toBeNull();
    expect(crmSlaLevel(null)).toBe("unknown");
    expect(crmSlaLabel(null)).toBe("Espera sem registro");
  });

  it("relógio adiantado no servidor não gera espera negativa", () => {
    expect(crmWaitMinutes(entered, at(-5))).toBe(0);
  });

  it("o texto diz a situação e o tempo, não só a cor", () => {
    expect(crmSlaLabel(0)).toBe("No prazo · aguardando há menos de 1 min");
    expect(crmSlaLabel(23)).toBe("Atenção · aguardando há 23 min");
    expect(crmSlaLabel(95)).toBe("Atrasado · aguardando há 1 h 35 min");
    expect(crmSlaLabel(120)).toBe("Atrasado · aguardando há 2 h");
    expect(crmSlaLabel(3000)).toBe("Atrasado · aguardando há 2 d");
  });
});
