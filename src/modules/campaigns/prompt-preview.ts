import { campaignRulesPrompt, type CampaignRules } from "./rules";

/**
 * Prévia do que o agente lê sobre a campanha: o MESMO bloco do turno
 * (`campaignRulesPrompt`), sem regra própria. Puro e só leitura — a tela mostra,
 * nada grava. Sem arquivos nem transbordo: a prévia fala só das regras.
 */
export function campaignPromptPreview(
  campaign: { name: string; objective: string | null; description: string | null },
  rules: CampaignRules,
): string {
  return campaignRulesPrompt(campaign, rules, { handoffAvailable: true, assets: [] });
}
