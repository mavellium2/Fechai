import { prisma } from "@/lib/prisma";
import { formatCampaignCaption, formatCampaignMessage } from "./message";
import { campaignPdfFileName, generateCampaignPdf } from "./pdf";
import { loadCampaignReport } from "./queries";
import { weekWindow } from "./settings";

/**
 * O relatório semanal pronto para sair: o PDF, o nome do arquivo, a legenda do
 * WhatsApp e o texto de reserva. É a **única** montagem: o envio (worker e
 * "Enviar agora") e a prévia da tela chamam esta função, então o que a pessoa
 * vê na página é o mesmo arquivo que chega no WhatsApp.
 *
 * `null` = a conta nunca registrou um anúncio: não há o que mostrar, e uma conta
 * assim não recebe "0 leads de anúncio" toda semana.
 *
 * O PDF é o formato; se a geração falhar (`pdf: null`), o relatório sai em
 * texto — o relatório não deixa de chegar por causa de um arquivo.
 */

export type CampaignDocument = {
  /** `null` quando a geração do PDF falhou: quem envia usa `text`. */
  pdf: Uint8Array | null;
  fileName: string;
  caption: string;
  text: string;
  /** A semana que o relatório cobre, para a tela rotular a prévia. */
  window: { from: Date; to: Date };
};

function baseUrl(): string | null {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  return configured ? configured.trim().replace(/\/+$/, "") : null;
}

export async function buildCampaignDocument(tenantId: string, timezone: string, now = new Date()): Promise<CampaignDocument | null> {
  const window = weekWindow(now, timezone);
  const [report, tenant] = await Promise.all([
    loadCampaignReport(tenantId, { from: window.from, to: window.to }, { previousFrom: window.prevFrom, now }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);
  if (!report.trackedSince) return null;

  const link = baseUrl();
  const detailsLink = link ? `${link}/relatorios?visao=campanhas` : null;
  const common = { from: window.from, to: window.to, timezone };
  const text = formatCampaignMessage({
    ...common,
    current: report.current,
    previous: report.previous,
    previousFrom: window.prevFrom,
    trackedSince: report.trackedSince,
    link: detailsLink,
  });
  const caption = formatCampaignCaption({ ...common, current: report.current, link: detailsLink });
  const fileName = campaignPdfFileName(window.from, window.to, timezone);

  let pdf: Uint8Array | null = null;
  try {
    pdf = await generateCampaignPdf({
      ...common,
      tenantName: tenant?.name ?? "Sua clínica",
      current: report.current,
      previous: report.previous,
      previousFrom: window.prevFrom,
      trackedSince: report.trackedSince,
      generatedAt: now,
    });
  } catch (err) {
    console.error("[campanhas] geração do PDF falhou; o relatório sai em texto", tenantId, err);
  }
  return { pdf, fileName, caption, text, window: { from: window.from, to: window.to } };
}
