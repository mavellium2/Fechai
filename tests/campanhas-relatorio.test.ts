import { describe, expect, it } from "vitest";
import { summarizeCampaigns, type CampaignRow } from "@/modules/campaign-reports/summary";
import { formatCampaignMessage, rangeLabel } from "@/modules/campaign-reports/message";
import {
  DEFAULT_CAMPAIGN_SETTINGS,
  SEND_GRACE_MS,
  currentSlot,
  describeCampaignSchedule,
  parseCampaignSettings,
  weekWindow,
} from "@/modules/campaign-reports/settings";

const NOW = new Date("2026-10-30T12:00:00Z");
const HOUR = 3_600_000;

type Origin = CampaignRow["origin"];
function row(origin: Origin, state: "scheduled" | "open" | "handoff" | "lost" = "open"): CampaignRow {
  return {
    createdAt: new Date(NOW.getTime() - 24 * HOUR),
    status: state === "lost" ? "lost" : "new",
    disqualified: false,
    disqualifiedReason: null,
    appointments: state === "scheduled" ? [{ status: "scheduled" }] : [],
    conversation: {
      needsHuman: state === "handoff",
      lastInboundAt: new Date(NOW.getTime() - HOUR),
      followUpReason: null,
      handoffEvents: 0,
    },
    insight: null,
    origin,
  };
}
const ad = (code: string | null, name: string | null, sourceId: string | null = "120251508234490338"): Origin => ({ code, name, sourceId });

describe("summarizeCampaigns", () => {
  it("agrupa pelo código e a soma fecha: anúncio + sem anúncio = leads", () => {
    const s = summarizeCampaigns(
      [
        row(ad("AD27", "Alinhadores Invisíveis"), "scheduled"),
        row(ad("AD27", "Alinhadores Invisíveis")),
        row(ad("AD37", "Prótese Protocolo"), "handoff"),
        row(null, "scheduled"),
        row(null),
      ],
      NOW,
    );
    expect(s.leads).toBe(5);
    expect(s.adLeads).toBe(3);
    expect(s.otherLeads).toBe(2);
    expect(s.adLeads + s.otherLeads).toBe(s.leads);
    expect(s.adScheduled).toBe(1);
    expect(s.otherScheduled).toBe(1);
    expect(s.lines.map((l) => [l.label, l.leads, l.scheduled, l.handoff])).toEqual([
      ["AD27 - Alinhadores Invisíveis", 2, 1, 0],
      ["AD37 - Prótese Protocolo", 1, 0, 1],
    ]);
    expect(s.lines.reduce((sum, l) => sum + l.leads, 0)).toBe(s.adLeads);
  });

  it("anúncios com o mesmo código e ids diferentes viram uma linha só", () => {
    const s = summarizeCampaigns([row(ad("AD4", "Depoimento Emerson", "111111")), row(ad("AD4", "Depoimento Emerson", "222222"))], NOW);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].leads).toBe(2);
  });

  it("código renomeado usa o nome mais frequente", () => {
    const s = summarizeCampaigns([row(ad("AD8", "Campeão")), row(ad("AD8", "Campeão")), row(ad("AD8", "Variação"))], NOW);
    expect(s.lines[0].label).toBe("AD8 - Campeão");
  });

  it("lead com id mas sem código fica numa linha própria, sem inventar o código", () => {
    const s = summarizeCampaigns([row(ad(null, null, "120246957169330338")), row(ad("AD1", "Um"))], NOW);
    const noCode = s.lines.find((l) => l.code === null)!;
    expect(noCode.label).toBe("Anúncio sem código (final 0338)");
    expect(s.adLeads).toBe(2);
  });

  it("ordena por leads e depois por agendamentos", () => {
    const s = summarizeCampaigns(
      [row(ad("AD1", "A")), row(ad("AD2", "B"), "scheduled"), row(ad("AD3", "C")), row(ad("AD3", "C"))],
      NOW,
    );
    expect(s.lines.map((l) => l.code)).toEqual(["AD3", "AD2", "AD1"]);
  });

  it("semana vazia não quebra", () => {
    expect(summarizeCampaigns([], NOW)).toEqual({ leads: 0, adLeads: 0, otherLeads: 0, adScheduled: 0, otherScheduled: 0, lines: [] });
  });
});

describe("settings do envio semanal", () => {
  it("o padrão é desligado, sexta às 8h", () => {
    expect(parseCampaignSettings(null)).toEqual(DEFAULT_CAMPAIGN_SETTINGS);
    expect(DEFAULT_CAMPAIGN_SETTINGS).toMatchObject({ enabled: false, weekday: 5, hour: 8 });
  });

  it("valor estranho cai no padrão, nunca lança", () => {
    const s = parseCampaignSettings({ enabled: "sim", weekday: 9, hour: -1, timezone: "Marte/Olimpo", lastStatus: "quebrado" });
    expect(s).toEqual(DEFAULT_CAMPAIGN_SETTINGS);
  });

  it("guarda o que é válido", () => {
    const sent = new Date("2026-10-30T11:00:00Z");
    expect(parseCampaignSettings({ enabled: true, weekday: 6, hour: 10, timezone: "America/Manaus", lastSentAt: sent, lastStatus: "sent" }))
      .toEqual({ enabled: true, weekday: 6, hour: 10, timezone: "America/Manaus", lastSentAt: sent, lastStatus: "sent" });
  });

  it("descreve o horário em uma linha", () => {
    expect(describeCampaignSchedule({ ...DEFAULT_CAMPAIGN_SETTINGS, enabled: true })).toBe("sexta-feira às 08:00 (Brasília (São Paulo))");
  });
});

