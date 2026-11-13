import type { Campaign } from "@prisma/client";
import { dayOf, formatPeriod, zoneOrDefault } from "./period";
import { allowedActions, campaignStatus, type CampaignAllowed, type CampaignStatus } from "./status";

/**
 * A campanha como a tela a recebe: só texto e booleanos, sem `Date` e sem
 * coluna que a tela não usa. O status e o período são calculados UMA vez no
 * servidor, com o mesmo `now` da resposta — componente de cliente nenhum
 * refaz essa conta (e, se refizesse, o relógio do navegador discordaria do
 * servidor perto das fronteiras).
 */
export type CampaignView = {
  id: string;
  name: string;
  objectiveType: string | null;
  objective: string | null;
  description: string | null;
  status: CampaignStatus;
  allowed: CampaignAllowed;
  /** "01/11 a 30/11/2026" */
  period: string;
  /** Dia local em "YYYY-MM-DD" (valor de `<input type="date">`), ou "" sem data. */
  startsOn: string;
  endsOn: string;
  goalValue: number | null;
  goalType: string | null;
  /** Investimento já em texto de formulário ("1500,00"), ou "". */
  budget: string;
  budgetCents: number | null;
  messageCost: string;
  messageCostCents: number | null;
  /** Palavras-chave separadas por vírgula, para o formulário. */
  keywords: string;
};

export type CampaignRow = Pick<
  Campaign,
  | "id"
  | "name"
  | "objectiveType"
  | "objective"
  | "description"
  | "activatedAt"
  | "startsAt"
  | "endsAt"
  | "pausedAt"
  | "archivedAt"
  | "timezone"
  | "goalValue"
  | "goalType"
  | "budgetCents"
  | "messageCostCents"
  | "keywords"
>;

export function toCampaignView(campaign: CampaignRow, now: Date): CampaignView {
  const timeZone = zoneOrDefault(campaign.timezone);
  const status = campaignStatus(campaign, now);
  return {
    id: campaign.id,
    name: campaign.name,
    objectiveType: campaign.objectiveType,
    objective: campaign.objective,
    description: campaign.description,
    status,
    allowed: allowedActions(status),
    period: formatPeriod(campaign.startsAt, campaign.endsAt, timeZone),
    startsOn: dayOf(campaign.startsAt, timeZone),
    endsOn: dayOf(campaign.endsAt, timeZone),
    goalValue: campaign.goalValue,
    goalType: campaign.goalType,
    budget: campaign.budgetCents === null ? "" : (campaign.budgetCents / 100).toFixed(2).replace(".", ","),
    budgetCents: campaign.budgetCents,
    messageCost: campaign.messageCostCents === null ? "" : (campaign.messageCostCents / 100).toFixed(2).replace(".", ","),
    messageCostCents: campaign.messageCostCents,
    keywords: campaign.keywords.join(", "),
  };
}
