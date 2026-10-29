import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

/**
 * O relatório semanal de campanhas em PDF: o arquivo, a legenda do WhatsApp, a
 * comparação com a semana anterior e o envio como documento (Evolution).
 * O que importa: o PDF sempre sai (mesmo com 0 leads, nome estranho ou dezenas
 * de anúncios), quebra de página sozinho, e o documento só vai pelo QR.
 */

import { campaignPdfFileName, generateCampaignPdf, type CampaignPdfInput } from "@/modules/campaign-reports/pdf";
import { adTrend, formatCampaignCaption } from "@/modules/campaign-reports/message";
import { summarizeCampaigns, type CampaignLine, type CampaignSummary } from "@/modules/campaign-reports/summary";

const TZ = "America/Sao_Paulo";
const FROM = new Date("2026-10-23T03:00:00Z"); // 23/10 00:00 em Brasília
const TO = new Date("2026-10-30T03:00:00Z");
const NOW = new Date("2026-10-30T11:00:00Z");
const EMPTY = summarizeCampaigns([], NOW);

const line = (i: number, label = `AD${i} - Anúncio número ${i}`): CampaignLine =>
  ({ key: `k${i}`, code: `AD${i}`, name: null, sourceId: null, label, leads: 1 + (i % 7), scheduled: i % 3, handoff: i % 2, lost: i % 4, open: 1 });

function summary(lines: CampaignLine[], over: Partial<CampaignSummary> = {}): CampaignSummary {
  const adLeads = lines.reduce((n, l) => n + l.leads, 0);
  return { leads: adLeads + 4, adLeads, otherLeads: 4, adScheduled: lines.reduce((n, l) => n + l.scheduled, 0), otherScheduled: 1, lines, ...over };
}

const input = (current: CampaignSummary, over: Partial<CampaignPdfInput> = {}): CampaignPdfInput => ({
  tenantName: "Instituto do Sorriso", from: FROM, to: TO, timezone: TZ,
  current, previous: null, previousFrom: null, trackedSince: new Date("2026-09-01T12:00:00Z"), generatedAt: NOW, ...over,
});

const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();
const head = (bytes: Uint8Array) => Buffer.from(bytes.slice(0, 5)).toString("latin1");

describe("generateCampaignPdf", () => {
  it("gera um PDF A4 válido com os anúncios", async () => {
    const bytes = await generateCampaignPdf(input(summary([line(28), line(27)])));
    expect(head(bytes)).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
    expect(doc.getTitle()).toContain("Instituto do Sorriso");
    expect(doc.getAuthor()).toBe("Mavellium · Fechai");
  });

  it("semana sem leads também gera o arquivo", async () => {
    const bytes = await generateCampaignPdf(input(EMPTY));
    expect(head(bytes)).toBe("%PDF-");
    expect(await pages(bytes)).toBe(1);
  });

  it("dezenas de anúncios quebram em mais páginas, sem cortar nada", async () => {
    const many = Array.from({ length: 70 }, (_, i) => line(i + 1));
    expect(await pages(await generateCampaignPdf(input(summary(many))))).toBeGreaterThan(1);
  });

  it("nome com emoji, acento e texto enorme não derruba a geração", async () => {
    const odd = [
      line(1, "AD01 - Prótese 🦷 Protocolo ✨"),
      line(2, `AD02 - ${"Alinhadores invisíveis com nome muito longo ".repeat(12)}`),
      line(3, "x".repeat(300)),
    ];
    const bytes = await generateCampaignPdf(input(summary(odd), { tenantName: "Clínica 😀 " + "Sorriso ".repeat(30) }));
    expect(head(bytes)).toBe("%PDF-");
  });

  it("com comparação e sem registro anterior também gera", async () => {
    const current = summary([line(28)]);
    const previous = summary([line(28)], { adLeads: 2 });
    const bytes = await generateCampaignPdf(input(current, { previous, previousFrom: new Date("2026-10-16T03:00:00Z") }));
    expect(head(bytes)).toBe("%PDF-");
  });
});

