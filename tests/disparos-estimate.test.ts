import { describe, expect, it } from "vitest";
import { dayLabel, durationLabel, estimateBroadcast } from "@/modules/broadcasts/estimate";

const base = { today: "2026-11-09", nowTime: "10:00", windowStart: "09:00", windowEnd: "18:00" };

describe("tempo estimado do disparo", () => {
  it("agora, dentro da faixa: começa já e termina no mesmo dia", () => {
    const e = estimateBroadcast({ ...base, total: 24 })!;
    expect(e).toMatchObject({ startDay: "2026-11-09", startTime: "10:00", endTime: "10:01", days: 1, delayed: false });
  });

  it("agendado às 08:30 com faixa das 9h: avisa que só começa às 09:00", () => {
    const e = estimateBroadcast({ ...base, total: 24, scheduled: { date: "2026-11-10", time: "08:30" } })!;
    expect(e).toMatchObject({ startDay: "2026-11-10", startTime: "09:00", delayed: true });
  });

  it("agendado dentro da faixa não é atrasado", () => {
    const e = estimateBroadcast({
      ...base,
      windowStart: "08:00",
      total: 24,
      scheduled: { date: "2026-11-10", time: "08:30" },
    })!;
    expect(e).toMatchObject({ startTime: "08:30", delayed: false });
  });

  it("o que não cabe no dia continua no seguinte", () => {
    const e = estimateBroadcast({ ...base, nowTime: "17:50", total: 1000 })!;
    expect(e.sendingMinutes).toBe(17);
    expect(e).toMatchObject({ endDay: "2026-11-10", endTime: "09:07", days: 2 });
  });

  it("depois do fim da faixa começa no dia seguinte", () => {
    const e = estimateBroadcast({ ...base, nowTime: "19:00", total: 10 })!;
    expect(e).toMatchObject({ startDay: "2026-11-10", startTime: "09:00" });
  });

  it("faixa inválida não estima", () => {
    expect(estimateBroadcast({ ...base, windowStart: "18:00", windowEnd: "09:00", total: 1 })).toBeNull();
  });

  it("rótulos", () => {
    expect(durationLabel(1)).toBe("cerca de 1 minuto");
    expect(durationLabel(100)).toBe("cerca de 1 h 40 min");
    expect(dayLabel("2026-11-10", "2026-11-09")).toBe("amanhã");
    expect(dayLabel("2026-11-12", "2026-11-09")).toBe("12/11");
  });
});
