import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { dayKeyInZone, parseLocalDateTime } from "@/modules/scheduling/time";
import { requireCrmAccess } from "./access";
import { realBoardLeads } from "./lead-scope";
import { CRM_TIME_ZONE, validCrmId } from "./board-filters";
import { crmWhatsappReplyTarget } from "./whatsapp-reply";

const historyRoles = { in: ["user", "assistant"] };
const MESSAGE_PAGE_SIZE = 40;
export const CRM_REMINDER_LIMIT = 8;

export function listCrmTags(tenantId: string) {
  return prisma.tag.findMany({ where: { tenantId }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
}

export async function getCrmLeadDetail(id: string, before?: string) {
  const tenantId = await requireCrmAccess();
  const lead = await prisma.lead.findFirst({
    where: { ...realBoardLeads(tenantId), id },
    select: {
      id: true, name: true, whatsappName: true, nameEditedAt: true, phone: true, createdAt: true, disqualifiedReason: true, originChannel: true,
      stage: { select: { name: true, kind: true } },
      adOrigin: { select: { tenantId: true, code: true, name: true } },
      leadTags: { where: { tenantId }, select: { tagId: true } },
      tasks: {
        where: { tenantId },
        orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }, { id: "asc" }],
        select: { id: true, text: true, dueAt: true, assignedUserId: true, completedAt: true },
      },
      conversation: { select: {
        id: true, summary: true, summaryAt: true, summaryMsgCount: true, variables: true, editedVariables: true, assignedUserId: true, assignedAt: true, agentPaused: true, needsHuman: true,
        // Quem assumiu pelo grupo sem estar ligado a ninguém da equipe (CRM-08).
        handoffNotices: { where: { status: "assumed", assignedUserId: null, assumedByPhone: { not: null } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { assumedByPhone: true } },
        agent: { select: { tenantId: true, variableDefinitions: true } },
        messages: { where: { role: historyRoles }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { createdAt: true } },
        insight: { select: { tenantId: true, city: true, procedure: true, lossReasonKey: true, lossReasonText: true } },
        assignments: {
          where: { tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
          select: { id: true, toUserId: true, fromUserId: true, via: true, createdAt: true },
        },
        reportEvents: {
          where: { tenantId, kind: "handoff" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
          select: { id: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      } },
      transitions: {
        where: { tenantId, dimension: "stage" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
        select: { id: true, createdAt: true, source: true, reason: true, lossReasonLabel: true, lossReasonNote: true,
          fromStage: { select: { name: true } }, toStage: { select: { name: true, kind: true } } },
      },
    },
  });
  if (!lead) notFound();

  const [tags, users, history, broadcast, reply, lastHumanReply, handoff, trail] = await Promise.all([
    listCrmTags(tenantId),
    prisma.user.findMany({ where: { tenantId, role: "OWNER", usesProduct: true }, orderBy: { email: "asc" }, select: { id: true, name: true, email: true } }),
    lead.conversation ? readMessages(tenantId, lead.conversation.id, before) : null,
    lead.conversation ? readBroadcastResponse(tenantId, lead.conversation.id) : null,
    lead.conversation ? crmWhatsappReplyTarget(tenantId, lead.id, lead.conversation.id) : null,
    // CRM-09: a última resposta da equipe foi pelo celular e ninguém se identificou?
    lead.conversation ? prisma.message.findFirst({
      where: { conversationId: lead.conversation.id, conversation: { tenantId }, role: "assistant", sentBy: "human" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { sentVia: true, sentByUserId: true },
    }) : null,
    lead.conversation ? readHandoffTimes(tenantId, lead.conversation.id) : null,
    readLeadTrail(tenantId, lead.id),
  ]);

  return {
    ...lead,
    adOrigin: lead.adOrigin?.tenantId === tenantId ? lead.adOrigin : null,
    insight: lead.conversation?.insight?.tenantId === tenantId ? lead.conversation.insight : null,
    variableDefinitions: lead.conversation?.agent?.tenantId === tenantId ? lead.conversation.agent.variableDefinitions : null,
    tags, users, history, broadcast, lastHumanReply, handoff, trail,
    reply: reply ? { status: reply.status, templates: reply.templates } : null,
  };
}

/**
 * Linha do tempo do card (CRM-11): os eventos da trilha deste lead. Mudança de
 * etapa não entra aqui: ela vem do histórico de etapas (`LeadTransition`).
 */
const TRAIL_TIMELINE_EVENTS = [
  "handoff.requested", "handoff.assumed", "handoff.transferred", "handoff.returned_to_ai", "handoff.sla_alerted",
  "crm.tag_changed", "crm.task_changed", "crm.contact_edited",
];

function readLeadTrail(tenantId: string, leadId: string) {
  return prisma.auditLog.findMany({
    where: { tenantId, targetType: "Lead", targetId: leadId, event: { in: TRAIL_TIMELINE_EVENTS } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30,
    select: { id: true, event: true, actorId: true, actorRole: true, meta: true, createdAt: true },
  });
}

/**
 * O transbordo mais recente e seus tempos (CRM-10): quando começou a esperar,
 * quando alguém assumiu, se foi escalonado e a 1ª resposta humana depois dele.
 */
async function readHandoffTimes(tenantId: string, conversationId: string) {
  const notice = await prisma.handoffNotice.findFirst({
    where: { tenantId, conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, status: true, assumedAt: true, escalatedAt: true },
  });
  if (!notice) return null;
  const firstReply = await prisma.message.findFirst({
    where: { conversationId, conversation: { tenantId }, role: "assistant", sentBy: "human", createdAt: { gte: notice.createdAt } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { createdAt: true },
  });
  return { ...notice, firstReplyAt: firstReply?.createdAt ?? null };
}

async function readBroadcastResponse(tenantId: string, conversationId: string) {
  const recipient = await prisma.broadcastRecipient.findFirst({
    where: { campaign: { tenantId }, conversationId, status: "sent", isTest: false, repliedAt: { not: null }, firstReplyMessageId: { not: null } },
    orderBy: [{ repliedAt: "desc" }, { id: "desc" }],
    select: { repliedAt: true, firstReplyMessageId: true, campaign: { select: { name: true } } },
  });
  if (!recipient?.firstReplyMessageId || !recipient.repliedAt) return null;
  const reply = await prisma.message.findFirst({
    where: { conversationId, conversation: { tenantId, isTest: false }, role: "user", whatsappMessageId: recipient.firstReplyMessageId },
    select: { id: true },
  });
  return reply ? { name: recipient.campaign.name, repliedAt: recipient.repliedAt } : null;
}

async function readMessages(tenantId: string, conversationId: string, before?: string) {
  const where = { conversationId, conversation: { tenantId, isTest: false }, role: historyRoles };
  const cursor = validCrmId(before)
    ? await prisma.message.findFirst({ where: { ...where, id: before }, select: { createdAt: true, id: true } })
    : null;
  if (before && !cursor) notFound();
  const messages = await prisma.message.findMany({
    where: { ...where, ...(cursor && { OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ] }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE_SIZE + 1,
    select: { id: true, role: true, content: true, sentBy: true, sentVia: true, sentByUserId: true, audioUrl: true, createdAt: true },
  });
  const page = messages.slice(0, MESSAGE_PAGE_SIZE).reverse();
  return { messages: page, before: messages.length > MESSAGE_PAGE_SIZE ? page[0]?.id : undefined };
}

export function listCrmReminders(tenantId: string, now: Date) {
  const today = dayKeyInZone(now, CRM_TIME_ZONE);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const end = parseLocalDateTime(tomorrow.toISOString().slice(0, 10), "00:00", CRM_TIME_ZONE);
  return prisma.leadTask.findMany({
    where: { tenantId, completedAt: null, dueAt: { lt: end ?? now }, lead: realBoardLeads(tenantId) },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: CRM_REMINDER_LIMIT + 1,
    select: { id: true, text: true, dueAt: true, lead: { select: { id: true, name: true } } },
  });
}
