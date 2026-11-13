import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { broadcastFunnel, broadcastFunnelSelect, loadBroadcastAttendance } from "@/modules/broadcasts/funnel";
import { broadcastPhoneVariants } from "@/modules/broadcasts/phone";
import { leadOutcome, type LeadOutcome } from "@/modules/lead-insights/summary";
import { median } from "@/modules/reports/monthly-operations";
import { attendanceOf } from "@/modules/scheduling/dimensions";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";
import type { AttributionSource } from "./attribution";

/**
 * Resultados de UMA campanha: os leads dela (`CampaignLead`), o funil, os
 * disparos vinculados, custos e meta. Calculado na leitura, nunca gravado.
 *
 * As regras são as mesmas de Relatórios › Campanhas, sem lógica paralela: o
 * resultado do lead é `leadOutcome` (inteligência de conversas), o comparecimento
 * é `attendanceOf` e o funil dos disparos é `broadcastFunnel` com
 * `loadBroadcastAttendance`. O que muda é o recorte: lá a unidade é o lead
 * criado na janela; aqui, o lead que está na campanha.
 *
 * Teste fica fora. Nada sai daqui para outra conta: toda consulta leva `tenantId`.
 */

export type LeadStage = "new" | "talking" | "qualified" | "scheduled" | "attended";

export const STAGE_ORDER: LeadStage[] = ["new", "talking", "qualified", "scheduled", "attended"];
export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "Novo",
  talking: "Em conversa",
  qualified: "Qualificado",
  scheduled: "Agendado",
  attended: "Compareceu",
};

export type CampaignLeadResult = {
  leadId: string;
  name: string | null;
  phone: string;
  source: AttributionSource;
  assignedAt: Date;
  stage: LeadStage;
  outcome: LeadOutcome;
  conversationId: string | null;
  /** Próxima consulta da campanha, ou a última, para a coluna "agendamento". */
  appointment: { startsAt: Date; canceled: boolean; attendance: string } | null;
};

export type BroadcastLine = {
  id: string;
  name: string;
  status: string;
  confirmedAt: Date | null;
} & ReturnType<typeof broadcastFunnel>;

export type CampaignResults = {
  leads: CampaignLeadResult[];
  funnel: Record<LeadStage, number>;
  outcomes: Record<LeadOutcome, number>;
  bySource: Record<AttributionSource, number>;
  broadcasts: BroadcastLine[];
  broadcastTotals: ReturnType<typeof broadcastFunnel> & { stopped: number; blocked: number };
  /** Centavos; null = não informado. */
  cost: {
    budget: number | null;
    broadcasts: number | null;
    total: number | null;
    perLead: number | null;
    perScheduled: number | null;
    perAttended: number | null;
  };
  goal: { value: number; type: string; reached: number; percent: number } | null;
  /** Minutos (mediana). null = sem base. */
  medianFirstResponseMinutes: number | null;
  medianToScheduleMinutes: number | null;
};

const QUALIFIED_STATUS = new Set(["hot", "scheduled"]);

/** Uma linha por conversa: primeira mensagem do contato desde `since` e a primeira resposta depois dela. */
async function firstResponses(conversationIds: string[], since: Date) {
  if (!conversationIds.length) return new Map<string, { firstIn: Date; firstOut: Date | null }>();
  const rows = await prisma.$queryRaw<{ conversationId: string; firstIn: Date; firstOut: Date | null }[]>`
    SELECT u."conversationId" AS "conversationId",
           MIN(u."createdAt") AS "firstIn",
           (SELECT MIN(a."createdAt") FROM "Message" a
             WHERE a."conversationId" = u."conversationId"
               AND a."role" = 'assistant'
               AND a."createdAt" > MIN(u."createdAt")) AS "firstOut"
      FROM "Message" u
     WHERE u."conversationId" IN (${Prisma.join(conversationIds)})
       AND u."role" = 'user'
       AND u."createdAt" >= ${since}
     GROUP BY u."conversationId"`;
  return new Map(rows.map((row) => [row.conversationId, { firstIn: row.firstIn, firstOut: row.firstOut }]));
}

