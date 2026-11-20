import { prisma } from "@/lib/prisma";
import { getServiceArea } from "./service-area-store";
import { classifyCity } from "./service-area";
import { leadOutcome, summarizeLeadQuality, type LeadQuality, type LeadRow } from "./summary";
import type { LeadEvidence } from "@/modules/reports/monthly-evidence";
import { contactActivity } from "@/modules/reports/contact-activity";
import { automatedMessageIds, PURPOSE_KINDS } from "@/modules/reports/contact-context";
import { contextEventMessageId } from "@/modules/reports/contact-context-events";
import { loadAutomatedSendEvents } from "@/modules/reports/automated-sends";
import { EMPTY_ASSUMPTIONS, type MonthlyAssumptions } from "@/modules/reports/monthly-config";
import { isAgentEvaluation } from "@/modules/reports/monthly-assumptions";
import { loadHistoricalCities } from "./historical-city-store";

/**
 * Lê os contatos reais que escreveram e foram atendidos na janela [from, to) e agrega. `from: null` é desde
 * o início da conta. `agentIds` restringe às conversas desses agentes (o escopo
 * do relatório mensal). Só metadados: nenhum nome, telefone ou texto de
 * conversa sai daqui — o painel e o relatório mostram agregados.
 */
export async function loadLeadQuality(
  tenantId: string,
  range: { from: Date | null; to: Date },
  options: { agentIds?: string[]; now?: Date; assumptions?: MonthlyAssumptions } = {},
): Promise<LeadQuality> {
  return (await loadLeadQualityDetail(tenantId, range, options)).quality;
}

/**
 * O mesmo agregado e, lead a lead, o que o compôs — para o relatório mensal
 * abrir "273 leads" nos 273 registros. Identificador, datas, cidade e as
 * classificações; nada de nome, telefone ou texto de conversa.
 */
export async function loadLeadQualityDetail(
  tenantId: string,
  range: { from: Date | null; to: Date },
  options: { agentIds?: string[]; now?: Date; assumptions?: MonthlyAssumptions } = {},
): Promise<{ quality: LeadQuality; leads: LeadEvidence[] }> {
  const config = options.assumptions ?? EMPTY_ASSUMPTIONS;
  const inRange = (at: Date) => (!range.from || at >= range.from) && at < range.to;
  const [area, leads] = await Promise.all([
    getServiceArea(tenantId),
    prisma.lead.findMany({
      where: {
        tenantId,
        isTest: false,
        conversation: { isTest: false,
          ...(options.agentIds?.length ? { agentId: { in: options.agentIds } } : {}),
          messages: { some: { role: "user", createdAt: { ...(range.from ? { gte: range.from } : {}), lt: range.to } } },
        },
      },
      select: {
        id: true, createdAt: true, status: true, disqualifiedAt: true, disqualifiedReason: true,
        appointments: { select: { status: true, createdAt: true, source: true, agentId: true, kind: true, serviceType: true } },
        conversation: {
          select: {
            id: true, needsHuman: true, lastInboundAt: true, followUpReason: true,
            reportEvents: { where: { kind: "handoff" }, select: { id: true }, take: 1 },
            insight: { select: { city: true, cityKey: true, firstQuestionKey: true, lossReasonKey: true } },
            messages: { where: { role: { in: ["user", "assistant"] }, createdAt: { ...(range.from ? { gte: range.from } : {}), lt: range.to } },
              select: { id: true, role: true, sentBy: true, createdAt: true, whatsappMessageId: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Lembrete, disparo e follow-up não são resposta: a mesma população de atendidos do mensal.
  const conversationIds = leads.flatMap((lead) => lead.conversation ? [lead.conversation.id] : []);
  const [purposeEvents, sends] = await Promise.all([
    conversationIds.length ? prisma.reportEvent.findMany({
      where: { tenantId, conversationId: { in: conversationIds }, kind: { in: [...PURPOSE_KINDS] } }, select: { kind: true, dedupKey: true },
    }) : [],
    loadAutomatedSendEvents(tenantId, leads.flatMap((lead) => lead.conversation
      ? lead.conversation.messages.map((m) => ({ ...m, conversationId: lead.conversation!.id })) : []), range.from, range.to),
  ]);
  const automated = new Set([...purposeEvents.flatMap((e) => { const id = contextEventMessageId(e.kind, e.dedupKey ?? ""); return id ? [id] : []; }),
    ...automatedMessageIds(sends)]);
  const attended = leads.filter((lead) => contactActivity(lead.conversation?.messages ?? [], automated).replies.length > 0);
  const historical = await loadHistoricalCities(tenantId,
    attended.flatMap((lead) => lead.conversation && !lead.conversation.insight?.cityKey ? [lead.conversation.id] : []), range.to);

  const rows: LeadRow[] = attended.map((lead) => ({
    createdAt: lead.createdAt,
    status: lead.status,
    disqualified: lead.disqualifiedAt !== null,
    disqualifiedReason: lead.disqualifiedReason,
    // Agendou = avaliação marcada pelo agente, não cancelada, criada no período:
    // a regra da coorte do mensal. Consulta antiga, futura ou só da equipe não é
    // resultado desta janela.
    appointments: lead.appointments.filter((a) => a.status !== "canceled" && inRange(a.createdAt) && isAgentEvaluation(a, config)),
    conversation: lead.conversation && {
      needsHuman: lead.conversation.needsHuman,
      lastInboundAt: lead.conversation.lastInboundAt,
      followUpReason: lead.conversation.followUpReason,
      handoffEvents: lead.conversation.reportEvents.length,
    },
    insight: lead.conversation && historical.has(lead.conversation.id)
      ? { ...lead.conversation.insight, city: historical.get(lead.conversation.id)!.city, cityKey: historical.get(lead.conversation.id)!.cityKey,
          firstQuestionKey: lead.conversation.insight?.firstQuestionKey ?? null, lossReasonKey: lead.conversation.insight?.lossReasonKey ?? null }
      : lead.conversation?.insight ?? null,
  }));
  const now = options.now ?? new Date();
  const detail: LeadEvidence[] = rows.map((row, i) => {
    const { outcome, lossKey } = leadOutcome(row, now);
    const cityKey = row.insight?.cityKey ?? null;
    const declaration = historical.get(attended[i].conversation?.id ?? "");
    return { leadId: attended[i].id, conversationId: attended[i].conversation?.id ?? null, createdAt: row.createdAt.toISOString(),
      city: row.insight?.city ?? null, verdict: cityKey ? classifyCity(area, cityKey) : null,
      ...(declaration ? { cityMessageId: declaration.messageId, cityDeclaredAt: declaration.declaredAt.toISOString() } : {}),
      outcome, lossKey, doubtKey: row.insight?.firstQuestionKey ?? null };
  });
  return { quality: { ...summarizeLeadQuality(rows, area, now), acquisition: "not_recorded", suggestions: [] }, leads: detail };
}
