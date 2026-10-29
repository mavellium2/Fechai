import { prisma } from "@/lib/prisma";
import { findWhatsappChannel } from "@/modules/whatsapp/instances";
import { backfillAdOrigins, type BackfillStats } from "./backfill";
import { HISTORY_IMPORT_DAYS, canRequestHistoryImport, parseCampaignSettings } from "./settings";

/**
 * Importação do histórico de anúncios **pela tela**: a aba Campanhas só se
 * preenche sozinha para contatos novos, e quem já tinha chegado de anúncio só
 * aparece depois de ler o que a Evolution guardou. É o mesmo `backfillAdOrigins`
 * do script (`scripts/backfill-lead-ad-origin.ts`), pedido por um botão.
 *
 * O pedido só grava `requested`; **quem lê a Evolution é o worker**
 * (`runPendingHistoryImports`), porque a leitura leva minutos e não cabe numa
 * requisição. Uma importação por vez em todo o worker (a Evolution é do número
 * da clínica e a leitura é pesada). Só grava `LeadAdOrigin` em leads que já
 * existem e pode ser repetida sem duplicar: o primeiro anúncio de cada lead vence.
 * O resumo guardado só tem contagens.
 */

export type HistoryRequestResult = { ok: true } | { ok: false; error: string };

export async function requestHistoryImport(tenantId: string, now = new Date()): Promise<HistoryRequestResult> {
  const channel = await findWhatsappChannel(tenantId, "evolution");
  if (!channel?.externalId) {
    return { ok: false, error: "O WhatsApp por QR code não está conectado. O histórico é lido dele: reconecte em Integrações." };
  }
  const current = parseCampaignSettings(await prisma.campaignReportSettings.findUnique({ where: { tenantId } }));
  if (!canRequestHistoryImport(current.history, now)) {
    return { ok: false, error: "Já há uma importação em andamento. Aguarde terminar." };
  }
  const data = { historyImportStatus: "requested", historyImportAt: now, historyImportSummary: null };
  await prisma.campaignReportSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  return { ok: true };
}

/** O que a pessoa lê depois da importação: só contagens, nunca telefone ou nome. */
export function summarizeHistoryImport(stats: BackfillStats, days = HISTORY_IMPORT_DAYS): string {
  if (stats.contacts === 0) {
    return `Nenhum anúncio encontrado nas mensagens dos últimos ${days} dias (${stats.scanned} mensagens lidas).`;
  }
  const parts = [`${stats.created} ${stats.created === 1 ? "lead ligado" : "leads ligados"} a um anúncio`];
  if (stats.alreadyHad) parts.push(`${stats.alreadyHad} já tinham origem`);
  if (stats.noLeadInFechai) parts.push(`${stats.noLeadInFechai} contatos de anúncio sem lead no Fechai`);
  return `${parts.join("; ")}. ${stats.contacts} contatos vieram de anúncio nos últimos ${days} dias (${stats.scanned} mensagens lidas).`;
}

const running = new Set<string>();

async function importHistory(tenantId: string, now: Date): Promise<void> {
  let status = "done";
  let summary: string;
  try {
    const since = new Date(now.getTime() - HISTORY_IMPORT_DAYS * 86_400_000);
    summary = summarizeHistoryImport(await backfillAdOrigins({ tenantId, since, until: now, apply: true }));
  } catch (err) {
    console.error("[campanhas] importação do histórico falhou", tenantId, err);
    status = "failed";
    summary = "Não foi possível ler o histórico agora. Tente de novo em alguns minutos.";
  }
  await prisma.campaignReportSettings
    .updateMany({ where: { tenantId }, data: { historyImportStatus: status, historyImportAt: new Date(), historyImportSummary: summary } })
    .catch((err) => console.error("[campanhas] resultado da importação não gravado", tenantId, err));
}

/**
 * Uma volta do worker: pega o primeiro pedido na fila e roda em segundo plano
 * (a volta não espera: os avisos e o relatório semanal continuam saindo). Devolve
 * quantas importações começaram. Nunca lança.
 */
export async function runPendingHistoryImports(now = new Date()): Promise<number> {
  if (running.size > 0) return 0;
  try {
    const requested = await prisma.campaignReportSettings.findMany({
      where: { historyImportStatus: "requested", tenant: { status: "active" } },
      select: { tenantId: true },
      orderBy: { historyImportAt: "asc" },
      take: 1,
    });
    for (const { tenantId } of requested) {
      const claim = await prisma.campaignReportSettings.updateMany({
        where: { tenantId, historyImportStatus: "requested" },
        data: { historyImportStatus: "running", historyImportAt: now },
      });
      if (!claim.count) continue;
      running.add(tenantId);
      void importHistory(tenantId, now).finally(() => running.delete(tenantId));
      return 1;
    }
  } catch (err) {
    console.error("[campanhas] fila de importação do histórico falhou", err);
  }
  return 0;
}
