import type { CrmStageKind, Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCrmAccess } from "./access";
import {
  CRM_ASSIGNEE_NONE, CRM_ASSIGNEE_UNIDENTIFIED, CRM_COLUMN_SIZE, crmColumnPage, readCrmFilters, type CrmSearchParams,
} from "./board-filters";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";
import { activeCrm, realBoardLeads } from "./lead-scope";
import { crmOriginLabel } from "./lead-origin";

const activity = { role: { in: ["user", "assistant"] } };

/**
 * Responsável é o da conversa (`Conversation.assignedUserId`). "Sem responsável" e
 * "humano não identificado" não se sobrepõem: o segundo é o lead em atendimento
 * humano (alguém respondeu pelo celular ou WhatsApp Web) sem pessoa atribuída.
 */
function assigneeWhere(tenantId: string, assignee: string): Prisma.LeadWhereInput | null {
  if (!assignee) return null;
  const unassigned: Prisma.LeadWhereInput = { OR: [
    { conversation: null }, { conversation: { is: { tenantId, assignedUserId: null } } },
  ] };
  const human: Prisma.LeadWhereInput = { stage: { is: { tenantId, kind: "human" } } };
  if (assignee === CRM_ASSIGNEE_UNIDENTIFIED) return { AND: [unassigned, human] };
  if (assignee === CRM_ASSIGNEE_NONE) return { AND: [unassigned, { NOT: human }] };
  return { conversation: { is: { tenantId, assignedUserId: assignee } } };
}

export function crmBoardWhere(tenantId: string, filters: ReturnType<typeof readCrmFilters>): Prisma.LeadWhereInput {
  const where = realBoardLeads(tenantId);
  const and: Prisma.LeadWhereInput[] = [];
  if (filters.stages.length) where.stageId = { in: filters.stages };
  if (filters.tags.length) where.leadTags = { some: { tenantId, tagId: { in: filters.tags } } };
  const anyOf = (clauses: Prisma.LeadWhereInput[]) => { if (clauses.length) and.push(clauses.length === 1 ? clauses[0] : { OR: clauses }); };
  anyOf(filters.assignees.flatMap((assignee) => assigneeWhere(tenantId, assignee) ?? []));
  anyOf(filters.origins.map((origin): Prisma.LeadWhereInput =>
    origin === "anuncio" ? { OR: [{ originChannel: "ad" }, { originChannel: null, adOrigin: { is: { tenantId } } }] }
      : origin === "desconhecida" ? { originChannel: null, adOrigin: { isNot: { tenantId } } }
        : { originChannel: origin }));
  if (and.length) where.AND = and;
  if (filters.invalidRange) return { ...where, id: { in: [] } };

  const { range } = filters;
  if (!range.gte && !range.lt) return where;
  if (filters.basis === "entrada") return { ...where, createdAt: range };

  return {
    ...where,
    AND: [...and, { OR: [
      { conversation: { is: { tenantId, messages: {
        some: { ...activity, createdAt: range },
        ...(range.lt ? { none: { ...activity, createdAt: { gte: range.lt } } } : {}),
      } } } },
      { createdAt: range, OR: [
        { conversation: null }, { conversation: { is: { tenantId, messages: { none: activity } } } },
      ] },
    ] }],
  };
}

function cardSelect(tenantId: string) {
  return {
    id: true, stageId: true, name: true, phone: true, originChannel: true,
    adOrigin: { select: { tenantId: true } },
    conversation: { select: { tenantId: true, assignedUserId: true } },
    leadTags: { where: { tenantId }, orderBy: { tag: { name: "asc" } }, take: 4,
      select: { tag: { select: { id: true, name: true } } } },
    transitions: {
      where: { tenantId, dimension: "stage" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1,
      select: { createdAt: true, toStageId: true },
    },
  } satisfies Prisma.LeadSelect;
}

type CardContext = { tenantId: string; stageKind: CrmStageKind | null; userNames: Map<string, string> };

function cardAssignee(ctx: CardContext, row: Prisma.LeadGetPayload<{ select: ReturnType<typeof cardSelect> }>) {
  const userId = row.conversation?.tenantId === ctx.tenantId ? row.conversation.assignedUserId : null;
  if (userId) return { kind: "user" as const, label: ctx.userNames.get(userId) ?? "Pessoa da equipe" };
  if (ctx.stageKind === "human") return { kind: "unidentified" as const, label: "Humano não identificado" };
  return { kind: "none" as const, label: "Sem responsável" };
}

function boardCard(ctx: CardContext, row: Prisma.LeadGetPayload<{ select: ReturnType<typeof cardSelect> }>) {
  const { tenantId } = ctx;
  const digits = row.phone.replace(/\D/g, "");
  const change = row.transitions[0];
  return {
    id: row.id, stageId: row.stageId, name: row.name?.trim() || "Contato sem nome",
    phone: digits.length >= 7 ? `•••• ${digits.slice(-4)}` : "Telefone oculto",
    origin: crmOriginLabel(row.originChannel, row.adOrigin?.tenantId === tenantId),
    tags: row.leadTags.map(({ tag }) => tag),
    assignee: cardAssignee(ctx, row),
    stageSince: change?.toStageId === row.stageId ? change?.createdAt.toISOString() ?? null : null,
  };
}

export type CrmBoardCard = ReturnType<typeof boardCard>;

export async function getCrmBoard(params: CrmSearchParams) {
  const tenantId = await requireCrmAccess();
  const observedAt = Date.now();
  const pipeline = await prisma.pipeline.findUnique({
    where: { tenantId_key: { tenantId, key: DEFAULT_PIPELINE_KEY }, tenant: activeCrm },
    select: { name: true, stages: { where: { tenantId, archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, name: true, kind: true } } },
  });
  if (!pipeline) notFound();

  const filters = readCrmFilters(params);
  const where = crmBoardWhere(tenantId, filters);
  const users = await listCrmUsers(tenantId);
  const userNames = new Map(users.map(({ id, name }) => [id, name]));
  const stages = pipeline.stages.filter((stage) => !filters.stages.length || filters.stages.includes(stage.id));
  const counts = await prisma.lead.groupBy({ by: ["stageId"], where, _count: { _all: true } });
  const totals = new Map(counts.map((item) => [item.stageId, item._count._all]));
  const columns = await Promise.all(stages.map(async (stage) => {
    const total = totals.get(stage.id) ?? 0;
    const page = crmColumnPage(params, stage.id, total);
    const rows = total ? await prisma.lead.findMany({
      where: { ...where, stageId: stage.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * CRM_COLUMN_SIZE, take: CRM_COLUMN_SIZE, select: cardSelect(tenantId),
    }) : [];
    return { ...stage, page, total, cards: rows.map((row) => boardCard({ tenantId, stageKind: stage.kind, userNames }, row)) };
  }));
  return { pipeline, filters, columns, users, observedAt };
}

/** Pessoas da conta que podem ser responsáveis. Só id e nome, para o filtro e o card. */
export async function listCrmUsers(tenantId: string) {
  const rows = await prisma.user.findMany({
    where: { tenantId, role: "OWNER", usesProduct: true },
    orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true },
  });
  return rows.map(({ id, name, email }) => ({ id, name: name?.trim() || email.split("@")[0] || "Pessoa da equipe" }));
}
