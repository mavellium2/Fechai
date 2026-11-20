import { contactActivity, resolutionOf, type ActivityMessage, type Resolution } from "./contact-activity";

export const CONTACT_CONTEXT_LABEL = {
  inbound_new: "Novos contatos que iniciaram a conversa",
  inbound_existing: "Contatos da base que voltaram a escrever",
  outbound_human: "Abordagens iniciadas pela equipe",
  outbound_agent: "Abordagens iniciadas pelo agente",
  outbound_campaign: "Abordagens de campanha",
  outbound_followup: "Retomadas automáticas",
  outbound_reminder: "Lembretes de consultas",
  continued: "Atendimentos em continuidade do período anterior",
  unknown: "Contexto não identificado",
} as const;
export type ContactContext = keyof typeof CONTACT_CONTEXT_LABEL;
/**
 * Conversas que o paciente começou: a única base da resolução autônoma. Abordagem
 * da equipe, campanha, lembrete e follow-up ficam fora (a conversa nasceu de nós),
 * e continuidade do período anterior também (quem começou não está nesta janela).
 */
export const PATIENT_CONTEXTS: readonly ContactContext[] = ["inbound_new", "inbound_existing"];
/** Operações que registram a finalidade pelo id da mensagem (`contact-context-events.ts`). */
export const PURPOSE_KINDS = ["contact_reminder", "contact_campaign", "contact_followup"] as const;
const purposeKinds = new Set<string>(PURPOSE_KINDS);
export type ContextMessage = ActivityMessage & { id?: string; contactCreatedAt?: Date; beforeWindow?: ActivityMessage & { id?: string } };
export type ContextContact = { id: string; messages: readonly ContextMessage[]; firstMessage?: ContextMessage | null };
export type ContextEvent = { kind: string; conversationId: string; messageId?: string; createdAt: Date };
export type ContextBooking = { id: string; conversationId: string | null; createdAt: Date };
export type ContactContextEvidence = {
  conversationId: string; context: ContactContext; firstAt: string; firstMessageId: string | null;
  lifetimeInitiator: "contact" | "human" | "agent" | "unknown";
  attended: boolean; booked: boolean; appointmentIds: string[];
  /** Ausente em snapshot anterior à divisão; null = não atendido. */
  resolution?: Resolution | null;
};
export type ResolutionCounts = { aiOnly: number; aiAndHuman: number; humanOnly: number };
export type AutonomySummary = ResolutionCounts & {
  /** Conversas iniciadas pelo paciente e respondidas: só IA + IA e humano + só humano. */
  base: number;
  /** Só IA ÷ base, uma casa decimal; null sem base. */
  percent: number | null;
};
export type ContactContextSummary = {
  active: number; attended: number; attributedEvaluations: number; unattributedEvaluations: number;
  /** Inbound does not prove paid traffic; an old contact does not prove a qualified clinic list. */
  acquisition: "not_recorded";
  groups: ({ key: ContactContext; label: string; contacts: number; attended: number; scheduledContacts: number;
    evaluations: number; conversionPercent: number | null } & Partial<ResolutionCounts>)[];
  /** Resolução autônoma só sobre o que o paciente iniciou. Ausente em snapshot anterior. */
  autonomy?: AutonomySummary;
};

/** Ids das mensagens enviadas por operação registrada (lembrete, disparo, follow-up). */
export function automatedMessageIds(events: readonly ContextEvent[] | undefined): Set<string> {
  return new Set((events ?? []).flatMap((e) => e.messageId && purposeKinds.has(e.kind) ? [e.messageId] : []));
}

export function autonomyOf(counts: ResolutionCounts): AutonomySummary {
  const base = counts.aiOnly + counts.aiAndHuman + counts.humanOnly;
  return { ...counts, base, percent: base ? Math.round(counts.aiOnly / base * 1000) / 10 : null };
}