export async function loadCampaignResults(
  tenantId: string,
  campaign: {
    id: string;
    startsAt: Date | null;
    createdAt: Date;
    budgetCents: number | null;
    messageCostCents: number | null;
    goalValue: number | null;
    goalType: string | null;
  },
  now = new Date(),
): Promise<CampaignResults> {
  const since = campaign.startsAt ?? campaign.createdAt;
  const [links, broadcastRows] = await Promise.all([
    prisma.campaignLead.findMany({
      where: { tenantId, campaignId: campaign.id, lead: { isTest: false } },
      orderBy: { assignedAt: "desc" },
      select: {
        source: true,
        assignedAt: true,
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            createdAt: true,
            status: true,
            disqualifiedAt: true,
            disqualifiedReason: true,
            appointments: {
              where: { tenantId, createdAt: { gte: since } },
              select: { status: true, createdAt: true, startsAt: true, attendance: true },
              orderBy: { startsAt: "asc" },
            },
            conversation: {
              select: {
                id: true,
                needsHuman: true,
                lastInboundAt: true,
                followUpReason: true,
                reportEvents: { where: { kind: "handoff" }, select: { id: true }, take: 1 },
                insight: { select: { city: true, cityKey: true, firstQuestionKey: true, lossReasonKey: true } },
              },
            },
          },
        },
      },
    }),
    prisma.broadcastCampaign.findMany({
      where: { tenantId, campaignId: campaign.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        name: true,
        status: true,
        confirmedAt: true,
        recipients: { where: { isTest: false }, select: { ...broadcastFunnelSelect, phone: true } },
      },
    }),
  ]);

  const conversationIds = links.flatMap((link) => (link.lead.conversation ? [link.lead.conversation.id] : []));
  const responses = await firstResponses(conversationIds, since);

  const funnelAt = { new: 0, talking: 0, qualified: 0, scheduled: 0, attended: 0 } as Record<LeadStage, number>;
  const outcomes: Record<LeadOutcome, number> = { scheduled: 0, handoff: 0, lost: 0, open: 0 };
  const bySource: Record<AttributionSource, number> = { anuncio: 0, disparo: 0, palavra_chave: 0, manual: 0 };
  const responseMinutes: number[] = [];
  const scheduleMinutes: number[] = [];

  const leads: CampaignLeadResult[] = links.map((link) => {
    const lead = link.lead;
    const conversation = lead.conversation;
    const valid = lead.appointments.filter((a) => a.status !== "canceled");
    const attended = valid.some((a) => attendanceOf(a) === "attended");
    const reply = conversation ? responses.get(conversation.id) : undefined;
    const stage: LeadStage = attended
      ? "attended"
      : valid.length
        ? "scheduled"
        : QUALIFIED_STATUS.has(lead.status)
          ? "qualified"
          : reply
            ? "talking"
            : "new";
    for (const step of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage) + 1)) funnelAt[step]++;

    const { outcome } = leadOutcome(
      {
        createdAt: lead.createdAt,
        status: lead.status,
        disqualified: lead.disqualifiedAt !== null,
        disqualifiedReason: lead.disqualifiedReason,
        appointments: lead.appointments.map((a) => ({ status: a.status })),
        conversation: conversation && {
          needsHuman: conversation.needsHuman,
          lastInboundAt: conversation.lastInboundAt,
          followUpReason: conversation.followUpReason,
          handoffEvents: conversation.reportEvents.length,
        },
        insight: conversation?.insight ?? null,
      },
      now,
    );
    outcomes[outcome]++;
    const source = (link.source in bySource ? link.source : "manual") as AttributionSource;
    bySource[source]++;

    if (reply?.firstOut) responseMinutes.push((reply.firstOut.getTime() - reply.firstIn.getTime()) / 60_000);
    const firstBooking = valid.reduce<Date | null>((min, a) => (!min || a.createdAt < min ? a.createdAt : min), null);
    const startedAt = reply?.firstIn ?? link.assignedAt;
    if (firstBooking && firstBooking >= startedAt) scheduleMinutes.push((firstBooking.getTime() - startedAt.getTime()) / 60_000);

    const upcoming = valid.find((a) => a.startsAt >= now) ?? valid.at(-1) ?? lead.appointments.at(-1) ?? null;
    return {
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone.includes(":archived:") ? "" : lead.phone,
      source,
      assignedAt: link.assignedAt,
      stage,
      outcome,
      conversationId: conversation?.id ?? null,
      appointment: upcoming
        ? { startsAt: upcoming.startsAt, canceled: upcoming.status === "canceled", attendance: attendanceOf(upcoming) }
        : null,
    };
  });

  // Disparos vinculados: o mesmo funil de /disparos e de Relatórios › Campanhas.
  const allRecipients = broadcastRows.flatMap((row) => row.recipients);
  const attendedIds = await loadBroadcastAttendance(tenantId, allRecipients);
  const broadcasts: BroadcastLine[] = broadcastRows.map(({ recipients, ...row }) => ({
    ...row,
    ...broadcastFunnel(recipients, attendedIds),
  }));
  const sentPhones = [...new Set(allRecipients.filter((r) => r.status === "sent").map((r) => r.phone))];
  const [stoppedLeads, blockedNumbers] = sentPhones.length
    ? await Promise.all([
        prisma.lead.findMany({
          where: {
            tenantId,
            isTest: false,
            phone: { in: sentPhones.flatMap((phone) => broadcastPhoneVariants(phone)) },
            conversation: { followUpReason: "stop" },
          },
          select: { phone: true },
        }),
        prisma.whatsappBlockedNumber.findMany({
          where: { tenantId, phone: { in: sentPhones.map((phone) => canonicalPhone(phone)).filter(Boolean) } },
          select: { phone: true },
        }),
      ])
    : [[], []];
  const broadcastTotals = {
    ...broadcastFunnel(allRecipients, attendedIds),
    stopped: new Set(stoppedLeads.map((l) => l.phone)).size,
    blocked: blockedNumbers.length,
  };

  const broadcastCost =
    campaign.messageCostCents !== null && broadcastRows.length ? broadcastTotals.sent * campaign.messageCostCents : null;
  const total =
    campaign.budgetCents === null && broadcastCost === null ? null : (campaign.budgetCents ?? 0) + (broadcastCost ?? 0);
  const per = (count: number) => (total !== null && count > 0 ? Math.round(total / count) : null);

  const reachedBy: Record<string, number> = {
    leads: funnelAt.new,
    agendamentos: funnelAt.scheduled,
    comparecimentos: funnelAt.attended,
  };
  const goal =
    campaign.goalValue && campaign.goalType && campaign.goalType in reachedBy
      ? {
          value: campaign.goalValue,
          type: campaign.goalType,
          reached: reachedBy[campaign.goalType],
          percent: Math.round((reachedBy[campaign.goalType] / campaign.goalValue) * 100),
        }
      : null;

  return {
    leads,
    funnel: funnelAt,
    outcomes,
    bySource,
    broadcasts,
    broadcastTotals,
    cost: {
      budget: campaign.budgetCents,
      broadcasts: broadcastCost,
      total,
      perLead: per(funnelAt.new),
      perScheduled: per(funnelAt.scheduled),
      perAttended: per(funnelAt.attended),
    },
    goal,
    medianFirstResponseMinutes: median(responseMinutes),
    medianToScheduleMinutes: median(scheduleMinutes),
  };
}

