import { prisma } from "@/lib/prisma";
import { isSecretField, REDACTED } from "@/modules/audit/redact";
import { getClinicorpStatus } from "@/modules/scheduling/clinicorp";

const PAGE_SIZE = 500;

/** Mesma proteção da auditoria, sem cortar textos, listas ou configurações. */
export function exportJson(value: unknown): string {
  return JSON.stringify(value, (key, item) => {
    if (isSecretField(key)) return REDACTED;
    return typeof item === "bigint" ? item.toString() : item;
  });
}

type Row = { id: string };
type Source = { name: string; read: (cursor?: string) => Promise<Row[]> };
const page = (cursor?: string) => ({
  take: PAGE_SIZE,
  orderBy: { id: "asc" as const },
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

/** Só chamar após autenticar SUPERADMIN. Todas as coleções são limitadas ao tenant. */
export async function prepareTenantExport(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, omit: { crmActivationToken: true } });
  if (!tenant) return null;

  const sources: Source[] = [
    { name: "users", read: (cursor) => prisma.user.findMany({ where: { tenantId }, omit: { passwordHash: true }, include: { affiliate: true }, ...page(cursor) }) },
    { name: "agents", read: (cursor) => prisma.agent.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "actions", read: (cursor) => prisma.tenantAction.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "knowledgeDocuments", read: (cursor) => prisma.knowledgeDocument.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "knowledgeChunks", read: (cursor) => prisma.knowledgeChunk.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "leads", read: (cursor) => prisma.lead.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "pipelines", read: (cursor) => prisma.pipeline.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "pipelineStages", read: (cursor) => prisma.pipelineStage.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "leadTransitions", read: (cursor) => prisma.leadTransition.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "tags", read: (cursor) => prisma.tag.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "leadTags", read: (cursor) => prisma.leadTag.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "leadTasks", read: (cursor) => prisma.leadTask.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "conversations", read: (cursor) => prisma.conversation.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "conversationAssignments", read: (cursor) => prisma.conversationAssignment.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "handoffNotices", read: (cursor) => prisma.handoffNotice.findMany({ where: { tenantId }, ...page(cursor) }) },
    // O hash do código de confirmação não sai: é credencial de uso único.
    { name: "teamMemberWhatsapps", read: (cursor) => prisma.teamMemberWhatsapp.findMany({ where: { tenantId }, omit: { codeHash: true }, ...page(cursor) }) },
    { name: "messages", read: (cursor) => prisma.message.findMany({ where: { conversation: { tenantId } }, ...page(cursor) }) },
    { name: "appointments", read: (cursor) => prisma.appointment.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "blockedNumbers", read: (cursor) => prisma.whatsappBlockedNumber.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "feedbacks", read: (cursor) => prisma.feedback.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "leadValues", read: (cursor) => prisma.tenantLeadValue.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "attendanceCosts", read: (cursor) => prisma.tenantAttendanceCost.findMany({ where: { tenantId }, ...page(cursor) }) },
    { name: "referrals", read: (cursor) => prisma.referral.findMany({ where: { tenantId }, include: { commissions: true }, ...page(cursor) }) },
    { name: "auditLogs", read: (cursor) => prisma.auditLog.findMany({ where: { tenantId }, ...page(cursor) }) },
  ];

  async function* chunks() {
    const [whatsapp, calendar, calendarFeatures, clinicorp] = await Promise.all([
      // Uma linha por conexão (QR e API oficial); `integrations.whatsapp` é uma lista desde a versão 2.
      prisma.whatsappInstance.findMany({ where: { tenantId }, orderBy: { provider: "asc" }, omit: { metaAccessTokenEncrypted: true, metaAppSecretEncrypted: true, metaVerifyTokenEncrypted: true } }),
      prisma.calendarIntegration.findUnique({ where: { tenantId }, omit: { accessToken: true, refreshToken: true } }),
      prisma.calendarFeatures.findUnique({ where: { tenantId } }),
      getClinicorpStatus(tenantId),
    ]);
    yield "{\n\"metadata\":" + exportJson({
      format: "fechai-tenant-export", version: 2, exportedAt: new Date().toISOString(),
      tenantId, timezoneForDates: "UTC (ISO 8601); fusos de atendimento estão nas configurações",
      notes: [
        "Inclui todo o histórico disponível no banco, inclusive testes e registros arquivados, sem limite de quantidade.",
        "Senhas, tokens, chaves, sessões de autenticação e vetores de embeddings não são exportados.",
        "Áudios e arquivos originais são referenciados por URL; seu conteúdo binário não está incorporado.",
        "Agenda externa e logs do servidor não são consultados. Dados podem mudar durante a leitura.",
        "Dados de outras contas indicadas por afiliados não fazem parte desta exportação.",
      ],
    });
    yield ',\n"tenant":' + exportJson(tenant);
    yield ',\n"integrations":' + exportJson({ whatsapp, calendar, calendarFeatures, clinicorp });
    const counts: Record<string, number> = {};
    for (const source of sources) {
      yield `,\n${JSON.stringify(source.name)}:[`;
      let cursor: string | undefined;
      let count = 0;
      while (true) {
        const rows = await source.read(cursor);
        for (const row of rows) {
          yield (count++ ? ",\n" : "\n") + exportJson(row);
        }
        if (rows.length < PAGE_SIZE) break;
        cursor = rows.at(-1)!.id;
      }
      counts[source.name] = count;
      yield "\n]";
    }
    yield ',\n"counts":' + exportJson(counts) + ',\n"completed":true\n}';
  }

  return { tenant, chunks };
}