/** Same pass as all other metrics. No text classification or assumed acquisition channel. */
export function summarizeContactContexts(input: {
  start: Date | null; end: Date; conversations: readonly ContextContact[]; bookings: readonly ContextBooking[]; events?: readonly ContextEvent[];
}): { summary: ContactContextSummary; records: ContactContextEvidence[] } {
  const inside = (at: Date) => (!input.start || at >= input.start) && at < input.end;
  const eventByMessage = new Map((input.events ?? []).filter((e) => e.messageId && e.createdAt < input.end)
    .map((e) => [`${e.conversationId}:${e.messageId}`, e.kind]));
  const automated = automatedMessageIds(input.events);
  const handoffs = new Map<string, number>();
  for (const e of input.events ?? []) if (e.kind === "handoff" && inside(e.createdAt)) handoffs.set(e.conversationId, (handoffs.get(e.conversationId) ?? 0) + 1);
  const records: ContactContextEvidence[] = [];
  const arrivals = new Map<string, Date>();
  for (const c of input.conversations) {
    const activity = contactActivity(c.messages.filter((m) => inside(m.createdAt)), automated);
    const first = activity.messages[0];
    if (!first) continue;
    const lifetime = c.firstMessage;
    const lifetimeInitiator = lifetime?.role === "user" ? "contact" : lifetime?.sentBy === "human" ? "human"
      : lifetime?.sentBy === "agent" ? "agent" : "unknown";
    let context: ContactContext = "unknown";
    const preceding = lifetime?.beforeWindow;
    const continued = preceding && first.createdAt >= preceding.createdAt && +first.createdAt - +preceding.createdAt <= 24 * 3600_000;
    const purpose = first.role === "assistant" && first.id ? eventByMessage.get(`${c.id}:${first.id}`) : undefined;
    if (purpose === "contact_reminder") context = "outbound_reminder";
    else if (purpose === "contact_campaign") context = "outbound_campaign";
    else if (purpose === "contact_followup") context = "outbound_followup";
    else if (continued) context = "continued";
    else if (first.role === "user" && lifetime && lifetime.createdAt <= first.createdAt) {
      context = lifetime.role === "user" && inside(lifetime.createdAt)
        && (!lifetime.contactCreatedAt || inside(lifetime.contactCreatedAt)) ? "inbound_new" : "inbound_existing";
    } else if (first.role === "assistant") {
      context = first.sentBy === "human" ? "outbound_human" : first.sentBy === "agent" ? "outbound_agent" : "unknown";
    }
    if (activity.first) arrivals.set(c.id, activity.first.createdAt);
    records.push({ conversationId: c.id, context, firstAt: first.createdAt.toISOString(), firstMessageId: first.id ?? null,
      lifetimeInitiator, attended: activity.replies.length > 0, booked: false, appointmentIds: [],
      resolution: resolutionOf(activity.replies, handoffs.get(c.id) ?? 0) });
  }
  const byId = new Map(records.map((record) => [record.conversationId, record]));
  let unattributedEvaluations = 0;
  for (const booking of input.bookings) {
    if (!inside(booking.createdAt)) continue;
    const row = booking.conversationId ? byId.get(booking.conversationId) : undefined;
    const arrival = booking.conversationId ? arrivals.get(booking.conversationId) : undefined;
    // Booking before the contact's inbound is not conversion of that inbound.
    if (!row || !arrival || booking.createdAt < arrival) { unattributedEvaluations++; continue; }
    row.booked = true;
    row.appointmentIds.push(booking.id);
  }
  const resolutionCounts = (rows: readonly ContactContextEvidence[]): ResolutionCounts => ({
    aiOnly: rows.filter((r) => r.resolution === "ai_only").length,
    aiAndHuman: rows.filter((r) => r.resolution === "ai_and_human").length,
    humanOnly: rows.filter((r) => r.resolution === "human_only").length,
  });
  const groups = (Object.keys(CONTACT_CONTEXT_LABEL) as ContactContext[]).map((key) => {
    const rows = records.filter((r) => r.context === key);
    const scheduledContacts = rows.filter((r) => r.booked).length;
    return { key, label: CONTACT_CONTEXT_LABEL[key], contacts: rows.length, attended: rows.filter((r) => r.attended).length,
      scheduledContacts, evaluations: rows.reduce((n, r) => n + r.appointmentIds.length, 0),
      conversionPercent: rows.length && key !== "unknown" ? Math.round(scheduledContacts / rows.length * 1000) / 10 : null,
      ...resolutionCounts(rows) };
  });
  const autonomy = autonomyOf(resolutionCounts(records.filter((r) => PATIENT_CONTEXTS.includes(r.context))));
  return { summary: { active: records.length, attended: records.filter((r) => r.attended).length,
    attributedEvaluations: groups.reduce((n, g) => n + g.evaluations, 0), unattributedEvaluations, acquisition: "not_recorded", groups, autonomy }, records };
}
