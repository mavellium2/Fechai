import { Prisma } from "@prisma/client";
import { PURPOSE_KINDS } from "@/modules/reports/contact-context";

const BATCH_SIZE = 200;

/** Flagra a resposta por autoria, entrada anterior e IDs de envios, sem ler texto. */
export async function fillInitialCrmStages(db: Prisma.TransactionClient, tenantId: string, pipelineId: string) {
  const purposeKeys = PURPOSE_KINDS.map((kind) => Prisma.sql`
    concat('contact-context:', ${tenantId}::text, ':', candidate."conversationId", ':', ${kind}::text, ':', reply.id)
  `);
  const moved = await db.$queryRaw<{ leadId: string; stageId: string }[]>(Prisma.sql`
    WITH candidates AS (
      SELECT lead.id, lead.status, conversation.id AS "conversationId", conversation."needsHuman"
      FROM "Lead" lead
      LEFT JOIN "Conversation" conversation
        ON conversation."leadId" = lead.id AND conversation."tenantId" = lead."tenantId"
      WHERE lead."tenantId" = ${tenantId} AND lead."stageId" IS NULL
        AND NOT lead."isTest" AND NOT COALESCE(conversation."isTest", false)
      ORDER BY lead.id
      LIMIT ${BATCH_SIZE}
      FOR UPDATE OF lead
    ), classified AS (
      SELECT candidate.id, CASE
        WHEN candidate.status = 'scheduled' THEN 'scheduled'
        WHEN candidate.status = 'lost' THEN 'lost'
        WHEN candidate."needsHuman" THEN 'waiting_human'
        WHEN EXISTS (
          SELECT 1 FROM "Message" reply
          WHERE reply."conversationId" = candidate."conversationId"
            AND reply.role = 'assistant' AND reply."sentBy" = 'agent' AND reply."recoveredAt" IS NULL
            AND reply."createdAt" >= (
              SELECT MIN(inbound."createdAt") FROM "Message" inbound
              WHERE inbound."conversationId" = candidate."conversationId"
                AND inbound.role = 'user' AND inbound."recoveredAt" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "ReportEvent" event
              WHERE event."tenantId" = ${tenantId} AND event."conversationId" = candidate."conversationId"
                AND event.kind IN (${Prisma.join(PURPOSE_KINDS)})
                AND event."dedupKey" IN (${Prisma.join(purposeKeys)})
            )
            AND NOT EXISTS (
              SELECT 1 FROM "ReminderDispatch" reminder
              WHERE reminder."tenantId" = ${tenantId} AND reminder."messageId" = reply."whatsappMessageId"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "BroadcastRecipient" recipient
              JOIN "BroadcastCampaign" campaign ON campaign.id = recipient."campaignId"
              WHERE campaign."tenantId" = ${tenantId} AND recipient."whatsappMessageId" = reply."whatsappMessageId"
            )
        ) THEN 'ai'
        ELSE 'new'
      END::"CrmStageKind" AS kind FROM candidates candidate
    )
    UPDATE "Lead" lead SET "stageId" = stage.id
    FROM classified, "PipelineStage" stage
    WHERE lead.id = classified.id AND lead."tenantId" = ${tenantId}
      AND stage."tenantId" = ${tenantId} AND stage."pipelineId" = ${pipelineId}
      AND stage.kind = classified.kind AND stage."archivedAt" IS NULL
    RETURNING lead.id AS "leadId", lead."stageId"
  `);

  if (moved.length) {
    await db.leadTransition.createMany({
      data: moved.map(({ leadId, stageId }) => ({
        tenantId, leadId, dimension: "stage", source: "system", toStageId: stageId, reason: "initial_backfill",
      })),
    });
  }
  return moved.length;
}
