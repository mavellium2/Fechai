import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dayKeyInZone } from "@/modules/scheduling/time";
import { adTrend, rangeLabel } from "./message";
import { percent, type CampaignSummary } from "./summary";

/**
 * PDF A4 do relatório semanal de campanhas — o arquivo que vai ao WhatsApp e a
 * mesma prévia que a tela mostra. Mesmo visual do relatório mensal: cabeçalho
 * com os logos, faixa escura de título, quatro números, as partes e o rodapé.
 *
 * Só agregados: nenhum nome, telefone ou texto de conversa entra aqui. É
 * `pdf-lib` puro (sem navegador), para o worker gerar sozinho. O documento
 * flui: quebra de página quando precisa, nunca corta o que cabe numa linha.
 */
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36, WIDTH = 523, TOP = 806, BOTTOM = 50;
/** Anúncios no gráfico de barras; a tabela traz todos. */
const BAR_LIMIT = 15;

export type CampaignPdfInput = {
  tenantName: string;
  from: Date;
  to: Date;
  timezone: string;
  current: CampaignSummary;
  previous: CampaignSummary | null;
  previousFrom: Date | null;
  trackedSince: Date | null;
  generatedAt: Date;
};

/** "relatorio-campanhas-2026-10-23-a-2026-10-29.pdf": ASCII, sem espaço. */
export function campaignPdfFileName(from: Date, to: Date, timezone: string): string {
  const first = dayKeyInZone(from, timezone);
  const last = dayKeyInZone(new Date(to.getTime() - 1), timezone);
  return `relatorio-campanhas-${first}-a-${last}.pdf`;
}

