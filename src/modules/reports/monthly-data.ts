import { contactActivity, contactWasTransferred } from "./contact-activity";
import { summarizeContactContexts, type ContactContextSummary } from "./contact-context";
import { partsInZone } from "@/modules/scheduling/time";
import { attendanceOf, parseKind } from "@/modules/scheduling/dimensions";
import { doubtLabel, lossLabel } from "@/modules/lead-insights/categories";
import { lossKeyOf, summarizeLeadQuality, type LeadRow } from "@/modules/lead-insights/summary";
import { classifyCity } from "@/modules/lead-insights/service-area";
import { financialEnabled, normalizeLabel, outsideHumanHours, type MonthlyAssumptions } from "./monthly-config";
import type { MonthlyAppointment, MonthlyConversation, MonthlyInput } from "./monthly";
import type { Bucket, CohortStatus, MonthlyEvidence } from "./monthly-evidence";
import type { MonthlyTimeMetrics } from "./monthly-time";
import type { AvailabilityIncident, AvailabilityMetrics } from "./monthly-operations";
import { buildSatisfaction } from "./monthly-satisfaction";

/*
 * Relatório mensal v2: o contrato único de números.
 *
 * O motor calcula e valida, a IA só redige a partir daqui e o painel e o PDF só
 * apresentam. Nenhum número do relatório pode nascer em componente, prompt ou
 * gerador de PDF: todos vêm de `MonthlyReportData`, montado na mesma chamada de
 * `evaluateMonthlyMetrics` (mesma entrada, nenhuma consulta nova) e congelado
 * no snapshot.
 *
 * A unidade é o CONTATO (uma conversa por contato): quem escreveu no mês e foi
 * respondido, pela IA ou pela equipe. Todos entram, dentro e fora do
 * expediente; o expediente é só uma quebra dentro de cada número. A regra
 * conservadora (receita só de quem chegou com a recepção fechada) vale apenas
 * no retorno estimado. Ligado com dados insuficientes, mostra parcelas
 * independentes e ROI indisponível; desligado, o bloco some.
 *
 * Puro e sem dado de paciente: contagens, durações e nomes de procedimento.
 */

export type MetricStatus =
  | "measured"     // calculado de registros do Fechai
  | "confirmed"    // confirmado por fonte externa ou marcação da clínica
  | "estimated"    // depende de premissa
  | "partial"      // cobertura incompleta
  | "unverified"   // dado esperado, sem confirmação
  | "unavailable"; // não há fonte: a linha não é renderizada

export type Metric<T = number> = { value: T | null; status: MetricStatus; source: string; note?: string };
/** `inside`/`outside` nulos quando o expediente não foi cadastrado: só o total aparece. */
export type Split = { inside: Metric; outside: Metric; total: Metric; unclassified: number };

/** Tempo de leitura e resposta de uma mensagem de texto quando a conta não informou o seu. */
export const DEFAULT_SECONDS_PER_MESSAGE = 30;
/** Faixas do gráfico "quando os contatos chegaram". A classificação dentro/fora usa o expediente, nunca estas faixas. */
export const HOUR_BANDS: readonly (readonly [number, number])[] = [[0, 8], [8, 12], [12, 14], [14, 18], [18, 22], [22, 24]];
const HOUR = 3600;

export type MonthlyProblem =
  | { kind: "no_show"; count: number; ratePercent: number | null }
  /** `endsAt` nulo = ainda fora do ar no fim do período medido. */
  | { kind: "outage"; startsAt: string; endsAt: string | null; minutes: number; contactsAffected: number }
  | { kind: "reception_wait"; waitedOverHour: number; unanswered: number };

export type EstimatedReturn = {
  /** Compareceram e chegaram com a recepção fechada: a única base da receita. */
  attendedOutside: number;
  lines: { procedure: string; attended: number; conversionBps: number; ticketCents: number; revenueCents: number }[];
  revenueCents: number;
  returnedSeconds: number; hourCents: number; savingsCents: number;
  investmentCents: number; netCents: number;
  /** Retorno líquido ÷ investimento ("5,2x"). */
  multiple: number;
};
/**
 * Satisfação dos contatos no mês (pesquisa pós-conversa). Só números e rótulos
 * do conjunto fechado de motivos: o texto dos comentários nunca vem para cá.
 * Opcional: snapshot anterior à pesquisa, ou mês sem envio, não tem o bloco.
 */
