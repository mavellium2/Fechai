import { leadOutcome } from "@/modules/lead-insights/summary";
import { campaignKey, summarizeCampaigns } from "@/modules/campaign-reports/summary";
import type { MonthlyInput } from "./monthly";
import type { MonthlyEvidence } from "./monthly-evidence";
import type { MonthlyCampaigns } from "./monthly-data";

/*
 * Leads novos do mês por anúncio de origem, na mesma passada dos demais
 * números. Só ids e contagens: nenhum nome, telefone ou texto de conversa.
 * "Sem anúncio identificado" não é orgânico. A leitura já filtrou o escopo de
 * agentes e os agendamentos até o fim do mês.
 */
export function buildCampaigns(input: MonthlyInput, evidence: MonthlyEvidence): MonthlyCampaigns | undefined {
  const source = input.campaigns;
  // Sem leitura, ou sem captura de anúncio até o fim do mês: o bloco não existe.
  if (!source || !source.trackedSince || source.trackedSince >= input.end) return undefined;
  const summary = summarizeCampaigns(source.rows, input.now);
  if (summary.adLeads === 0) return undefined;

  evidence.campaigns = source.rows.map((row) => ({
    leadId: row.leadId,
    key: row.origin ? campaignKey(row.origin) : null,
    scheduled: leadOutcome(row, input.now).outcome === "scheduled",
  }));
  return {
    leads: summary.leads,
    adLeads: summary.adLeads,
    withoutAd: summary.otherLeads,
    withoutAdScheduled: summary.otherScheduled,
    partialCapture: source.trackedSince > input.start,
    lines: summary.lines.map(({ key, label, leads, scheduled }) => ({ key, label, leads, scheduled })),
  };
}
