import { describe, expect, it } from "vitest";
import type { IcloudAgendaItem } from "@/modules/scheduling/icloud";
import { icloudDayKeys, placeIcloudItems } from "@/modules/scheduling/icloud-agenda-view";

const TZ = "America/Sao_Paulo";
const item = (uid: string, start: string, extra: Partial<IcloudAgendaItem> = {}): IcloudAgendaItem => ({
  uid, startsAt: new Date(start), endsAt: new Date(new Date(start).getTime() + 3_600_000), allDay: false,
  title: "Evento", calendarName: "Pessoal", free: false, ...extra,
});
const row = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id, status: "scheduled", startsAt: new Date(start), endsAt: new Date(new Date(start).getTime() + 3_600_000), ...extra,
});

describe("dias de um evento do iPhone", () => {
  it("evento com hora entra no dia local em que começa", () => {
    // 02:00Z de 13/08 ainda é 23:00 de 12/08 em Brasília
    expect(icloudDayKeys(item("a", "2026-08-13T02:00:00Z"), TZ)).toEqual(["2026-08-12"]);
  });

  it("dia inteiro de vários dias entra em cada dia que cobre (fim exclusivo)", () => {
    const vacation = item("f", "2026-08-12T03:00:00Z", { allDay: true, endsAt: new Date("2026-08-15T03:00:00Z") });
    expect(icloudDayKeys(vacation, TZ)).toEqual(["2026-08-12", "2026-08-13", "2026-08-14"]);
  });
});

describe("eventos do iPhone na lista do dia", () => {
  it("evento de fora aparece no seu dia", () => {
    const { byDay } = placeIcloudItems([item("x", "2026-08-12T17:00:00Z")], new Set(), [], TZ);
    expect(byDay.get("2026-08-12")?.map((i) => i.uid)).toEqual(["x"]);
  });

  it("o evento que o fechai enviou não repete quando a consulta está no mês", () => {
    const rows = [row("abc", "2026-08-12T17:00:00Z")];
    const { byDay, movedOnPhone } = placeIcloudItems([item("fechai-abc@fechai", "2026-08-12T17:00:00Z")], new Set(["abc"]), rows, TZ);
    expect(byDay.size).toBe(0);
    expect(movedOnPhone.size).toBe(0);
  });

  it("também não repete quando a consulta foi remarcada para outro mês (histórico do mês)", () => {
    const { byDay } = placeIcloudItems([item("fechai-abc@fechai", "2026-08-12T17:00:00Z")], new Set(["abc"]), [], TZ);
    expect(byDay.size).toBe(0);
  });

  it("UID do fechai sem consulta correspondente aparece normal", () => {
    const { byDay } = placeIcloudItems([item("fechai-orfao@fechai", "2026-08-12T17:00:00Z")], new Set(["abc"]), [], TZ);
    expect(byDay.get("2026-08-12")).toHaveLength(1);
  });

  it("evento do fechai em outro horário no iPhone: aviso com o horário de lá, sem mexer na consulta", () => {
    const rows = [row("abc", "2026-08-12T17:00:00Z")];
    const { byDay, movedOnPhone } = placeIcloudItems([item("fechai-abc@fechai", "2026-08-12T19:00:00Z")], new Set(["abc"]), rows, TZ);
    expect(byDay.size).toBe(0);
    expect(movedOnPhone.get("abc")?.toISOString()).toBe("2026-08-12T19:00:00.000Z");
    expect(rows[0].startsAt.toISOString()).toBe("2026-08-12T17:00:00.000Z");
  });

  it("só o fim diferente também é alteração", () => {
    const rows = [row("abc", "2026-08-12T17:00:00Z")];
    const moved = item("fechai-abc@fechai", "2026-08-12T17:00:00Z", { endsAt: new Date("2026-08-12T19:00:00Z") });
    expect(placeIcloudItems([moved], new Set(["abc"]), rows, TZ).movedOnPhone.has("abc")).toBe(true);
  });

  it("consulta cancelada não gera aviso; evento igual não gera aviso", () => {
    const canceled = [row("abc", "2026-08-12T17:00:00Z", { status: "canceled" })];
    expect(placeIcloudItems([item("fechai-abc@fechai", "2026-08-12T19:00:00Z")], new Set(["abc"]), canceled, TZ).movedOnPhone.size).toBe(0);
  });
});