export type MonthlySatisfaction = {
  /** Pesquisas que os contatos receberam no mês. */
  sent: number;
  /** Respostas com nota, pela data da nota. */
  answered: number;
  responseRatePercent: number | null;
  /** Média de uma casa; "amostra pequena" na nota quando há menos de 5 respostas. */
  average: Metric;
  /** Índice 0 = nota 1 … 4 = nota 5. Soma = `answered`. */
  distribution: [number, number, number, number, number];
  /** Até 3 motivos de melhoria mais citados, só chaves do conjunto fechado. */
  improvementTopics: { key: string; label: string; count: number }[];
  /** Comentários sem motivo classificado: "sem classificação", à parte. */
  unclassified: number;
  withComment: number;
  smallSample: boolean;
};
export type MonthlyComparison = {
  contacts: number; scheduled: number; agentFirstResponseSeconds: number | null;
  unanswered: number; noShowRatePercent: number | null;
};

export type MonthlyReportData = {
  version: 2;
  meta: { timezone: string; hoursConfigured: boolean; secondsPerMessage: number; secondsPerMessageDefault: boolean };
  service: {
    contexts?: ContactContextSummary;
    contacts: Split;
    aiOnly: Metric; transferred: Metric;
    /** Transbordos que o agente registrou. Zero com transferidas > 0 = a equipe assume sem o agente passar. */
    handoffEvents: Metric;
    agentFirstResponseSeconds: Metric;
    availabilityPercent: Metric;
    reception: { withinHourPercent?: Metric; targetMinutes?: number | null; withinTargetPercent?: Metric; countedUntil?: string; answered: Metric; firstResponseSeconds: Metric; waitedOverHour: Metric; unanswered: Metric };
    time: {
      audios: Metric; audioSeconds: Metric; longestAudioSeconds: Metric; longAudios: Metric;
      textMessages: Metric; textSeconds: Metric; totalSeconds: Metric;
    };
    arrivalsByWeekday?: { weekday: number; inside: number; outside: number; unclassified: number }[];
    hourBands: { from: number; to: number; contacts: number }[];
  };
  schedule: {
    qualified: Split;
    /** Avaliações MARCADAS pelo agente no mês, pelo que aconteceu com cada uma. */
    cohort: Record<CohortStatus | "total", Split>;
    /** Contatos do mês com avaliação marcada (base de "motivo de não agendar"). */
    scheduledContacts: number;
    /** compareceram ÷ (compareceram + faltaram); aguardando e não verificado ficam fora. */
    attendanceRatePercent: Metric;
    /** Marcadas em mês anterior, com consulta neste: linha à parte, fora da taxa. */
    fromEarlierMonths: { attended: Metric; noShow: Metric };
    procedures: { name: string; scheduled: number }[];
  };
  unanswered: Metric;
  leads: {
    population?: { attended: number; scheduled: number; notScheduled: number; withDoubt: number; cityCoveragePercent: number };
    withCity: Metric; outOfArea: Metric; outOfAreaScheduled: Metric;
    firstDoubts: { key: string; label: string; contacts: number; percent: number }[];
    /** Um motivo por contato que não agendou: a soma é contatos − agendaram. */
    reasons: { key: string; label: string; contacts: number }[];
    suggestions: string[];
  };
  /** Pesquisa de satisfação (nota dada pelos contatos). Opcional e congelada no snapshot. */
  satisfaction?: MonthlySatisfaction;
  /** Quedas da conexão no mês, como o monitor registrou (`whatsapp/incidents.ts`). */
  incidents: AvailabilityIncident[];
  /** Só o que os dados comprovam. Vazio = "nenhum incidente relevante". */
  problems: MonthlyProblem[];
  /** ROI completo só com premissas e coorte financeira verificadas. */
  estimatedReturn: EstimatedReturn | null;
  financialSummary?: { status: "complete" | "incomplete"; revenueCents: number | null; savingsCents: number | null; investmentCents: number | null; operatingBalanceCents: number | null; warnings: string[] } | null;
  /** Premissas/confirmacões ausentes quando o retorno financeiro está ligado. */
  estimatedReturnMissing: string[];
  /** Null quando o mês anterior não é comparável: a coluna não aparece. */
  comparison: MonthlyComparison | null;
};

const metric = (value: number | null, status: MetricStatus, source: string, note?: string): Metric =>
  ({ value, status, source, ...(note ? { note } : {}) });
type Counts = Record<Bucket, number>;
const counts = (): Counts => ({ inside: 0, outside: 0, unclassified: 0 });