export async function generateCampaignPdf(input: CampaignPdfInput): Promise<Uint8Array> {
  const { current, tenantName, timezone } = input;
  const doc = await PDFDocument.create();
  const period = rangeLabel(input.from, input.to, timezone);
  doc.setTitle(`Relatório semanal de campanhas - ${tenantName} - ${period}`);
  doc.setAuthor("Mavellium · Fechai");
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.06, 0.06), muted = rgb(0.35, 0.35, 0.35), rule = rgb(0.88, 0.88, 0.88), card = rgb(0.95, 0.95, 0.95);
  const band = rgb(0.07, 0.1, 0.16), white = rgb(1, 1, 1), bandMuted = rgb(0.72, 0.76, 0.84), anchor = rgb(0.89, 0.94, 0.92);
  const barLight = rgb(0.8, 0.84, 0.91);
  const [fechai, mavellium] = await Promise.all([
    readFile(join(process.cwd(), "public/brand/fechai-black.png")).then((bytes) => doc.embedPng(bytes)),
    readFile(join(process.cwd(), "public/brand/mavellium-black.png")).then((bytes) => doc.embedPng(bytes)),
  ]);

  let page: PDFPage = doc.addPage(A4);
  let y = TOP;

  // Helvetica cobre português. Caractere fora do alfabeto do PDF (emoji no nome
  // de um anúncio, por exemplo) vira espaço, sem quebrar a geração inteira.
  function safe(value: string, font: PDFFont) {
    return [...value.replace(/[\r\t]/g, " ").replace(/−/g, "-")].map((char) => {
      try { font.encodeText(char); return char; } catch { return " "; }
    }).join("");
  }
  function lines(value: string, maxWidth: number, size: number, font = regular): string[] {
    const result: string[] = [];
    for (const paragraph of safe(value, font).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
        if (line) result.push(line);
        line = "";
        // Palavra maior que a linha (um código longo) quebra por letra.
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > maxWidth && line) { result.push(line); line = ""; }
          line += char;
        }
      }
      result.push(line);
    }
    return result;
  }
  /** Uma linha só, com reticências se não couber (rótulo de anúncio). */
  function fit(value: string, maxWidth: number, size: number, font = regular): string {
    const clean = safe(value, font).replace(/\s+/g, " ").trim();
    if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
    let cut = clean;
    while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}...`;
  }
  function text(content: string, x = MARGIN, at = y, size = 9, font = regular, color: RGB = ink) {
    page.drawText(safe(content, font), { x, y: at, size, font, color });
  }
  const textRight = (content: string, right: number, at: number, size: number, font = regular, color: RGB = ink) =>
    text(content, right - font.widthOfTextAtSize(safe(content, font), size), at, size, font, color);

  function pageHeader() {
    page.drawImage(fechai, { x: MARGIN - 3, y: y - 7, width: 24, height: 24 });
    text("fechai.", MARGIN + 24, y - 1, 15, bold, ink);
    page.drawImage(mavellium, { x: MARGIN + WIDTH - 90, y: y - 3, width: 90, height: 90 * mavellium.height / mavellium.width });
    y -= 22;
  }
  function newPage() {
    page = doc.addPage(A4);
    y = TOP;
    pageHeader();
    text(`${fit(tenantName, 330, 8.5)} · Campanhas · ${period}`, MARGIN, y, 8.5, regular, muted);
    y -= 14;
  }
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(); };
  function flow(content: string, size = 8.6, color: RGB = ink, font = regular) {
    for (const line of lines(content, WIDTH, size, font)) { ensure(size + 3); text(line, MARGIN, y, size, font, color); y -= size + 3; }
  }
  function part(number: string, title: string, tag = "") {
    ensure(70);
    y -= 14;
    text(number, MARGIN, y, 8, bold, muted);
    text(title, MARGIN + 22, y, 12.5, bold, ink);
    if (tag) textRight(tag, MARGIN + WIDTH, y + 1, 6.5, bold, muted);
    page.drawLine({ start: { x: MARGIN, y: y - 6 }, end: { x: MARGIN + WIDTH, y: y - 6 }, thickness: 0.6, color: rule });
    y -= 20;
  }

  /* ----------------------------- Abertura ----------------------------- */
  pageHeader();
  // Faixa escura com o título: quem abre sabe de cara o que está lendo.
  const bandTop = y - 6, bandHeight = 90;
  page.drawRectangle({ x: MARGIN, y: bandTop - bandHeight, width: WIDTH, height: bandHeight, color: band });
  text("FECHAI · RELATÓRIO SEMANAL DE CAMPANHAS", MARGIN + 16, bandTop - 20, 7.5, bold, bandMuted);
  text("Campanhas da semana", MARGIN + 16, bandTop - 52, 24, bold, white);
  text(fit(`${tenantName} · ${period}`, WIDTH - 32, 10.5), MARGIN + 16, bandTop - 72, 10.5, regular, white);
  y = bandTop - bandHeight - 22;

  if (current.leads === 0) {
    flow(`Nenhum lead novo na semana de ${period}.`, 10.5, ink);
  } else {
    const scheduledRate = percent(current.adScheduled, current.adLeads);
    flow(
      `Na semana de ${period} chegaram ${current.leads} ${current.leads === 1 ? "lead" : "leads"}: ${current.adLeads} de anúncio e ${current.otherLeads} sem anúncio identificado.` +
      (current.adLeads > 0 ? ` Entre os de anúncio, ${current.adScheduled} ${current.adScheduled === 1 ? "agendou" : "agendaram"}${scheduledRate === null ? "" : ` (${scheduledRate}%)`}.` : ""),
      10.5, ink,
    );
  }
  y -= 6;

  // Quatro números. O agendamento é o principal, como no relatório mensal.
  const trend = adTrend(input);
  const adShare = percent(current.adLeads, current.leads);
  const kpis = [
    { label: "Leads novos", value: String(current.leads), hint: "criados na semana", delta: "" },
    { label: "Vieram de anúncio", value: String(current.adLeads), hint: adShare === null ? "" : `${adShare}% dos leads`, delta: trend?.short ?? "" },
    { label: "Agendaram (de anúncio)", value: String(current.adScheduled), hint: percent(current.adScheduled, current.adLeads) === null ? "" : `${percent(current.adScheduled, current.adLeads)}% dos de anúncio`, delta: "", anchor: true },
    { label: "Sem anúncio identificado", value: String(current.otherLeads), hint: "orgânico ou contato antigo", delta: "" },
  ];
  const cardW = (WIDTH - 24) / 4, cardH = 74;
  ensure(cardH + 12);
  kpis.forEach((item, i) => {
    const x = MARGIN + i * (cardW + 8);
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: item.anchor ? anchor : card });
    text(fit(item.label, cardW - 16, 7.5), x + 9, y - 14, 7.5, regular, muted);
    text(item.value, x + 9, y - 37, 20, bold, ink);
    lines(item.hint, cardW - 16, 6.8).slice(0, 2).forEach((line, k) => text(line, x + 9, y - 48 - k * 8, 6.8, regular, muted));
    if (item.delta) text(fit(item.delta, cardW - 16, 6.8, bold), x + 9, y - 67, 6.8, bold, ink);
  });
  y -= cardH + 12;

  /* ----------------------------- Partes ----------------------------- */
  if (current.lines.length) {
    part("01", "Leads por anúncio", "ESCURO = AGENDARAM");
    const maxLeads = Math.max(...current.lines.map((l) => l.leads), 1);
    const labelW = 215, barX = MARGIN + labelW + 8, barMax = 190, valueRight = MARGIN + WIDTH;
    for (const line of current.lines.slice(0, BAR_LIMIT)) {
      ensure(18);
      text(fit(line.label, labelW, 8.5), MARGIN, y, 8.5, regular, ink);
      const full = Math.max((line.leads / maxLeads) * barMax, 2);
      page.drawRectangle({ x: barX, y: y - 2, width: full, height: 9, color: barLight });
      if (line.scheduled > 0) page.drawRectangle({ x: barX, y: y - 2, width: Math.max((line.scheduled / maxLeads) * barMax, 2), height: 9, color: band });
      textRight(`${line.leads} ${line.leads === 1 ? "lead" : "leads"} · ${line.scheduled} ${line.scheduled === 1 ? "agendou" : "agendaram"}`, valueRight, y, 8, bold, ink);
      y -= 17;
    }
    if (current.lines.length > BAR_LIMIT) { flow(`e mais ${current.lines.length - BAR_LIMIT} ${current.lines.length - BAR_LIMIT === 1 ? "anúncio" : "anúncios"} na tabela abaixo.`, 7.6, muted); }

    part("02", "Resultado por anúncio");
    const head = ["Anúncio", "Leads", "Agendaram", "Taxa", "Equipe", "Perderam", "Em andamento"];
    const colW = 57, columns = head.length - 1, labelCol = WIDTH - columns * colW - 8;
    const right = (i: number) => MARGIN + WIDTH - (columns - 1 - i) * colW;
    const drawHead = () => {
      head.forEach((cell, i) => i === 0 ? text(cell, MARGIN, y, 7, bold, muted) : textRight(cell, right(i - 1), y, 7, bold, muted));
      page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: MARGIN + WIDTH, y: y - 4 }, thickness: 0.5, color: rule });
      y -= 14;
    };
    ensure(60);
    drawHead();
    for (const line of current.lines) {
      const wrapped = lines(line.label, labelCol, 8.5);
      const rowHeight = wrapped.length * 11 + 4;
      if (y - rowHeight < BOTTOM) { newPage(); drawHead(); }
      wrapped.forEach((l, i) => text(l, MARGIN, y - i * 11, 8.5, regular, ink));
      const rate = percent(line.scheduled, line.leads);
      [String(line.leads), String(line.scheduled), rate === null ? "-" : `${rate}%`, String(line.handoff), String(line.lost), String(line.open)]
        .forEach((cell, i) => textRight(cell, right(i), y, 8.5, bold, ink));
      const bottom = y - (wrapped.length - 1) * 11 - 4;
      page.drawLine({ start: { x: MARGIN, y: bottom }, end: { x: MARGIN + WIDTH, y: bottom }, thickness: 0.35, color: rule });
      y = bottom - 10;
    }
  }

  part(current.lines.length ? "03" : "01", "Como contamos");
  flow("Conta os leads criados na semana, com o anúncio da primeira mensagem: o primeiro anúncio de cada contato vale, e clicar em outro depois não muda. \"Sem anúncio identificado\" não é o mesmo que orgânico: é uma mensagem que não trazia anúncio (inclui contatos de antes de o Fechai registrar a origem).", 8, muted);
  flow("O resultado é calculado quando o relatório é gerado: agendou = algum agendamento não cancelado; perdeu = motivo registrado, triagem, follow-up recusado ou 72 horas sem resposta; equipe = a conversa foi passada para uma pessoa.", 8, muted);
  if (input.trackedSince) {
    flow(`Há registro de anúncio desde ${new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(input.trackedSince)}; antes disso, "sem anúncio identificado" é falta de registro.`, 8, muted);
  }

  /* ----------------------------- Rodapé ----------------------------- */
  const generated = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(input.generatedAt);
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    text(`Gerado pelo Fechai em ${generated}`, MARGIN, 28, 7, regular, muted);
    textRight(`Página ${i + 1} de ${pages.length}`, MARGIN + WIDTH, 28, 7, regular, muted);
  });

  return doc.save();
}