describe("currentSlot (quando enviar)", () => {
  // 30/10/2026 é sexta-feira; Brasília é UTC−3 (sem horário de verão).
  const friday8 = { weekday: 5, hour: 8, timezone: "America/Sao_Paulo" };
  const at = (iso: string) => new Date(iso);

  it("na hora marcada devolve o horário de hoje", () => {
    expect(currentSlot(at("2026-10-30T11:00:00Z"), friday8)?.toISOString()).toBe("2026-10-30T11:00:00.000Z");
    expect(currentSlot(at("2026-10-30T11:30:00Z"), friday8)?.toISOString()).toBe("2026-10-30T11:00:00.000Z");
  });

  it("antes da hora ou no dia errado não envia", () => {
    expect(currentSlot(at("2026-10-30T10:59:00Z"), friday8)).toBeNull();
    expect(currentSlot(at("2026-10-29T11:30:00Z"), friday8)).toBeNull();
    expect(currentSlot(at("2026-10-31T11:30:00Z"), friday8)).toBeNull();
  });

  it("worker atrasado envia até a tolerância e não depois", () => {
    expect(currentSlot(new Date(at("2026-10-30T11:00:00Z").getTime() + SEND_GRACE_MS), friday8)).not.toBeNull();
    expect(currentSlot(new Date(at("2026-10-30T11:00:00Z").getTime() + SEND_GRACE_MS + 60_000), friday8)).toBeNull();
  });

  it("a tolerância não atravessa a meia-noite", () => {
    const lateNight = { weekday: 5, hour: 22, timezone: "America/Sao_Paulo" };
    expect(currentSlot(at("2026-10-31T01:30:00Z"), lateNight)).not.toBeNull(); // sexta 22:30
    expect(currentSlot(at("2026-10-31T03:30:00Z"), lateNight)).toBeNull(); // sábado 00:30: já é outro dia
  });

  it("respeita o fuso da conta", () => {
    const manaus = { weekday: 5, hour: 8, timezone: "America/Manaus" }; // UTC−4
    expect(currentSlot(at("2026-10-30T12:10:00Z"), manaus)?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    expect(currentSlot(at("2026-10-30T11:10:00Z"), manaus)).toBeNull();
  });
});

describe("weekWindow", () => {
  it("cobre os 7 dias até ontem, com hoje de fora, e a semana anterior", () => {
    const w = weekWindow(new Date("2026-10-30T11:30:00Z"), "America/Sao_Paulo");
    expect(w.to.toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(w.from.toISOString()).toBe("2026-10-23T03:00:00.000Z");
    expect(w.prevFrom.toISOString()).toBe("2026-10-16T03:00:00.000Z");
  });
});

describe("formatCampaignMessage", () => {
  const window = weekWindow(new Date("2026-10-30T11:30:00Z"), "America/Sao_Paulo");
  const base = {
    from: window.from, to: window.to, timezone: "America/Sao_Paulo",
    previous: null, previousFrom: window.prevFrom, trackedSince: new Date("2026-09-01T12:00:00Z"),
    link: "https://app.fechai.com/relatorios?visao=campanhas",
  };

  it("rótulo de datas vai do primeiro ao último dia da semana", () => {
    expect(rangeLabel(window.from, window.to, "America/Sao_Paulo")).toBe("23/10 a 29/10");
  });

  it("traz totais, anúncios e o link, sem dado de paciente", () => {
    const current = summarizeCampaigns(
      [row(ad("AD27", "Alinhadores Invisíveis"), "scheduled"), row(ad("AD27", "Alinhadores Invisíveis")), row(null)],
      NOW,
    );
    const text = formatCampaignMessage({ ...base, current });
    expect(text).toContain("*Relatório semanal de campanhas*");
    expect(text).toContain("23/10 a 29/10");
    expect(text).toContain("*3 leads novos*");
    expect(text).toContain("2 de anúncio, 1 sem anúncio identificado");
    expect(text).toContain("1. AD27 - Alinhadores Invisíveis — 2 leads · 1 agendou (50%)");
    expect(text).toContain("Detalhes: https://app.fechai.com/relatorios?visao=campanhas");
  });

  it("limita a lista e avisa quantos ficaram de fora", () => {
    const rows = Array.from({ length: 13 }, (_, i) => row(ad(`AD${i + 1}`, `Campanha ${i + 1}`, String(100000 + i))));
    const text = formatCampaignMessage({ ...base, current: summarizeCampaigns(rows, NOW) });
    expect(text).toContain("10. ");
    expect(text).not.toContain("11. ");
    expect(text).toContain("e mais 3 anúncios");
  });

  it("compara com a semana anterior só quando ela já tinha captura", () => {
    const current = summarizeCampaigns([row(ad("AD1", "A")), row(ad("AD1", "A")), row(ad("AD1", "A"))], NOW);
    const previous = summarizeCampaigns([row(ad("AD1", "A")), row(ad("AD1", "A"))], NOW);
    expect(formatCampaignMessage({ ...base, current, previous })).toContain("+50% sobre a semana anterior (2)");
    // captura começou no meio da semana anterior: a comparação seria falsa
    const partial = formatCampaignMessage({ ...base, current, previous, trackedSince: new Date("2026-10-20T12:00:00Z") });
    expect(partial).not.toContain("semana anterior");
  });

  it("semana sem lead diz isso em vez de mandar zeros", () => {
    const text = formatCampaignMessage({ ...base, current: summarizeCampaigns([], NOW) });
    expect(text).toContain("Nenhum lead novo na semana.");
    expect(text).not.toContain("*Por anúncio*");
  });

  it("sem link configurado manda o caminho no painel", () => {
    const text = formatCampaignMessage({ ...base, link: null, current: summarizeCampaigns([row(null)], NOW) });
    expect(text).toContain("Relatórios › Campanhas");
  });
});
