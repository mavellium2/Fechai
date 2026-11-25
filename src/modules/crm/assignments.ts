import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockCrmAdmission } from "./admission";
import { moveLeadToStage } from "./automatic-stage";
import { realBoardLeads } from "./lead-scope";
import { closeHandoffNoticesTimed } from "@/modules/agent-engine/handoff-notice";
import { handoffGroupText, reflectHandoffInGroup, teamMemberName } from "./handoff-panel";
import { recordCrmTrail, secondsBetween } from "./trail";

export type CrmAssignee = { tenantId: string; leadId: string; conversationId: string; userId: string };
export type AssumeResult = "claimed" | "owned" | "assigned_elsewhere" | "unavailable";

/**
 * Atribuição condicional: só a conversa sem responsável muda, na mesma
 * transação do histórico (`ConversationAssignment`). Dois cliques ao mesmo
 * tempo: um vence, o outro recebe `assigned_elsewhere`.
 */
async function assignIfFree(
  db: Prisma.TransactionClient,
  scope: Prisma.ConversationWhereInput,
  { tenantId, conversationId, userId }: { tenantId: string; conversationId: string; userId: string },
) {
  const [conversation, actor] = await Promise.all([
    db.conversation.findFirst({ where: scope, select: { assignedUserId: true } }),
    db.user.findFirst({ where: { id: userId, tenantId, role: "OWNER", usesProduct: true }, select: { id: true } }),
  ]);
  if (!conversation || !actor) return "unavailable" as const;
  if (conversation.assignedUserId === userId) return "owned" as const;
  if (conversation.assignedUserId) return "assigned_elsewhere" as const;

  const assignedAt = new Date();
  const change = await db.conversation.updateMany({
    where: { ...scope, assignedUserId: null },
    data: { assignedUserId: userId, assignedAt, agentPaused: true, needsHuman: false },
  });
  if (!change.count) {
    const current = await db.conversation.findFirst({ where: scope, select: { assignedUserId: true } });
    return current?.assignedUserId === userId ? "owned" as const : "assigned_elsewhere" as const;
  }
  return db.conversationAssignment.create({
    data: { tenantId, conversationId, toUserId: userId, actorUserId: userId, via: "panel", createdAt: assignedAt },
    select: { id: true, createdAt: true },
  });
}

/**
 * Depois de assumir: fecha a espera e, só se havia uma aberta, conta no grupo
 * (o grupo fica sabendo do transbordo de que foi avisado, nunca de uma espera
 * antiga). Um evento `handoff.assumed` na trilha por assunção (CRM-11), com o
 * tempo de espera quando havia uma.
 */
async function finishClaim(tenantId: string, leadId: string, conversationId: string, userId: string, at: Date) {
  const wait = await closeHandoffNoticesTimed(tenantId, conversationId, { status: "assumed", via: "panel", userId }, at);
  await recordCrmTrail({
    tenantId, event: "handoff.assumed", actor: { kind: "user", userId }, leadId,
    meta: { via: "panel", action: "claim", conversationId, waitSeconds: secondsBetween(wait.since, at) },
  });
  if (wait.closed > 0) {
    await reflectHandoffInGroup(tenantId, conversationId, handoffGroupText.assumed(await teamMemberName(tenantId, userId)));
  }
}

/** Assunção do painel. A atribuição e o evento compartilham uma transação. */
export async function claimCrmConversation({ tenantId, leadId, conversationId, userId }: CrmAssignee): Promise<AssumeResult> {
  const result = await prisma.$transaction(async (db) => {
    await lockCrmAdmission(db, tenantId, "shared");
    const scope = { id: conversationId, tenantId, isTest: false, lead: { ...realBoardLeads(tenantId), id: leadId } };
    return assignIfFree(db, scope, { tenantId, conversationId, userId });
  }, { isolationLevel: "ReadCommitted" });
  if (typeof result === "string") return result;
  await finishClaim(tenantId, leadId, conversationId, userId, result.createdAt);
  await moveLeadToStage(tenantId, leadId, "human", "user", {
    userId, conversationId, reason: "human_assumed", key: result.id, at: result.createdAt,
  });
  return "claimed";
}

/**
 * Assumir fora do card (Conversas, resposta pelo painel). Com o CRM ligado é o
 * mesmo `claimCrmConversation`; sem CRM, a mesma atribuição condicional, sem
 * quadro. Conversa de teste não tem responsável (`unavailable`).
 */
export async function assumeConversation({ tenantId, conversationId, userId }: {
  tenantId: string; conversationId: string; userId: string;
}): Promise<AssumeResult> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { leadId: true, isTest: true, tenant: { select: { crmEnabled: true, status: true } } },
  });
  if (!conversation || conversation.isTest) return "unavailable";
  if (conversation.tenant.crmEnabled && conversation.tenant.status === "active") {
    return claimCrmConversation({ tenantId, leadId: conversation.leadId, conversationId, userId });
  }
  const result = await prisma.$transaction(
    (db) => assignIfFree(db, { id: conversationId, tenantId, isTest: false }, { tenantId, conversationId, userId }),
    { isolationLevel: "ReadCommitted" },
  );
  if (typeof result === "string") return result;
  await finishClaim(tenantId, conversation.leadId, conversationId, userId, result.createdAt);
  return "claimed";
}
