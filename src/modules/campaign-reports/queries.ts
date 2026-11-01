import { prisma } from "@/lib/prisma";
import { summarizeCampaigns, type CampaignRow, type CampaignSummary } from "./summary";

/**
 * Lê os leads criados em [from, to) e agrega por anúncio. Só metadados: nenhum
 * nome, telefone ou texto de conversa sai daqui. Conversa de teste fica fora.
 */
export type CampaignLeadRow = CampaignRow & { leadId: string };

/**
 * As linhas dos leads criados em [from, to), uma por lead, com o id para a
 * evidência. `agentIds` restringe aos leads das conversas desses agentes;
 * `scheduledBefore` ignora agendamentos criados a partir desse instante (o
 * relatório mensal conta só até o fim do mês).
 */
export async function loadCampaignRows(
  tenantId: string,
  range: { from: Date; to: Date },
  options: { agentIds?: string[] | null; scheduledBefore?: Date } = {},
): Promise<CampaignLeadRow[]> {
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      isTest: false,
      createdAt: { gte: range.from, lt: range.to },
      conversation: { isTest: false, ...(options.agentIds?.length ? { agentId: { in: options.agentIds } } : {}) },
    },
    select: {
      id: true,
      createdAt: true,
      status: true,
      disqualifiedAt: true,
      disqualifiedReason: true,
      appointments: { select: { status: true, createdAt: true } },
      adOrigin: { select: { sourceId: true, code: true, name: true } },
      conversation: {
        select: {
          needsHuman: true,
          lastInboundAt: true,
          followUpReason: true,
          reportEvents: { where: { kind: "handoff" }, select: { id: true }, take: 1 },
          insight: { select: { city: true, cityKey: true, firstQuestionKey: true, lossReasonKey: true } },
        },
      },
    },
  });

  const before = options.scheduledBefore;
  return leads.map((lead) => ({
    leadId: lead.id,
    createdAt: lead.createdAt,
    status: lead.status,
    disqualified: lead.disqualifiedAt !== null,
    disqualifiedReason: lead.disqualifiedReason,
    appointments: lead.appointments
      .filter((a) => !before || a.createdAt < before)
      .map((a) => ({ status: a.status })),
    conversation: lead.conversation && {
      needsHuman: lead.conversation.needsHuman,
      lastInboundAt: lead.conversation.lastInboundAt,
      followUpReason: lead.conversation.followUpReason,
      handoffEvents: lead.conversation.reportEvents.length,
    },
    insight: lead.conversation?.insight ?? null,
    origin: lead.adOrigin,
  }));
}

/** Desde quando existe captura de anúncio na conta; null = nunca registrou nenhum. */
export async function loadCampaignTrackedSince(tenantId: string): Promise<Date | null> {
  const first = await prisma.leadAdOrigin.aggregate({ where: { tenantId }, _min: { firstAdAt: true } });
  return first._min.firstAdAt;
}

export async function loadCampaignSummary(
  tenantId: string,
  range: { from: Date; to: Date },
  now = new Date(),
): Promise<CampaignSummary> {
  return summarizeCampaigns(await loadCampaignRows(tenantId, range), now);
}

export type CampaignReport = {
  current: CampaignSummary;
  previous: CampaignSummary | null;
  /** Primeiro anúncio já capturado na conta; null = a conta nunca registrou nenhum. */
  trackedSince: Date | null;
};

/**
 * O relatório de uma janela, com a anterior de mesmo tamanho para comparar.
 * `trackedSince` diz desde quando existe dado de anúncio: antes disso "sem
 * anúncio identificado" é falta de captura, não de anúncio.
 */
export async function loadCampaignReport(
  tenantId: string,
  range: { from: Date; to: Date },
  options: { previousFrom?: Date | null; now?: Date } = {},
): Promise<CampaignReport> {
  const now = options.now ?? new Date();
  const [current, previous, first] = await Promise.all([
    loadCampaignSummary(tenantId, range, now),
    options.previousFrom ? loadCampaignSummary(tenantId, { from: options.previousFrom, to: range.from }, now) : null,
    prisma.leadAdOrigin.aggregate({ where: { tenantId }, _min: { firstAdAt: true } }),
  ]);
  return { current, previous, trackedSince: first._min.firstAdAt };
}
