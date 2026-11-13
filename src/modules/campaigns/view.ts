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
  objective: string | null;
  status: CampaignStatus;
  allowed: CampaignAllowed;
  /** "01/11 a 30/11/2026" */
  period: string;
  /** Dia local em "YYYY-MM-DD" (valor de `<input type="date">`), ou "" sem data. */
  startsOn: string;
  endsOn: string;
};

export type CampaignRow = Pick<
  Campaign,
  "id" | "name" | "objective" | "startsAt" | "endsAt" | "pausedAt" | "archivedAt" | "timezone"
>;

export function toCampaignView(campaign: CampaignRow, now: Date): CampaignView {
  const timeZone = zoneOrDefault(campaign.timezone);
  const status = campaignStatus(campaign, now);
  return {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    status,
    allowed: allowedActions(status),
    period: formatPeriod(campaign.startsAt, campaign.endsAt, timeZone),
    startsOn: dayOf(campaign.startsAt, timeZone),
    endsOn: dayOf(campaign.endsAt, timeZone),
  };
}