describe("campaignPdfFileName", () => {
  it("é ASCII e traz o primeiro e o último dia da semana", () => {
    expect(campaignPdfFileName(FROM, TO, TZ)).toBe("relatorio-campanhas-2026-10-23-a-2026-10-29.pdf");
  });
});

describe("legenda do WhatsApp", () => {
  const base = { from: FROM, to: TO, timezone: TZ, link: "https://app.fechai.test/relatorios?visao=campanhas" };

  it("é curta: período, contagens e o link", () => {
    const caption = formatCampaignCaption({ ...base, current: summary([line(28)]) });
    expect(caption).toContain("*Relatório semanal de campanhas*");
    expect(caption).toContain("23/10 a 29/10");
    expect(caption).toContain("Detalhes: https://app.fechai.test/relatorios?visao=campanhas");
    expect(caption.split("\n").length).toBeLessThanOrEqual(4);
    expect(caption.length).toBeLessThan(400);
  });

  it("semana sem leads diz isso e sem link não inventa um", () => {
    const caption = formatCampaignCaption({ ...base, link: null, current: EMPTY });
    expect(caption).toContain("Nenhum lead novo na semana.");
    expect(caption).not.toContain("Detalhes");
  });
});

describe("adTrend (comparação com a semana anterior)", () => {
  const prevFrom = new Date("2026-10-16T03:00:00Z");
  const tracked = new Date("2026-09-01T12:00:00Z");

  it("só compara quando a semana anterior já tinha captura", () => {
    const current = summary([line(28)], { adLeads: 10 });
    const previous = summary([line(28)], { adLeads: 8 });
    expect(adTrend({ current, previous, previousFrom: prevFrom, trackedSince: tracked })).toEqual({
      long: "+25% sobre a semana anterior (8)", short: "+25% vs. semana anterior",
    });
    // captura começou depois do começo da semana anterior: sem comparação
    expect(adTrend({ current, previous, previousFrom: prevFrom, trackedSince: new Date("2026-10-20T12:00:00Z") })).toBeNull();
    expect(adTrend({ current, previous: null, previousFrom: null, trackedSince: tracked })).toBeNull();
    expect(adTrend({ current: summary([]), previous, previousFrom: prevFrom, trackedSince: tracked })).toBeNull();
  });
});

describe("Evolution.sendDocument", () => {
  let calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => {
    vi.resetModules();
    process.env.EVOLUTION_API_URL = "https://evo.test";
    process.env.EVOLUTION_API_KEY = "chave";
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ key: { id: "DOC1" } }), text: async () => "" } as unknown as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const doc = { base64: "JVBERi0=", mimetype: "application/pdf", fileName: "relatorio.pdf", caption: "legenda" };
  const provider = async () => new (await import("@/modules/whatsapp/evolution")).EvolutionProvider();

  it("manda como documento (sendMedia) com nome, legenda e base64 sem prefixo", async () => {
    await expect((await provider()).sendDocument("tenant_x", "120363111111111111@g.us", doc)).resolves.toBe("DOC1");
    expect(calls[0].url).toBe("https://evo.test/message/sendMedia/tenant_x");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      number: "120363111111111111@g.us", mediatype: "document", mimetype: "application/pdf",
      media: "JVBERi0=", fileName: "relatorio.pdf", caption: "legenda",
    });
  });

  it("aceita telefone, e recusa qualquer outro destino", async () => {
    const p = await provider();
    await expect(p.sendDocument("tenant_x", "5511987654321", doc)).resolves.toBe("DOC1");
    await expect(p.sendDocument("tenant_x", "alguem@s.whatsapp.net", doc)).rejects.toThrow("Destino");
    await expect(p.sendDocument("tenant_x", "123", doc)).rejects.toThrow("Destino");
    expect(calls).toHaveLength(1);
  });

  it("propaga a falha do provedor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "erro interno", json: async () => ({}) }) as unknown as Response));
    await expect((await provider()).sendDocument("tenant_x", "5511987654321", doc)).rejects.toThrow("sendMedia falhou (500)");
  });
});
