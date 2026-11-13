import { prisma } from "@/lib/prisma";
import type { LeadCampaign } from "./active";

/**
 * O agente da campanha atende o lead dela enquanto a campanha vale
 * (`Campaign.agentId`). Devolve o id só se o agente ainda existe nesta conta,
 * não está arquivado e está ligado; senão `null`, e o turno segue com o agente
 * de sempre — desligar a cópia é um jeito válido de "devolver" os leads.
 * Nunca lança.
 */
export async function campaignAgentFor(tenantId: string, campaign: LeadCampaign | null | undefined): Promise<string | null> {
  const agentId = campaign?.campaign.agentId;
  if (!agentId) return null;
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, tenantId, archived: false, enabled: true },
      select: { id: true },
    });
    return agent?.id ?? null;
  } catch (err) {
    console.error("[campanhas] agente da campanha indisponível", err);
    return null;
  }
}
