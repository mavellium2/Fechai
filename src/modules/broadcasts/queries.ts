import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBroadcastWorkerHealth } from "./health";
import { broadcastFunnel, broadcastFunnelSelect, loadBroadcastAttendance } from "./funnel";
import type { BroadcastTemplate } from "./template";
import { parseLocalDateTime } from "@/modules/scheduling/time";

export type BroadcastFilter = {
  query?: string;
  status?: string;
  /** Período de criação, dias `YYYY-MM-DD` no horário de Brasília (inclusive). */
  from?: string;
  to?: string;
  page?: number;
};

const ZONE = "America/Sao_Paulo";

/** Intervalo `[gte, lt)` em UTC; dia inválido é ignorado, nunca lança. */
export function periodRange(from?: string, to?: string) {
  const day = (value?: string) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? parseLocalDateTime(value, "00:00", ZONE)
      : null;
  const start = day(from);
  const endDay = day(to);
  const end = endDay ? new Date(endDay.getTime() + 24 * 60 * 60 * 1000) : null;
  if (!start && !end) return undefined;
  return { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };
}

const CAMPAIGN_STATUSES = ["draft", "queued", "paused", "completed", "cancelled"];

const summarySelect = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
  error: true,
  scheduledAt: true,
  timezone: true,
  windowStart: true,
  windowEnd: true,
  nextAttemptAt: true,
  confirmedByLabel: true,
  confirmedAt: true,
  finishedAt: true,
  template: true,
  recipients: {
    where: { isTest: false },
    select: broadcastFunnelSelect,
  },
} satisfies Prisma.BroadcastCampaignSelect;

type CampaignRow = Prisma.BroadcastCampaignGetPayload<{
  select: typeof summarySelect;
}>;

/** Contagens de um disparo, sem testes. A mesma conta para a lista e o detalhe. */
function summarize({
  recipients,
  createdAt,
  scheduledAt,
  nextAttemptAt,
  confirmedAt,
  finishedAt,
  template,
  ...campaign
}: CampaignRow, attended?: ReadonlySet<string>) {
  return {
    ...campaign,
    templateName: (template as BroadcastTemplate | null)?.name ?? "",
    createdAt: createdAt.toISOString(),
    scheduledAt: scheduledAt?.toISOString() ?? null,
    nextAttemptAt: nextAttemptAt.toISOString(),
    confirmedAt: confirmedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
    ...broadcastFunnel(recipients, attended),
  };
}

export async function listBroadcastPage(
  tenantId: string,
  filter: BroadcastFilter = {},
) {
  const status = CAMPAIGN_STATUSES.includes(filter.status ?? "")
    ? filter.status
    : undefined;
  const where: Prisma.BroadcastCampaignWhereInput = {
    tenantId,
    ...(filter.query
      ? {
          name: {
            contains: String(filter.query).slice(0, 100),
            mode: "insensitive",
          },
        }
      : {}),
    ...(periodRange(filter.from, filter.to)
      ? { createdAt: periodRange(filter.from, filter.to) }
      : {}),
    // Rascunho descartado (cancelado sem nunca ter sido confirmado) só aparece
    // quando a pessoa filtra por cancelados.
    ...(status
      ? { status }
      : { NOT: { status: "cancelled", confirmedAt: null } }),
  };
  const total = await prisma.broadcastCampaign.count({ where });
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(
    pages,
    Math.max(1, Number.isInteger(filter.page) ? filter.page! : 1),
  );
  const [campaigns, health, active] = await Promise.all([
    prisma.broadcastCampaign.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      skip: (page - 1) * 20,
      select: summarySelect,
    }),
    getBroadcastWorkerHealth(),
    prisma.broadcastCampaign.count({ where: { tenantId, status: "queued" } }),
  ]);
  return { items: campaigns.map((campaign) => summarize(campaign)), page, pages, total, health, active };
}

/** Um disparo da conta, com as mesmas contagens da lista. */
export async function getBroadcastSummary(tenantId: string, id: string) {
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId },
    select: summarySelect,
  });
  if (!campaign) return null;
  return summarize(campaign, await loadBroadcastAttendance(tenantId, campaign.recipients));
}

export async function listBroadcasts(tenantId: string) {
  return (await listBroadcastPage(tenantId)).items;
}
export type BroadcastPage = Awaited<ReturnType<typeof listBroadcastPage>>;
export type BroadcastSummary = BroadcastPage["items"][number];