function splitOf(c: Counts, hoursConfigured: boolean, status: MetricStatus, source: string): Split {
  const total = c.inside + c.outside + c.unclassified;
  // Sem expediente não há dentro/fora: o total vale, a quebra não é inventada.
  const part = (v: number) => hoursConfigured
    ? metric(v, c.unclassified ? "partial" : status, source)
    : metric(null, "partial", source, "Expediente da clínica não cadastrado.");
  return { inside: part(c.inside), outside: part(c.outside), total: metric(total, status, source), unclassified: hoursConfigured ? c.unclassified : 0 };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** O tipo explícito vence; sem ele, o nome do serviço conferido nas premissas. */
export function evaluationOf(a: Pick<MonthlyAppointment, "kind" | "serviceType">, config: MonthlyAssumptions) {
  const kind = parseKind(a.kind);
  const typed = Boolean(kind || a.serviceType);
  const evaluation = kind ? kind === "evaluation"
    : a.serviceType ? config.evaluationTypes.some((t) => normalizeLabel(t) === normalizeLabel(a.serviceType!))
    : config.countUntypedAsEvaluations;
  return { typed, evaluation };
}

function conversationProcedure(conversation: MonthlyConversation | undefined, config: MonthlyAssumptions): string | null {
  const raw = conversation?.variables;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[config.procedureVariable];
  if (typeof value !== "string" || !value.trim()) return null;
  return config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(value))?.name ?? value.trim();
}
/** O procedimento registrado na consulta vence a variável da conversa. */
export function procedureLabel(a: Pick<MonthlyAppointment, "procedure"> | null, conversation: MonthlyConversation | undefined, config: MonthlyAssumptions): string | null {
  const explicit = a?.procedure?.trim();
  return explicit
    ? config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(explicit))?.name ?? explicit
    : conversationProcedure(conversation, config);
}

/**
 * O que aconteceu com a avaliação. Agendado ou confirmado nunca é presença, e
 * consulta passada sem status mapeado é "não verificada", nunca falta.
 */
export function cohortStatusOf(a: MonthlyAppointment, remoteStatusType: string | null | undefined, config: MonthlyAssumptions, now: Date): CohortStatus {
  if (a.startsAt > now) return "upcoming";
  const local = attendanceOf(a);
  if (a.clinicorpAppointmentId) {
    // Com espelho, o status mapeado de lá vence; sem resposta, só a marcação
    // feita na /agenda (`attendanceAt`) conta. O `done` legado não tem data.
    if (remoteStatusType && config.completedStatusTypes.includes(remoteStatusType)) return "attended";
    if (remoteStatusType && (config.noShowStatusTypes ?? []).includes(remoteStatusType)) return "no_show";
    return a.attendanceAt && local !== "unknown" ? local : "unverified";
  }
  return local === "unknown" ? "unverified" : local;
}