/**
 * Números da lista de campanhas (leads, agendados, compareceram), numa
 * passada para todas as campanhas da página — sem uma consulta por cartão.
 */
export async function loadCampaignCounts(
  tenantId: string,
  campaigns: { id: string; startsAt: Date | null; createdAt: Date }[],
): Promise<Map<string, { leads: number; scheduled: number; attended: number }>> {
  const result = new Map<string, { leads: number; scheduled: number; attended: number }>();
  if (!campaigns.length) return result;
  const links = await prisma.campaignLead.findMany({
    where: { tenantId, campaignId: { in: campaigns.map((c) => c.id) }, lead: { isTest: false } },
    select: {
      campaignId: true,
      lead: { select: { appointments: { where: { tenantId, status: { not: "canceled" } }, select: { createdAt: true, status: true, attendance: true } } } },
    },
  });
  const since = new Map(campaigns.map((c) => [c.id, c.startsAt ?? c.createdAt]));
  for (const campaign of campaigns) result.set(campaign.id, { leads: 0, scheduled: 0, attended: 0 });
  for (const link of links) {
    const row = result.get(link.campaignId)!;
    const from = since.get(link.campaignId)!;
    const valid = link.lead.appointments.filter((a) => a.createdAt >= from);
    row.leads++;
    if (valid.length) row.scheduled++;
    if (valid.some((a) => attendanceOf(a) === "attended")) row.attended++;
  }
  return result;
}
