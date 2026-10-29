import { prisma } from "@/lib/prisma";
import { parseGapSettings } from "@/modules/knowledge-gaps/settings";
import { sendToInternalGroup } from "@/modules/knowledge-gaps/group";
import { formatCampaignMessage } from "./message";
import { loadCampaignReport } from "./queries";
import {
  currentSlot,
  parseCampaignSettings,
  weekWindow,
  type CampaignSendStatus,
} from "./settings";

/**
 * Envio do relatório semanal ao grupo interno da clínica — o mesmo das
 * perguntas sem resposta. Roda no worker (`scanCampaignReports`), nunca no
 * turno do agente, e também sob demanda ("Enviar agora").
 *
 * Regras:
 * - **Uma vez por semana.** O envio reivindica o horário (`lastSentAt`) antes
 *   de enviar, então dois workers não mandam duas vezes.
 * - **Falha de envio nunca repete sozinha.** Timeout ou erro do WhatsApp pode
 *   ter entregado antes de falhar; reenviar duplicaria no grupo. O painel mostra
 *   o estado e "Enviar agora" repete por decisão de uma pessoa.
 * - **O que não depende de rede espera.** Sem grupo, sem conexão por QR ou sem
 *   anúncio capturado nada foi tentado, então o horário é devolvido e a
 *   próxima volta tenta de novo, até a tolerância (`SEND_GRACE_MS`) acabar.
 * - Nunca lança: o worker não pode cair por causa de um relatório.
 */

function baseUrl(): string | null {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  return configured ? configured.trim().replace(/\/+$/, "") : null;
}

const NOT_ATTEMPTED: CampaignSendStatus[] = ["no_group", "no_channel", "no_data"];

/** Monta e envia o relatório da semana que termina hoje. Grava `lastStatus`. */
export async function deliverCampaignReport(tenantId: string, now = new Date()): Promise<CampaignSendStatus> {
  const status = await attempt(tenantId, now);
  await prisma.campaignReportSettings
    .updateMany({ where: { tenantId }, data: { lastStatus: status, ...(status === "sent" ? { lastSentAt: now } : {}) } })
    .catch((err) => console.error("[campanhas] estado do envio não gravado", tenantId, err));
  return status;
}

async function attempt(tenantId: string, now: Date): Promise<CampaignSendStatus> {
  try {
    const [settingsRow, gapRow] = await Promise.all([
      prisma.campaignReportSettings.findUnique({ where: { tenantId } }),
      prisma.knowledgeGapSettings.findUnique({ where: { tenantId }, select: { groupId: true } }),
    ]);
    const settings = parseCampaignSettings(settingsRow);
    const groupId = parseGapSettings(gapRow).groupId;
    if (!groupId) return "no_group";

    const window = weekWindow(now, settings.timezone);
    const report = await loadCampaignReport(tenantId, { from: window.from, to: window.to }, { previousFrom: window.prevFrom, now });
    // Conta que nunca registrou um anúncio não recebe "0 leads de anúncio" toda sexta.
    if (!report.trackedSince) return "no_data";

    const link = baseUrl();
    const text = formatCampaignMessage({
      from: window.from,
      to: window.to,
      timezone: settings.timezone,
      current: report.current,
      previous: report.previous,
      previousFrom: window.prevFrom,
      trackedSince: report.trackedSince,
      link: link ? `${link}/relatorios?visao=campanhas` : null,
    });
    return (await sendToInternalGroup(tenantId, groupId, text)) ? "sent" : "no_channel";
  } catch (err) {
    console.error("[campanhas] envio do relatório falhou", tenantId, err);
    return "failed";
  }
}

/**
 * Uma volta do worker: envia às contas cujo dia e hora chegaram. Devolve
 * quantos relatórios saíram.
 */
export async function scanCampaignReports(now = new Date()): Promise<{ sent: number; waiting: number }> {
  let sent = 0, waiting = 0;
  const rows = await prisma.campaignReportSettings.findMany({
    where: { enabled: true, tenant: { status: "active" } },
  });
  for (const row of rows) {
    const settings = parseCampaignSettings(row);
    const slot = currentSlot(now, settings);
    if (!slot) continue;
    try {
      const claim = await prisma.campaignReportSettings.updateMany({
        where: { tenantId: row.tenantId, enabled: true, OR: [{ lastSentAt: null }, { lastSentAt: { lt: slot } }] },
        data: { lastSentAt: now },
      });
      if (!claim.count) continue;

      const status = await deliverCampaignReport(row.tenantId, now);
      if (status === "sent") sent++;
      else if (NOT_ATTEMPTED.includes(status)) {
        // Nada foi tentado: devolve o horário para a próxima volta tentar de novo.
        waiting++;
        await prisma.campaignReportSettings.updateMany({
          where: { tenantId: row.tenantId, lastSentAt: now },
          data: { lastSentAt: row.lastSentAt },
        });
      }
    } catch (err) {
      console.error("[campanhas] volta do worker falhou", row.tenantId, err);
    }
  }
  return { sent, waiting };
}