export function buildMonthlyReportData(input: MonthlyInput, time: MonthlyTimeMetrics, evidence: MonthlyEvidence, uptime?: AvailabilityMetrics | null): MonthlyReportData {
  const { start, end, now, config } = input;
  const hoursConfigured = Boolean(config.humanHours);
  const inMonth = (at: Date) => at >= start && at < end;
  const includesAgent = (agentId?: string | null) => !config.agentIds?.length || Boolean(agentId && config.agentIds.includes(agentId));
  const bucketOf = (at: Date | null): Bucket => {
    const outside = at ? outsideHumanHours(at, config) : null;
    return outside === null ? "unclassified" : outside ? "outside" : "inside";
  };
  const all = new Map(input.conversations.map((c) => [c.id, c]));
  const conversations = input.conversations.filter((c) => includesAgent(c.agentId));
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const byLead = new Map(conversations.map((c) => [c.leadId, c]));

  const handoffs = new Map<string, Date[]>();
  const qualifiedIds = new Set<string>();
  let unanswered = 0;
  for (const event of input.events) {
    if (!inMonth(event.createdAt) || !includesAgent(all.get(event.conversationId)?.agentId)) continue;
    if (event.kind === "handoff") handoffs.set(event.conversationId, [...(handoffs.get(event.conversationId) ?? []), event.createdAt]);
    if (event.kind === "qualified") qualifiedIds.add(event.conversationId);
    if (event.kind === "unanswered") unanswered++;
  }

  /* ----------------------------- Atendimento ----------------------------- */
  type Contact = { bucket: Bucket; arrival: Date; transferred: boolean; agentSeconds: number | null; receptionSeconds: number | null };
  const contacts = new Map<string, Contact>();
  const bands = HOUR_BANDS.map(() => 0);
  for (const conversation of conversations) {
    const { messages, first, replies } = contactActivity(conversation.messages.filter((m) => inMonth(m.createdAt)));
    if (!first) continue;
    // Mensagem nossa antes de o contato escrever (lembrete, disparo) não é resposta.
    if (!replies.length) continue;
    const firstHuman = replies.find((m) => m.sentBy === "human");
    const events = (handoffs.get(conversation.id) ?? []).sort((a, b) => a.getTime() - b.getTime());
    const transferred = contactWasTransferred(replies, events.length);
    // Se a equipe respondeu antes, o intervalo até a IA mediria o trabalho dela.
    const agentSeconds = replies[0].sentBy === "agent" ? (replies[0].createdAt.getTime() - first.createdAt.getTime()) / 1000 : null;
    let receptionSeconds: number | null = null;
    if (firstHuman) {
      // Espera da recepção: do transbordo; sem evento, da última mensagem do contato antes dela.
      const event = events.find((at) => at <= firstHuman.createdAt);
      const lastInbound = messages.filter((m) => m.role === "user" && m.createdAt <= firstHuman.createdAt).at(-1);
      const from = event ?? lastInbound?.createdAt ?? first.createdAt;
      receptionSeconds = Math.max(0, (firstHuman.createdAt.getTime() - from.getTime()) / 1000);
    }
    const hour = partsInZone(first.createdAt, config.timezone).hour;
    bands[HOUR_BANDS.findIndex(([from, to]) => hour >= from && hour < to)]++;
    contacts.set(conversation.id, { bucket: bucketOf(first.createdAt), arrival: first.createdAt, transferred, agentSeconds, receptionSeconds });
  }
  const contactCounts = counts();
  for (const c of contacts.values()) contactCounts[c.bucket]++;
  const list = [...contacts.values()];
  const transferred = list.filter((c) => c.transferred);
  const answered = transferred.filter((c) => c.receptionSeconds !== null);
  const agentMedian = median(list.flatMap((c) => c.agentSeconds === null ? [] : [c.agentSeconds]));
  const receptionMedian = median(answered.map((c) => c.receptionSeconds!));
  const waitedOverHour = answered.filter((c) => c.receptionSeconds! > HOUR).length;
  const receptionUnanswered = transferred.length - answered.length;

  /* -------------------------------- Agenda -------------------------------- */
  const external = new Map(input.clinicorp.appointments.map((a) => [a.id, a]));
  const cohort: Record<CohortStatus | "total", Counts> = { attended: counts(), no_show: counts(), upcoming: counts(), unverified: counts(), total: counts() };
  const earlier = { attended: 0, noShow: 0 };
  const procedures = new Map<string, number>();
  const attendedOutside = new Map<string, number>();
  const scheduledIds = new Set<string>();
  evidence.cohort = [];
  for (const appointment of input.appointments) {
    if (!includesAgent(appointment.agentId) || appointment.source !== "agent" || appointment.status === "canceled") continue;
    const created = inMonth(appointment.createdAt), starts = inMonth(appointment.startsAt);
    if (!created && !starts) continue;
    if (!evaluationOf(appointment, config).evaluation) continue;
    const remote = appointment.clinicorpAppointmentId ? external.get(appointment.clinicorpAppointmentId) : undefined;
    // Cancelada na clínica não é presença nem falta: sai da coorte.
    if (remote?.canceled) continue;
    const conversation = appointment.conversationId ? byId.get(appointment.conversationId) : byLead.get(appointment.leadId ?? "");
    const status = cohortStatusOf(appointment, remote?.statusType, config, now);
    // A avaliação herda a classificação do contato que a originou.
    const origin = conversation?.firstInbound && conversation.firstInbound <= appointment.createdAt ? conversation.firstInbound : null;
    const bucket = (conversation && contacts.get(conversation.id)?.bucket) ?? bucketOf(origin);
    const procedure = procedureLabel(appointment, conversation, config);
    evidence.cohort.push({ appointmentId: appointment.id, conversationId: conversation?.id ?? appointment.conversationId,
      createdAt: appointment.createdAt.toISOString(), startsAt: appointment.startsAt.toISOString(), bucket, status, procedure, earlier: !created });
    if (!created) {
      if (status === "attended") earlier.attended++;
      if (status === "no_show") earlier.noShow++;
      continue;
    }
    cohort[status][bucket]++;
    cohort.total[bucket]++;
    const name = procedure ?? "Não informado";
    const key = [...procedures.keys()].find((p) => normalizeLabel(p) === normalizeLabel(name)) ?? name;
    procedures.set(key, (procedures.get(key) ?? 0) + 1);
    if (status === "attended" && bucket === "outside") attendedOutside.set(key, (attendedOutside.get(key) ?? 0) + 1);
    if (conversation && contacts.has(conversation.id)) scheduledIds.add(conversation.id);
  }
  const sum = (c: Counts) => c.inside + c.outside + c.unclassified;
  const attended = sum(cohort.attended), noShow = sum(cohort.no_show);
  const attendanceRate = attended + noShow > 0 ? Math.round(attended / (attended + noShow) * 100) : null;

  const qualifiedCounts = counts();
  for (const id of qualifiedIds) qualifiedCounts[contacts.get(id)?.bucket ?? bucketOf(all.get(id)?.firstInbound ?? null)]++;
  // Agendou sem qualificar = o agente não está registrando a qualificação.
  const qualifiedStatus: MetricStatus = sum(qualifiedCounts) < sum(cohort.total) ? "partial" : "measured";

  /* ------------------------- Qualidade dos leads ------------------------- */
  const rows: LeadRow[] = [];
  const reasons = new Map<string, number>();
  evidence.contacts = [];
  for (const [id, contact] of contacts) {
    const c = byId.get(id)!;
    const scheduled = scheduledIds.has(id);
    const lastInbound = c.messages.filter((m) => m.role === "user" && m.createdAt < end).at(-1)?.createdAt ?? null;
    const row: LeadRow = {
      createdAt: c.lead.createdAt, status: c.lead.status ?? "new",
      disqualified: Boolean(c.lead.disqualifiedAt), disqualifiedReason: c.lead.disqualifiedReason ?? null,
      conversation: { needsHuman: c.needsHuman ?? false, lastInboundAt: c.lastInboundAt ?? lastInbound,
        followUpReason: c.followUpReason ?? null, handoffEvents: handoffs.get(id)?.length ?? 0 },
      appointments: scheduled ? [{ status: "scheduled" }] : [],
      insight: c.insight ?? null,
    };
    rows.push(row);
    // Sem motivo registrado (em andamento, passou para a equipe) cai em "outro":
    // a soma precisa fechar em contatos − agendaram.
    const reasonKey = scheduled ? null : lossKeyOf(row, now) ?? "outro";
    if (reasonKey) reasons.set(reasonKey, (reasons.get(reasonKey) ?? 0) + 1);
    evidence.contacts.push({ conversationId: id, arrivalAt: contact.arrival.toISOString(), bucket: contact.bucket, transferred: contact.transferred,
      agentSeconds: contact.agentSeconds, receptionSeconds: contact.receptionSeconds, scheduled, reasonKey });
  }
  const area = input.area ?? null;
  const quality = summarizeLeadQuality(rows, area, now);
  const doubtCounts = new Map<string, number>();
  for (const row of rows) if (row.insight?.firstQuestionKey) doubtCounts.set(row.insight.firstQuestionKey, (doubtCounts.get(row.insight.firstQuestionKey) ?? 0) + 1);
  // As quatro maiores e o resto somado em "outros": a lista sempre fecha no total.
  const ranked = (entries: Map<string, number>, label: (key: string) => string, others: string) => {
    const main = [...entries].filter(([key]) => key !== "outro").sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4);
    const rest = [...entries.values()].reduce((n, v) => n + v, 0) - main.reduce((n, [, v]) => n + v, 0);
    return [...main.map(([key, n]) => ({ key, label: label(key), contacts: n })), ...(rest > 0 ? [{ key: "outros", label: others, contacts: rest }] : [])];
  };
  const withDoubt = quality.withDoubt;
  const firstDoubts = ranked(doubtCounts, doubtLabel, "Outras").map((d) => ({ ...d, percent: withDoubt ? Math.round(d.contacts / withDoubt * 100) : 0 }));
  const reasonList = ranked(reasons, lossLabel, "Outros");
  const total = contacts.size;
  const cityCoverage: MetricStatus = total > 0 && quality.withCity / total < 0.5 ? "partial" : "measured";
  let outScheduled = 0;
  for (const row of rows) if (row.appointments.length && classifyCity(area, row.insight?.cityKey) === "out") outScheduled++;

  /* --------------------- Disponibilidade e incidentes --------------------- */
  // A medição é a do monitor do WhatsApp (`availabilityMetrics`, na mesma
  // passada). Sem medição no mês não se afirma 100%: a linha some.
  const availability = uptime ? metric(uptime.percent, uptime.partial ? "partial" : "measured", "whatsappIncidents",
    uptime.partial ? "A medição da conexão começou depois do início do mês." : undefined) : metric(null, "unavailable", "whatsappIncidents");
  const incidents = uptime?.incidents ?? [];

  const problems: MonthlyProblem[] = [];
  if (noShow > 0) problems.push({ kind: "no_show", count: noShow, ratePercent: attendanceRate === null ? null : 100 - attendanceRate });
  for (const i of incidents) problems.push({ kind: "outage", startsAt: i.startedAt, endsAt: i.endedAt, minutes: Math.round(i.seconds / 60), contactsAffected: i.contacts });
  if (waitedOverHour > 0 || receptionUnanswered > 0) problems.push({ kind: "reception_wait", waitedOverHour, unanswered: receptionUnanswered });

  /* --------------------------- Tempo devolvido --------------------------- */
  const secondsPerMessage = config.secondsPerMessage ?? DEFAULT_SECONDS_PER_MESSAGE;
  const audioSeconds = Math.round(time.audioMinutes * 60);
  const textSeconds = time.textMessages * secondsPerMessage;
  const audioStatus: MetricStatus = time.unmeasuredAudios ? "partial" : "measured";
  const audioNote = time.unmeasuredAudios ? `${time.unmeasuredAudios} áudio(s) sem duração medida.` : undefined;
  const textNote = `${secondsPerMessage} s por mensagem de texto`;

  /* --------------------------- Retorno estimado --------------------------- */
  const missing: string[] = [];
  if (!hoursConfigured) missing.push("Expediente da clínica não cadastrado.");
  if (config.attendantMonthlyCents === null || !config.attendantMonthlyHours) missing.push("Custo e carga mensal da equipe não informados.");
  if (!config.investmentCents) missing.push("Mensalidade não informada.");
  if (!config.procedures.length || config.procedures.some((p) => p.ticketCents === null || p.conversionBps === null)) missing.push("Ticket e conversão por procedimento não informados.");
  if (config.secondsPerMessage == null) missing.push("Tempo humano equivalente por mensagem não informado; o padrão de visualização não valida economia financeira.");
  if (cohort.unverified.outside || cohort.unverified.unclassified) missing.push("Há comparecimentos sem verificação na base do retorno financeiro.");
  if (cohort.upcoming.outside || cohort.upcoming.unclassified) missing.push("Há avaliações futuras na base do retorno financeiro.");
  if (cohort.total.unclassified) missing.push("Há avaliações sem classificação por expediente.");
  const revenueWarnings = missing.filter((warning) => !warning.startsWith("Custo e carga") && !warning.startsWith("Mensalidade") && !warning.startsWith("Tempo humano"));
  const lines: EstimatedReturn["lines"] = [];
  for (const [name, n] of attendedOutside) {
    const premise = config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(name));
    if (premise?.ticketCents == null || premise.conversionBps == null) { const warning = `Ticket ou conversão de "${name}" não informados.`; missing.push(warning); revenueWarnings.push(warning); continue; }
    lines.push({ procedure: premise.name, attended: n, conversionBps: premise.conversionBps, ticketCents: premise.ticketCents,
      revenueCents: Math.round(n * premise.ticketCents * premise.conversionBps / 10_000) });
  }
  let estimatedReturn: EstimatedReturn | null = null;
  if (financialEnabled(config) && !missing.length) {
    const hourCents = Math.round(config.attendantMonthlyCents! / config.attendantMonthlyHours!);
    const revenueCents = lines.reduce((n, l) => n + l.revenueCents, 0);
    const returnedSeconds = audioSeconds + textSeconds;
    const savingsCents = Math.round(returnedSeconds / HOUR * config.attendantMonthlyCents! / config.attendantMonthlyHours!);
    const investmentCents = config.investmentCents!;
    const netCents = revenueCents + savingsCents - investmentCents;
    estimatedReturn = { attendedOutside: cohort.attended.outside, lines: lines.sort((a, b) => b.revenueCents - a.revenueCents), revenueCents,
      returnedSeconds, hourCents, savingsCents, investmentCents, netCents, multiple: Math.round(netCents / investmentCents * 10) / 10 };
  }

  // Cada parcela tem suas próprias premissas; desconhecido nunca vira zero.
  const partialSavings = config.secondsPerMessage != null && config.attendantMonthlyCents !== null && config.attendantMonthlyHours
    ? Math.round((audioSeconds + textSeconds) / HOUR * config.attendantMonthlyCents / config.attendantMonthlyHours) : null;
  const financialSummary = financialEnabled(config) ? {
    status: estimatedReturn ? "complete" as const : "incomplete" as const,
    revenueCents: revenueWarnings.length ? null : lines.reduce((sum, line) => sum + line.revenueCents, 0),
    savingsCents: partialSavings, investmentCents: config.investmentCents,
    operatingBalanceCents: partialSavings !== null && config.investmentCents !== null ? partialSavings - config.investmentCents : null,
    warnings: [...missing, ...(time.unmeasuredAudios ? ["A economia tem cobertura parcial: há áudios sem duração medida."] : [])],
  } : null;
  const arrivalsByWeekday = [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const arrivals = list.filter((c) => partsInZone(c.arrival, config.timezone).weekday === weekday);
    return { weekday, inside: arrivals.filter((c) => c.bucket === "inside").length,
      outside: arrivals.filter((c) => c.bucket === "outside").length, unclassified: arrivals.filter((c) => c.bucket === "unclassified").length };
  });
  const within = (seconds: number) => transferred.length ? Math.round(answered.filter((c) => c.receptionSeconds! <= seconds).length / transferred.length * 1000) / 10 : null;
  const contexts = summarizeContactContexts({ start, end, conversations, events: input.events,
    bookings: evidence.cohort.filter((a) => !a.earlier).map((a) => ({ id: a.appointmentId, conversationId: a.conversationId, createdAt: new Date(a.createdAt) })) });
  evidence.contexts = contexts.records;
  const satisfaction = buildSatisfaction(input, evidence);
  return {
    version: 2,
    meta: { timezone: config.timezone, hoursConfigured, secondsPerMessage, secondsPerMessageDefault: config.secondsPerMessage == null },
    service: {
      contexts: contexts.summary,
      contacts: splitOf(contactCounts, hoursConfigured, "measured", "messages"),
      aiOnly: metric(total - transferred.length, "measured", "messages"),
      transferred: metric(transferred.length, "measured", "messages+events"),
      handoffEvents: metric([...handoffs.values()].reduce((n, v) => n + v.length, 0), "measured", "events"),
      agentFirstResponseSeconds: agentMedian === null ? metric(null, "unavailable", "messages") : metric(Math.round(agentMedian), "measured", "messages", "mediana"),
      availabilityPercent: availability,
      reception: {
        withinHourPercent: metric(within(HOUR), "measured", "messages+events"),
        targetMinutes: config.receptionTargetMinutes ?? null,
        withinTargetPercent: metric(config.receptionTargetMinutes ? within(config.receptionTargetMinutes * 60) : null, "measured", "messages+events"),
        countedUntil: new Date(Math.min(end.getTime(), now.getTime())).toISOString(),
        answered: metric(answered.length, "measured", "messages"),
        firstResponseSeconds: receptionMedian === null ? metric(null, "unavailable", "messages") : metric(Math.round(receptionMedian), "measured", "messages+events", "mediana"),
        waitedOverHour: metric(waitedOverHour, "measured", "messages+events"),
        unanswered: metric(receptionUnanswered, "measured", "messages+events"),
      },
      time: {
        audios: metric(time.audios, "measured", "messages"),
        audioSeconds: metric(audioSeconds, audioStatus, "messages", audioNote),
        longestAudioSeconds: time.longestAudioSeconds === null ? metric(null, "unavailable", "messages") : metric(time.longestAudioSeconds, "measured", "messages"),
        longAudios: metric(time.longAudios, audioStatus, "messages"),
        textMessages: metric(time.textMessages, "measured", "messages"),
        textSeconds: metric(textSeconds, "estimated", "assumption:secondsPerMessage", textNote),
        totalSeconds: metric(audioSeconds + textSeconds, "estimated", "messages+assumption:secondsPerMessage", textNote),
      },
      arrivalsByWeekday,
      hourBands: HOUR_BANDS.map(([from, to], i) => ({ from, to, contacts: bands[i] })),
    },
    schedule: {
      qualified: splitOf(qualifiedCounts, hoursConfigured, qualifiedStatus, "events"),
      cohort: {
        attended: splitOf(cohort.attended, hoursConfigured, "confirmed", "appointments+clinicorp"),
        no_show: splitOf(cohort.no_show, hoursConfigured, "confirmed", "appointments+clinicorp"),
        upcoming: splitOf(cohort.upcoming, hoursConfigured, "measured", "appointments"),
        unverified: splitOf(cohort.unverified, hoursConfigured, "unverified", "appointments+clinicorp"),
        total: splitOf(cohort.total, hoursConfigured, "measured", "appointments"),
      },
      scheduledContacts: scheduledIds.size,
      attendanceRatePercent: attendanceRate === null ? metric(null, "unavailable", "appointments+clinicorp") : metric(attendanceRate, "confirmed", "appointments+clinicorp"),
      fromEarlierMonths: { attended: metric(earlier.attended, "confirmed", "appointments+clinicorp"), noShow: metric(earlier.noShow, "confirmed", "appointments+clinicorp") },
      procedures: [...procedures].map(([name, scheduled]) => ({ name, scheduled })).sort((a, b) => b.scheduled - a.scheduled || a.name.localeCompare(b.name, "pt-BR")),
    },
    unanswered: metric(unanswered, "measured", "events"),
    leads: {
      population: { attended: total, scheduled: scheduledIds.size, notScheduled: total - scheduledIds.size,
        withDoubt, cityCoveragePercent: total ? Math.round(quality.withCity / total * 1000) / 10 : 0 },
      withCity: metric(quality.withCity, cityCoverage, "insights"),
      outOfArea: area ? metric(quality.outOfRadius, cityCoverage, "insights+serviceArea") : metric(null, "unavailable", "serviceArea"),
      outOfAreaScheduled: area ? metric(outScheduled, cityCoverage, "insights+serviceArea") : metric(null, "unavailable", "serviceArea"),
      firstDoubts, reasons: reasonList, suggestions: [],
    },
    ...(satisfaction ? { satisfaction } : {}),
    incidents,
    problems,
    estimatedReturn, financialSummary, estimatedReturnMissing: financialEnabled(config) ? missing : [],
    comparison: null,
  };
}

