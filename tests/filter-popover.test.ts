import { describe, expect, it } from "vitest";
import { dayOf, emptyFilters, inPeriod, periodLabel } from "@/components/ui/filter-popover";

describe("filtro padrão", () => {
  it("monta os valores vazios a partir dos campos", () => {
    expect(
      emptyFilters([
        { type: "select", key: "status", label: "Situação", options: [] },
        { type: "period", from: "de", to: "ate", label: "Período" },
      ]),
    ).toEqual({ status: "", de: "", ate: "" });
  });

  it("período inclui as pontas; sem data fica de fora só quando há período", () => {
    expect(inPeriod("2026-11-09", "2026-11-01", "2026-11-09")).toBe(true);
    expect(inPeriod("2026-10-31", "2026-11-01", "")).toBe(false);
    expect(inPeriod(null, "", "")).toBe(true);
    expect(inPeriod(null, "2026-11-01", "")).toBe(false);
  });

  it("dia em Brasília e rótulo do período", () => {
    expect(dayOf("2026-11-10T02:00:00.000Z")).toBe("2026-11-09");
    expect(periodLabel("2026-10-01", "2026-10-15")).toBe("01/10/2026 a 15/10/2026");
    expect(periodLabel("2026-10-01", "")).toBe("desde 01/10/2026");
  });
});
