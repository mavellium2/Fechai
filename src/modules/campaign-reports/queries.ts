import { prisma } from "@/lib/prisma";
import { campaignKey, NO_AD_KEY, summarizeCampaigns, type CampaignRow, type CampaignSummary } from "./summary";
import { attendanceOf } from "@/modules/scheduling/dimensions";
import { median } from "@/modules/reports/monthly-operations";

export type CampaignLeadRow = Omit<CampaignRow, "appointments"> & {
  leadId: string;
  appointments: { status: string; createdAt?: Date; attendance?: string | null }[];
};

/**
 * As linhas dos leads criados em [from, to), uma por lead, com o id para a
 * evidência. `agentIds` restringe aos leads das conversas desses agentes;
 * `scheduledBefore` ignora agendamentos criados a partir desse instante (o
 * relatório mensal conta só até o fim do mês).
 */
export async function loadCampaignRows(
  tenantId: string,
  range: { from: Date; to: Date },
  options: { agentIds?: string[] | null; scheduledBefore?: Date; appointmentDetails?: boolean } = {},
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
      appointments: { select: { status: true, createdAt: true, attendance: true } },
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
      .map((a) => options.appointmentDetails ? a : { status: a.status }),
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

/**
 * Lê os leads criados em [from, to) e agrega por anúncio. Só metadados: nenhum
 * nome, telefone ou texto de conversa sai daqui. Conversa de teste fica fora.
 */
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
  adResults?: ReturnType<typeof summarizeAdResults>;
};

function summarizeAdResults(rows: CampaignLeadRow[]) {
  const groups = new Map<string, { attended: number; minutes: number[] }>();
  for (const row of rows) {
    const key = row.origin ? campaignKey(row.origin) : NO_AD_KEY;
    const group = groups.get(key) ?? { attended: 0, minutes: [] };
    const valid = row.appointments.filter((appointment) => appointment.status !== "canceled");
    if (valid.some((appointment) => attendanceOf(appointment) === "attended")) group.attended++;
    let first = Infinity;
    for (const appointment of valid) {
      if (appointment.createdAt && appointment.createdAt >= row.createdAt) {
        first = Math.min(first, appointment.createdAt.getTime());
      }
    }
    if (Number.isFinite(first)) group.minutes.push((first - row.createdAt.getTime()) / 60_000);
    groups.set(key, group);
  }
  const totals = { attended: 0, minutes: [] as number[] };
  for (const group of groups.values()) {
    totals.attended += group.attended;
    for (const minutes of group.minutes) totals.minutes.push(minutes);
  }
  const result = (group: typeof totals) => ({ attended: group.attended, medianMinutes: median(group.minutes) });
  return { groups: new Map([...groups].map(([key, group]) => [key, result(group)])), total: result(totals) };
}

/**
 * O relatório de uma janela, com a anterior de mesmo tamanho para comparar.
 * `trackedSince` diz desde quando existe dado de anúncio: antes disso "sem
 * anúncio identificado" é falta de captura, não de anúncio.
 */
export async function loadCampaignReport(
  tenantId: string,
  range: { from: Date; to: Date },
  options: { previousFrom?: Date | null; now?: Date; appointmentDetails?: boolean } = {},
): Promise<CampaignReport> {
  const now = options.now ?? new Date();
  const [rows, previous, first] = await Promise.all([
    loadCampaignRows(tenantId, range, { appointmentDetails: options.appointmentDetails }),
    options.previousFrom ? loadCampaignSummary(tenantId, { from: options.previousFrom, to: range.from }, now) : null,
    loadCampaignTrackedSince(tenantId),
  ]);
  return {
    current: summarizeCampaigns(rows, now), previous, trackedSince: first,
    ...(options.appointmentDetails ? { adResults: summarizeAdResults(rows) } : {}),
  };
}