/** Snapshots antigos não ganham cálculos novos: só reapresentamos parcelas congeladas seguras. */
export function monthlyFinancialPresentation(data: MonthlyReportData, config: MonthlyAssumptions) {
  if (!financialEnabled(config)) return { estimatedReturn: null, financialSummary: null };
  if (data.financialSummary !== undefined) return { estimatedReturn: data.estimatedReturn, financialSummary: data.financialSummary };
  const er = data.estimatedReturn;
  if (!er) return { estimatedReturn: null, financialSummary: null };
  const warnings: string[] = [];
  if (!config.humanHours || data.schedule.cohort.total.unclassified) warnings.push("Classificação por expediente incompleta neste fechamento.");
  if (!config.procedures.length || config.procedures.some((p) => p.ticketCents === null || p.conversionBps === null)) warnings.push("Ticket e conversão não informados neste fechamento.");
  if (data.schedule.cohort.unverified.outside.value || data.schedule.cohort.upcoming.outside.value) warnings.push("Comparecimentos não verificados ou consultas futuras na base financeira deste fechamento.");
  const savingsValid = config.secondsPerMessage != null && config.attendantMonthlyCents !== null && Boolean(config.attendantMonthlyHours);
  if (!savingsValid) warnings.push("Economia sem custo e tempo humano equivalente completos neste fechamento.");
  if (!warnings.length) return { estimatedReturn: er, financialSummary: null };
  return { estimatedReturn: null, financialSummary: {
    status: "incomplete" as const, revenueCents: null, savingsCents: savingsValid ? er.savingsCents : null,
    investmentCents: er.investmentCents, operatingBalanceCents: null,
    warnings: [...warnings, "Reabra e confira a revisão para produzir uma nova versão; o snapshot anterior permanece preservado."],
  } };
}

/** O que o mês anterior empresta ao comparativo. Só é chamado quando ele é comparável. */
export function monthlyComparison(previous: MonthlyReportData): MonthlyComparison {
  const rate = previous.schedule.attendanceRatePercent.value;
  return {
    contacts: previous.service.contacts.total.value ?? 0,
    scheduled: previous.schedule.cohort.total.total.value ?? 0,
    agentFirstResponseSeconds: previous.service.agentFirstResponseSeconds.value,
    unanswered: previous.unanswered.value ?? 0,
    noShowRatePercent: rate === null ? null : 100 - rate,
  };
}
