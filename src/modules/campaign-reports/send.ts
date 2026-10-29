import { prisma } from "@/lib/prisma";
import { parseGapSettings } from "@/modules/knowledge-gaps/settings";
import {
  sendDocumentToInternalGroup,
  sendDocumentToInternalPhone,
  sendToInternalGroup,
  sendToInternalPhone,
} from "@/modules/knowledge-gaps/group";
import { buildCampaignDocument } from "./document";
import { isPhoneRefused } from "./phone";
import { currentSlot, parseCampaignSettings, type CampaignSendStatus } from "./settings";

/**
 * Envio do relatório semanal, em PDF (`document.ts`): a um grupo interno da clínica (o escolhido aqui ou,
 * sem escolha, o dos avisos de perguntas sem resposta) ou a um número (o da
 * própria pessoa). Roda no worker (`scanCampaignReports`), nunca no turno do
 * agente, e também sob demanda ("Enviar agora").
 *
 * Regras:
 * - **Uma vez por semana.** O envio reivindica o horário (`lastSentAt`) antes
 *   de enviar, então dois workers não mandam duas vezes.
 * - **Falha de envio nunca repete sozinha.** Timeout ou erro do WhatsApp pode
 *   ter entregado antes de falhar; reenviar duplicaria no grupo. O painel mostra
 *   o estado e "Enviar agora" repete por decisão de uma pessoa.
 * - **O que não depende de rede espera.** Sem destino, sem conexão por QR ou sem
 *   anúncio capturado nada foi tentado, então o horário é devolvido e a
 *   próxima volta tenta de novo, até a tolerância (`SEND_GRACE_MS`) acabar.
 * - **Número só pelo QR e só para quem a clínica pode procurar** (`isPhoneRefused`):
 *   bloqueado, "pare" e contato da Meta ficam de fora, e a Meta nunca é o
 *   plano B. Grupo e número só existem no QR code.
 * - Nunca lança: o worker não pode cair por causa de um relatório.
 */

const NOT_ATTEMPTED: CampaignSendStatus[] = ["no_group", "no_phone", "no_channel", "no_data"];

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
    const toPhone = settings.destination === "phone";
    const phone = toPhone ? settings.phone : null;
    // Sem grupo próprio vale o dos avisos de Perguntas (único destino da primeira versão).
    const groupId = toPhone ? null : (settings.groupId ?? parseGapSettings(gapRow).groupId);
    if (toPhone && !phone) return "no_phone";
    if (!toPhone && !groupId) return "no_group";
    if (phone && (await isPhoneRefused(tenantId, phone))) return "refused";

    // Conta que nunca registrou um anúncio não recebe "0 leads de anúncio" toda sexta.
    const report = await buildCampaignDocument(tenantId, settings.timezone, now);
    if (!report) return "no_data";

    // O PDF vai como documento, com a legenda curta; sem PDF (geração falhou) vai o texto.
    const document = report.pdf
      ? { base64: Buffer.from(report.pdf).toString("base64"), mimetype: "application/pdf", fileName: report.fileName, caption: report.caption }
      : null;
    let delivered = false;
    if (phone) {
      delivered = document
        ? await sendDocumentToInternalPhone(tenantId, phone, document)
        : await sendToInternalPhone(tenantId, phone, report.text);
    } else if (groupId) {
      delivered = document
        ? await sendDocumentToInternalGroup(tenantId, groupId, document)
        : await sendToInternalGroup(tenantId, groupId, report.text);
    }
    return delivered ? "sent" : "no_channel";
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
