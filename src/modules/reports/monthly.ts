import { loadHistoricalCities } from "@/modules/lead-insights/historical-city-store";
import { loadConversationStarts } from "./contact-context-store";
import type { ContextMessage } from "./contact-context";
import { contextEventMessageId } from "./contact-context-events";
import { prisma } from "@/lib/prisma";
import { readClinicorpReport, type ClinicorpReportData } from "@/modules/scheduling/clinicorp";
import { dayKeyInZone, partsInZone } from "@/modules/scheduling/time";
import { attendanceOf, parseKind } from "@/modules/scheduling/dimensions";
import { applyMonthlyOverrides, parseMonthlyOverrides, type MonthlyOverrides } from "./monthly-overrides";
import { monthlyAccountPrice, sameMonthlyAgentScope } from "./monthly-import";
import { EMPTY_ASSUMPTIONS, monthlyWindow, normalizeLabel, outsideHumanHours,
  parseMonthlyAssumptions, type MonthlyAssumptions } from "./monthly-config";
import { calculateTimeMetrics, LONG_AUDIO_SECONDS, type MonthlyTimeMetrics, type TimeMessage } from "./monthly-time";
import { UNTRANSCRIBED_AUDIO } from "@/modules/voice/received-audio";
import { loadLeadQualityDetail } from "@/modules/lead-insights/queries";
import type { LeadQuality } from "@/modules/lead-insights/summary";
import { capEvidence, emptyEvidence, type AppointmentEvidence, type Bucket, type EventEvidence, type MonthlyEvidence } from "./monthly-evidence";
import { monthlyQuality, type MonthlyQuality } from "./monthly-quality";
import { monthlyLimitations, type MonthlyLimitation } from "./monthly-limitations";
import { parseNextActions, type MonthlyNextAction } from "./monthly-next-actions";
import { arrivalSlot, availabilityMetrics, emptyArrivals, median, RECEPTION_LONG_WAIT_SECONDS,
  type ArrivalBreakdown, type AvailabilityMetrics, type ReceptionMetrics, type UptimeIncident } from "./monthly-operations";
import { CASE_AUDIOS_MAX, casePeriod, parseCaseFacts, type CaseFacts, type CasePeriod } from "./monthly-case";
import { parsePreviousActions, reviewPreviousActions, type PreviousAction } from "./monthly-previous-actions";
import { parseAgentChanges, type ReportedAgentChange } from "./monthly-agent-changes";
import { buildMonthlyReportData, monthlyComparison, type MonthlyReportData } from "./monthly-data";
import { loadMonthlySurveys } from "./monthly-satisfaction";
import { getServiceArea } from "@/modules/lead-insights/service-area-store";
import type { ServiceArea } from "@/modules/lead-insights/service-area";

export type SplitCount = { inside: number; outside: number; unclassified: number };
export type MonthlyMetrics = {
  newContacts: number; conversations: SplitCount; firstResponseSeconds: number | null;
  /** Mediana dos mesmos pares da média: é a que vai à página 1 (um atraso isolado não a distorce). Ausente em snapshot antigo. */
  firstResponseMedianSeconds?: number | null;
  scheduled: SplitCount; attended: SplitCount; attendanceUnknown: number; untypedAppointments: number;
  qualified: number; handoffs: number; unanswered: number; trackingComplete: boolean;
  /**
   * Fila de perguntas sem resposta (P-87): aprovadas no mês e o tempo médio
   * entre a primeira vez que perguntaram e a aprovação. Opcionais porque
   * snapshots fechados antes da fila não os têm — ausente é "sem dado", não zero.
   */
  gapsAnswered?: number; gapAnswerSeconds?: number | null;
  aiOnlyConversations: number; assumedHours: number | null;
  /**
   * "Tempo que o Fechai devolveu": áudios, mensagens e duração dos atendimentos
   * (`monthly-time.ts`). Opcional porque snapshots fechados antes dele não o têm.
   */
  time?: MonthlyTimeMetrics;
  /**
   * Tudo que dá para medir da operação (`monthly-operations.ts`), de todos os
   * contatos, de dentro e de fora do expediente. Opcionais: snapshot fechado
   * antes deles não os tem. `availability: null` = mês sem medição da conexão.
   */
  reception?: ReceptionMetrics;
  arrivals?: ArrivalBreakdown;
  availability?: AvailabilityMetrics | null;
  /** Só a resposta do agente (a da equipe fica em `reception`). */
  agentFirstResponseMedianSeconds?: number | null;
  /**
   * O resto da agenda, além de `attended`: consultas do mês com falta marcada
   * (`noShow`), consultas do mês já passadas sem comparecimento comprovado
   * (`unconfirmed`, nunca lidas como falta) e avaliações marcadas no mês que
   * ainda vão acontecer (`upcoming`).
   */
  agenda?: { noShow: SplitCount; unconfirmed: SplitCount; upcoming: SplitCount };
  /**
   * `attendedOutside` é a base da receita (regra conservadora, só no retorno
   * estimado); `scheduled` e `attended` contam todos os contatos.
   */
  procedures: { name: string; qualified: number; attendedOutside: number; revenueCents: number | null; scheduled?: number; attended?: number }[];
  peaks: { hour: number; messages: number }[]; revenueCents: number | null; savingsCents: number | null;
  investmentCents: number | null; roiPercent: number | null; missing: string[];
};
export type MonthlyReport = {
  version: 1; tenantName: string; month: string; label: string; previousMonth: string;
  generatedAt: string; dueAt: string; partial: boolean; assumptions: MonthlyAssumptions;
  assumptionsFromMonth?: string;
  investmentSource?: string;
  agentNames?: string[];
  revision?: string; metricOverrides?: MonthlyOverrides;
  automatic?: { current: MonthlyMetrics; previous: MonthlyMetrics };
  previousAssumptions: MonthlyAssumptions; previousConfigured: boolean;
  current: MonthlyMetrics; previous: MonthlyMetrics; clinicorpError: string | null;
  clinicorpStatusTypes: ClinicorpReportData["statusTypes"];
  clinicorpIntegrationState?: ClinicorpReportData["integrationState"];
  adjustments: string; nextMonth: string; decisionMaker: string;
  /**
   * Relatório v2: o decisor é o dono ou sócio (`owner` | `partner`); a recepção
   * é o contato operacional, em cópia. Ausentes em relatórios anteriores.
   */
  decisionMakerRole?: string; operationalContact?: string;
  /** Mudanças no agente no mês, com tipo e data (`monthly-agent-changes.ts`). */
  agentChanges?: ReportedAgentChange[];
  /** Quantas vezes o relatório foi fechado; cada fechamento guarda a sua versão. */
  snapshotVersion?: number;
  /** Caso real do mês, anonimizado. Ausente em snapshots anteriores ao campo. */
  featuredCase?: string;
  /** Fatos medidos do caso (`monthly-case.ts`): idade, áudios, dia da semana e período. */
  caseFacts?: CaseFacts | null;
  /** Ações combinadas no relatório anterior, com status e o número que comprova. */
  previousActions?: PreviousAction[];
  /** Versão aprovada (cada fechamento gera uma). Ausente em rascunho e em fechados antes dela. */
  approval?: { version: number; approvedAt: string };
  /**
   * Qualidade dos leads do mês (cidade, raio, dúvidas, motivos de perda,
   * sugestões de tráfego). Congelada no snapshot; relatórios fechados antes
   * dela não a têm — ausente é "sem registro", nunca zero.
   */
  leadQuality?: LeadQuality;
  /**
   * Os registros de cada número do mês (`monthly-evidence.ts`) e o selo de
   * qualidade de cada indicador (`monthly-quality.ts`). Congelados no snapshot;
   * relatórios fechados antes deles não os têm e o painel/PDF escondem os dois.
   */
  evidence?: MonthlyEvidence;
  quality?: MonthlyQuality;
  /**
   * Destaques (parte 3) e a explicação das limitações, escritos na revisão.
   * `limitations` é a lista calculada (`monthly-limitations.ts`) do que ficou
   * sem evidência; congelada no snapshot. Os três ausentes em fechamentos
   * anteriores ao assistente de fechamento — o painel e o PDF escondem.
   */
  highlights?: string;
  limitationsNote?: string;
  /** Próximas ações da página 1; ausente em relatórios antigos, que usam `nextMonth`. */
  nextActions?: MonthlyNextAction[];
  limitations?: MonthlyLimitation[];
  /**
   * Relatório v2 (`monthly-data.ts`): o contrato único de números, com status e
   * fonte de cada um. Ausente em snapshots anteriores, que seguem na visão antiga.
   */
  data?: MonthlyReportData;
  status: string; finalizedAt: string | null; sentAt: string | null; meetingAt: string | null;
};

type Msg = { id: string; role: string; sentBy: string | null; createdAt: Date; audio?: TimeMessage["audio"] };
export type MonthlyConversation = { id: string; agentId?: string | null; leadId: string;
  lead: { createdAt: Date; status?: string; disqualifiedAt?: Date | null; disqualifiedReason?: string | null };
  variables: unknown; messages: Msg[]; firstInbound: Date | null; firstMessage?: ContextMessage | null;
  /** Só o relatório v2 usa (motivo de não agendar, cidade, dúvida); ausentes em fixtures antigas. */
  needsHuman?: boolean; lastInboundAt?: Date | null; followUpReason?: string | null;
  insight?: { city: string | null; cityKey: string | null; firstQuestionKey: string | null; lossReasonKey: string | null } | null };
export type MonthlyAppointment = { id: string; agentId?: string | null; conversationId: string | null; leadId: string | null;
  source: string; serviceType: string | null; status: string; startsAt: Date; createdAt: Date;
  /** Dimensões explícitas (`scheduling/dimensions.ts`); ausentes em fixtures antigas = não informadas. */
  kind?: string | null; procedure?: string | null;
  attendance?: string | null; attendanceAt?: Date | null;
  clinicorpAppointmentId: string | null };
export type MonthlyEvent = { id?: string; conversationId: string; kind: string; procedure: string | null; createdAt: Date; messageId?: string };
export type MonthlyGap = { id?: string; agentId: string | null; firstAskedAt: Date; answeredAt: Date };
/**
 * Pesquisa de satisfação que o contato recebeu (e, se respondeu, a nota). Só o
 * que o relatório conta: nada do texto do comentário — `hasComment` é um
 * booleano calculado na leitura.
 */
export type MonthlySurvey = { id: string; agentId: string | null; conversationId: string; sentAt: Date; ratedAt: Date | null;
  rating: number | null; topics: string[]; hasComment: boolean; classified: boolean };

function addSplit(split: SplitCount, at: Date | null, config: MonthlyAssumptions) {
  const outside = at ? outsideHumanHours(at, config) : null;
  split[outside === null ? "unclassified" : outside ? "outside" : "inside"]++;
}
const split = (): SplitCount => ({ inside: 0, outside: 0, unclassified: 0 });
const inRange = (at: Date, start: Date, end: Date) => at >= start && at < end;
function procedureOf(conversation: MonthlyConversation | undefined, config: MonthlyAssumptions): string | null {
  const raw = conversation?.variables;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[config.procedureVariable];
  if (typeof value !== "string" || !value.trim()) return null;
  return config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(value))?.name ?? value.trim();
}

export type MonthlyInput = {
  start: Date; end: Date; now: Date; trackingSince: Date; accountCreatedAt?: Date; config: MonthlyAssumptions;
  conversations: MonthlyConversation[]; appointments: MonthlyAppointment[]; events: MonthlyEvent[];
  gaps?: MonthlyGap[];
  /** Pesquisa de satisfação do mês. Ausente = sem leitura (testes, fixtures antigas): o bloco some. */
  surveys?: MonthlySurvey[];
  /** Quedas registradas do WhatsApp e desde quando são medidas. Ausente = sem leitura (testes, fixtures antigas). */
  uptime?: { trackedSince: Date | null; incidents: UptimeIncident[] };
  clinicorp: ClinicorpReportData;
  /** Área de atendimento (dentro/fora da área): só o relatório v2. */
  area?: ServiceArea | null;
};

/** Função pura compartilhada pelo painel, fechamento e PDF. Valores em centavos. */
export function calculateMonthlyMetrics(input: MonthlyInput): MonthlyMetrics {
  return evaluateMonthlyMetrics(input).metrics;
}

const bucketOf = (at: Date | null, config: MonthlyAssumptions): Bucket => {
  const outside = at ? outsideHumanHours(at, config) : null;
  return outside === null ? "unclassified" : outside ? "outside" : "inside";
};

/**
 * Os números do mês e os registros que os compõem, na mesma passada: cada
 * `continue` que tira um registro da conta também anota o motivo. Nunca
 * reconstrua a lista com outra consulta — é exatamente a divergência que ela
 * existe para explicar.
 */
export function evaluateMonthlyMetrics(input: MonthlyInput): { metrics: MonthlyMetrics; evidence: MonthlyEvidence; data: MonthlyReportData } {
  const { start, end, now, config, conversations, appointments, events, clinicorp } = input;
  const evidence = emptyEvidence();
  const iso = (at: Date | null) => at?.toISOString() ?? null;
  const includesAgent = (agentId?: string | null) => !config.agentIds?.length || Boolean(agentId && config.agentIds.includes(agentId));
  // O procedimento registrado na consulta vence a variável da conversa.
  const procedureName = (a: MonthlyAppointment, c?: MonthlyConversation) => a.procedure?.trim()
    ? config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(a.procedure!))?.name ?? a.procedure.trim()
    : procedureOf(c, config);
  const current: MonthlyMetrics = { newContacts: 0, conversations: split(), firstResponseSeconds: null,
    scheduled: split(), attended: split(), attendanceUnknown: 0, untypedAppointments: 0,
    qualified: 0, handoffs: 0, unanswered: 0, trackingComplete: input.trackingSince.getTime() <= Math.max(start.getTime(), input.accountCreatedAt?.getTime() ?? start.getTime()),
    aiOnlyConversations: 0, assumedHours: null, procedures: [], peaks: [],
    revenueCents: null, savingsCents: null, investmentCents: config.investmentCents, roiPercent: null, missing: [] };
  const byConversation = new Map(conversations.map((c) => [c.id, c]));
  const byLead = new Map(conversations.map((c) => [c.leadId, c]));
  const responseTimes: number[] = [];
  const agentResponseTimes: number[] = [];
  const hourCounts = new Map<number, number>();
  const arrivals = emptyArrivals();
  // Conversas que contaram, para dizer depois quem cuidou de cada uma.
  const counted = new Map<string, { conversation: MonthlyConversation; teamReplied: boolean; row: MonthlyEvidence["conversations"][number] }>();
  const inbound: { conversationId: string; at: Date }[] = [];
  for (const conversation of conversations) {
    if (!includesAgent(conversation.agentId)) continue;
    const messages = conversation.messages.filter((m) => inRange(m.createdAt, start, end));
    let pending: Date | null = null;
    // Uma chegada no fim do mês pode ser respondida no começo do seguinte.
    for (const message of conversation.messages.filter((m) => m.createdAt < start)) {
      if (message.role === "user") pending ??= message.createdAt;
      if (message.role === "assistant" && ["agent", "human"].includes(message.sentBy ?? "")) pending = null;
    }
    let firstPair: { inbound: Date; reply: Msg } | null = null;
    let answeredByAgent = false;
    let answeredByHuman = false;
    let inboundCount = 0;
    for (const message of messages) {
      if (message.role === "user") {
        inbound.push({ conversationId: conversation.id, at: message.createdAt });
        inboundCount++;
        pending ??= message.createdAt;
        const hour = partsInZone(message.createdAt, config.timezone).hour;
        hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
        evidence.hours[hour]++;
      } else if (message.role === "assistant" && pending && ["agent", "human"].includes(message.sentBy ?? "")) {
        firstPair ??= { inbound: pending, reply: message };
        if (message.sentBy === "agent") answeredByAgent = true;
        if (message.sentBy === "human") answeredByHuman = true;
        pending = null;
      }
      if (message.role === "assistant" && message.sentBy === "human") answeredByHuman = true;
    }
    if (firstPair) {
      const seconds = (firstPair.reply.createdAt.getTime() - firstPair.inbound.getTime()) / 1000;
      responseTimes.push(seconds);
      if (firstPair.reply.sentBy === "agent") agentResponseTimes.push(seconds);
      evidence.responses.push({ conversationId: conversation.id, inboundAt: firstPair.inbound.toISOString(),
        replyAt: firstPair.reply.createdAt.toISOString(), seconds, by: firstPair.reply.sentBy === "agent" ? "agent" : "human" });
    }
    const newContact = inRange(conversation.lead.createdAt, start, end);
    const arrival = firstPair?.inbound ?? null;
    // Conversa só com mensagem nossa no mês (follow-up, lembrete) não é atendimento.
    const row: MonthlyEvidence["conversations"][number] = { conversationId: conversation.id, arrivalAt: iso(arrival),
      bucket: bucketOf(arrival, config), counted: answeredByAgent, excluded: answeredByAgent ? null : answeredByHuman ? "human_only" : "no_reply",
      newContact, aiOnly: !answeredByHuman };
    if (answeredByAgent || inboundCount > 0) evidence.conversations.push(row);
    if (!answeredByAgent) continue;
    counted.set(conversation.id, { conversation, teamReplied: answeredByHuman, row });
    arrivals[arrivalSlot(arrival, config)]++;
    addSplit(current.conversations, arrival, config);
    if (newContact) current.newContacts++;
    if (!answeredByHuman) current.aiOnlyConversations++;
  }
  current.firstResponseSeconds = responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;
  const sorted = [...responseTimes].sort((x, z) => x - z), mid = Math.floor(sorted.length / 2);
  current.firstResponseMedianSeconds = !sorted.length ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  current.agentFirstResponseMedianSeconds = median(agentResponseTimes);
  current.arrivals = arrivals;
  if (input.uptime) current.availability = availabilityMetrics({ start, end, now, trackedSince: input.uptime.trackedSince, incidents: input.uptime.incidents, inbound });
  current.peaks = [...hourCounts].map(([hour, messages]) => ({ hour, messages })).sort((a, b) => b.messages - a.messages || a.hour - b.hour).slice(0, 3);

  const procedures = new Map<string, { qualified: Set<string>; attendedOutside: number; scheduled: number; attended: number }>();
  const getProcedure = (name: string | null) => {
    const key = name ?? "Não informado";
    const existing = [...procedures.keys()].find((p) => normalizeLabel(p) === normalizeLabel(key));
    if (existing) return procedures.get(existing)!;
    const value = { qualified: new Set<string>(), attendedOutside: 0, scheduled: 0, attended: 0 };
    procedures.set(key, value);
    return value;
  };
  const qualified = new Set<string>();
  const firstHandoff = new Map<string, Date>();
  for (const event of events.filter((e) => inRange(e.createdAt, start, end))) {
    if (!includesAgent(byConversation.get(event.conversationId)?.agentId)) continue;
    const row = (procedure: string | null = null) => evidence.events.push({ eventId: event.id ?? "", conversationId: event.conversationId,
      kind: event.kind as EventEvidence["kind"], at: event.createdAt.toISOString(), procedure });
    if (event.kind === "handoff") {
      current.handoffs++; row();
      const first = firstHandoff.get(event.conversationId);
      if (!first || event.createdAt < first) firstHandoff.set(event.conversationId, event.createdAt);
    }
    if (event.kind === "unanswered") { current.unanswered++; row(); }
    if (event.kind === "qualified") {
      qualified.add(event.conversationId);
      const explicit = event.procedure;
      const name = explicit ? config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(explicit))?.name ?? explicit
        : procedureOf(byConversation.get(event.conversationId), config);
      getProcedure(name).qualified.add(event.conversationId);
      row(name);
    }
  }
  current.qualified = qualified.size;
  // Quem cuidou de cada conversa que contou. As três partes somam os contatos
  // atendidos; a espera é do aviso de transferência até a primeira resposta de
  // uma pessoa, em tempo corrido, e para de contar no fim do mês.
  const reception: ReceptionMetrics = { agentOnly: 0, transferred: 0, teamJoined: 0, answered: 0, medianSeconds: null, overHour: 0, unanswered: 0 };
  const waits: number[] = [], cut = Math.min(now.getTime(), end.getTime());
  for (const [id, info] of counted) {
    const at = firstHandoff.get(id);
    if (!at) { reception[info.teamReplied ? "teamJoined" : "agentOnly"]++; continue; }
    reception.transferred++;
    const reply = info.conversation.messages.find((m) => m.role === "assistant" && m.sentBy === "human" && m.createdAt >= at && m.createdAt < end);
    info.row.handoffAt = at.toISOString(); info.row.teamReplyAt = reply?.createdAt.toISOString() ?? null;
    const wait = ((reply?.createdAt.getTime() ?? cut) - at.getTime()) / 1000;
    if (reply) { reception.answered++; waits.push(wait); } else reception.unanswered++;
    if (wait > RECEPTION_LONG_WAIT_SECONDS) reception.overHour++;
  }
  reception.medianSeconds = median(waits);
  current.reception = reception;
  // Tempo de resposta da equipe entra no mês da APROVAÇÃO: é quando a
  // pergunta deixou de estar sem resposta.
  const answeredGaps = (input.gaps ?? []).filter((g) => inRange(g.answeredAt, start, end) && includesAgent(g.agentId));
  current.gapsAnswered = answeredGaps.length;
  current.gapAnswerSeconds = answeredGaps.length
    ? answeredGaps.reduce((sum, g) => sum + (g.answeredAt.getTime() - g.firstAskedAt.getTime()) / 1000, 0) / answeredGaps.length
    : null;
  for (const g of answeredGaps) evidence.gaps.push({ gapId: g.id ?? "", firstAskedAt: g.firstAskedAt.toISOString(),
    answeredAt: g.answeredAt.toISOString(), seconds: (g.answeredAt.getTime() - g.firstAskedAt.getTime()) / 1000 });
  const external = new Map(clinicorp.appointments.map((a) => [a.id, a]));
  const agenda = { noShow: split(), unconfirmed: split(), upcoming: split() };
  current.agenda = agenda;
  for (const appointment of appointments) {
    if (!includesAgent(appointment.agentId)) continue;
    // Marcação manual não é do agente: nem entra na lista do relatório.
    if (appointment.source !== "agent") continue;
    const createdInMonth = inRange(appointment.createdAt, start, end), startsInMonth = inRange(appointment.startsAt, start, end);
    if (!createdInMonth && !startsInMonth) continue;
    const conversation = appointment.conversationId ? byConversation.get(appointment.conversationId) : byLead.get(appointment.leadId ?? "");
    // Receita usa a chegada do contato, jamais a hora da consulta/criação.
    const origin = conversation?.firstInbound && conversation.firstInbound <= appointment.createdAt ? conversation.firstInbound : null;
    const remote = appointment.clinicorpAppointmentId ? external.get(appointment.clinicorpAppointmentId) : undefined;
    const row: AppointmentEvidence = { appointmentId: appointment.id, conversationId: conversation?.id ?? appointment.conversationId,
      createdAt: appointment.createdAt.toISOString(), startsAt: appointment.startsAt.toISOString(), createdInMonth, startsInMonth,
      serviceType: appointment.serviceType, kind: appointment.kind ?? null, status: appointment.status, procedure: procedureName(appointment, conversation),
      clinicorp: { linked: Boolean(appointment.clinicorpAppointmentId), statusType: remote?.statusType ?? null },
      arrivalAt: iso(origin), bucket: bucketOf(origin, config), scheduled: "other_month", attended: "other_month" };
    evidence.appointments.push(row);
    if (appointment.status === "canceled") { row.scheduled = row.attended = "canceled"; continue; }
    // O tipo explícito vence; sem ele, o nome do serviço conferido nas premissas.
    const kind = parseKind(appointment.kind);
    const typed = Boolean(kind || appointment.serviceType);
    const evaluation = kind ? kind === "evaluation"
      : appointment.serviceType
        ? config.evaluationTypes.some((t) => normalizeLabel(t) === normalizeLabel(appointment.serviceType!))
        : config.countUntypedAsEvaluations;
    if (!typed && !config.countUntypedAsEvaluations) current.untypedAppointments++;
    if (!evaluation) { row.scheduled = row.attended = typed ? "not_evaluation" : "untyped"; continue; }
    if (createdInMonth) {
      addSplit(current.scheduled, origin, config);
      row.scheduled = typed ? "counted" : "counted_untyped";
      // Por procedimento contam todos os contatos; só a receita olha o horário.
      getProcedure(procedureName(appointment, conversation)).scheduled++;
      // Marcada no mês para depois: aguarda a consulta, não é falta.
      if (!remote?.canceled && (appointment.startsAt >= end || appointment.startsAt > now)) addSplit(agenda.upcoming, origin, config);
    }
    if (!startsInMonth) continue;
    if (appointment.startsAt > now) { row.attended = "future"; continue; }
    if (remote?.canceled) { row.attended = "canceled_external"; continue; }
    // Agendado ou confirmado nunca é presença: só "compareceu"/"faltou" marcados.
    const local = attendanceOf(appointment);
    let attended: boolean | null = local === "attended" ? true : local === "no_show" ? false : null;
    if (appointment.clinicorpAppointmentId) {
      // Se há espelho, conferir lá é obrigatório, mesmo com status local antigo.
      // Sem resposta de lá, vale a marcação feita na /agenda (`attendanceAt`); o
      // `done` legado não tem data e continua dependendo do Clinicorp.
      const remoteAnswer = remote?.statusType && config.completedStatusTypes.length
        ? config.completedStatusTypes.includes(remote.statusType) : null;
      attended = remoteAnswer ?? (appointment.attendanceAt ? attended : null);
    }
    if (attended === null) { current.attendanceUnknown++; row.attended = "unknown"; addSplit(agenda.unconfirmed, origin, config); continue; }
    if (!attended) {
      row.attended = "not_attended";
      // Falta é só a marcada na /agenda; status do Clinicorp que não comprova
      // presença é "sem confirmação", nunca falta presumida.
      addSplit(local === "no_show" ? agenda.noShow : agenda.unconfirmed, origin, config);
      continue;
    }
    row.attended = "attended";
    addSplit(current.attended, origin, config);
    getProcedure(procedureName(appointment, conversation)).attended++;
    if (origin && outsideHumanHours(origin, config) === true) getProcedure(procedureName(appointment, conversation)).attendedOutside++;
  }
  current.procedures = [...procedures].map(([name, value]) => {
    return { name, qualified: value.qualified.size, attendedOutside: value.attendedOutside, revenueCents: null, scheduled: value.scheduled, attended: value.attended };
  }).sort((a, b) => b.qualified - a.qualified || b.attendedOutside - a.attendedOutside);
  current.time = calculateTimeMetrics({ start, end, conversations: conversations.filter((c) => includesAgent(c.agentId)), appointments, events }, evidence);
  // Antes do corte das listas: o v2 anota os próprios registros (`contacts`, `cohort`).
  const data = buildMonthlyReportData(input, current.time, evidence, current.availability);
  return { metrics: applyMonthlyOverrides(current, {}, config), evidence: capEvidence(evidence), data };
}

export async function computeMonthlyReport(tenantId: string, month: string, useSnapshot = true, previewAssumptions?: MonthlyAssumptions): Promise<MonthlyReport> {
  const [tenant, saved] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, createdAt: true, reportTrackingStartedAt: true, planKey: true, priceCentsOverride: true, uptimeTrackedSince: true } }),
    prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } }),
  ]);
  if (useSnapshot && !previewAssumptions && saved?.status === "ready" && saved.snapshot) {
    const snapshot = saved.snapshot as unknown as MonthlyReport;
    if (snapshot.version === 1 && snapshot.month === month) return { ...snapshot,
      revision: saved.updatedAt?.toISOString(), status: saved.status, finalizedAt: saved.finalizedAt?.toISOString() ?? null,
      sentAt: saved.sentAt?.toISOString() ?? null, meetingAt: saved.meetingAt?.toISOString() ?? null };
  }
  const inherited = saved ? null : await prisma.monthlyRoiReport.findFirst({
    where: { tenantId, month: { lt: month } }, orderBy: { month: "desc" },
    select: { month: true, assumptions: true },
  });
  const assumptions = { ...(previewAssumptions ?? parseMonthlyAssumptions(saved?.assumptions ?? inherited?.assumptions ?? EMPTY_ASSUMPTIONS)) };
  const accountPrice = monthlyAccountPrice(tenant);
  const investmentSource = assumptions.investmentCents === null ? accountPrice.priceLabel : undefined;
  assumptions.investmentCents ??= accountPrice.priceCents;
  const window = monthlyWindow(month, assumptions.timezone);
  const previousSaved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month: window.previousMonth } } });
  const reopened = saved?.status === "draft" && saved.snapshot ? saved.snapshot as unknown as MonthlyReport : null;
  const previousBase = reopened?.version === 1 && reopened.month === month && reopened.previousMonth === window.previousMonth ? reopened : null;
  const originalPreviousAssumptions = previousBase?.previousAssumptions ?? parseMonthlyAssumptions(previousSaved?.assumptions ?? EMPTY_ASSUMPTIONS);
  const previousAssumptions = { ...originalPreviousAssumptions, agentIds: assumptions.agentIds };
  const previousWindow = monthlyWindow(window.previousMonth, previousAssumptions.timezone);
  const start = new Date(Math.min(window.start.getTime(), previousWindow.start.getTime()));
  const end = new Date(Math.max(window.end.getTime(), previousWindow.end.getTime()));
  const [rawConversations, appointments, events, clinicorp, gaps, lead, incidents, area, surveys] = await Promise.all([
    prisma.conversation.findMany({ where: { tenantId, isTest: false, lead: { isTest: false }, OR: [
      { messages: { some: { createdAt: { gte: start, lt: end } } } },
      { appointments: { some: { OR: [{ startsAt: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] } } },
      { reportEvents: { some: { createdAt: { gte: start, lt: end } } } },
    ] }, select: { id: true, agentId: true, leadId: true, lead: { select: { createdAt: true, status: true, disqualifiedAt: true, disqualifiedReason: true } }, variables: true,
      needsHuman: true, lastInboundAt: true, followUpReason: true,
      insight: { select: { city: true, cityKey: true, firstQuestionKey: true, lossReasonKey: true } },
      messages: { where: { createdAt: { gte: start, lt: end }, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, role: true, sentBy: true, createdAt: true, audioUrl: true, audioSeconds: true } } } }),
    prisma.appointment.findMany({ where: { tenantId, source: "agent", lead: { isTest: false },
      OR: [{ startsAt: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] },
      select: { id: true, agentId: true, conversationId: true, leadId: true, source: true, serviceType: true, status: true,
        startsAt: true, createdAt: true, clinicorpAppointmentId: true,
        kind: true, procedure: true, attendance: true, attendanceAt: true } }),
    prisma.reportEvent.findMany({ where: { tenantId, createdAt: { gte: start, lt: end }, conversation: { isTest: false, lead: { isTest: false } } },
      select: { id: true, conversationId: true, kind: true, procedure: true, createdAt: true, dedupKey: true } })
      .then((rows) => rows.map(({ dedupKey, ...event }) => ({ ...event, messageId: contextEventMessageId(event.kind, dedupKey ?? "") }))),
    readClinicorpReport(tenantId, dayKeyInZone(start, assumptions.timezone), dayKeyInZone(new Date(end.getTime() - 1), assumptions.timezone)),
    prisma.knowledgeGap.findMany({ where: { tenantId, answeredAt: { gte: start, lt: end } },
      select: { id: true, agentId: true, firstAskedAt: true, answeredAt: true } })
      .then((rows) => rows.map((g) => ({ ...g, answeredAt: g.answeredAt! }))),
    // Só o mês do relatório (não o comparativo), no mesmo escopo de agentes. É
    // um complemento: se falhar, o relatório sai sem o bloco em vez de não sair.
    loadLeadQualityDetail(tenantId, { from: window.start, to: window.end }, { agentIds: assumptions.agentIds ?? undefined })
      .catch((error) => { console.error("[monthly] qualidade dos leads indisponível", error); return undefined; }),
    // Quedas do WhatsApp que tocam a janela. Também complemento: sem a leitura,
    // a disponibilidade sai "sem registro" e o resto do relatório segue.
    Promise.resolve().then(() => prisma.whatsappIncident.findMany({ where: { tenantId, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
      select: { provider: true, startedAt: true, endedAt: true }, orderBy: { startedAt: "asc" } }))
      .catch((error) => { console.error("[monthly] quedas do WhatsApp indisponíveis", error); return undefined; }),
    getServiceArea(tenantId).catch(() => null),
    // Pesquisa de satisfação do mês do relatório (envio ou resposta nele). Também
    // complemento: sem a leitura o bloco some. O texto do comentário vira só um
    // booleano aqui, no limite da consulta — nunca segue adiante.
    loadMonthlySurveys(tenantId, window.start, window.end)
      .catch((error) => { console.error("[monthly] pesquisa de satisfação indisponível", error); return undefined; }),
  ]);
  const uptime = incidents ? { trackedSince: tenant.uptimeTrackedSince ?? null, incidents } : undefined;
  const conversationIds = rawConversations.map((c) => c.id);
  const [firstInbound, unheard] = conversationIds.length ? await Promise.all([
    // Uma consulta agregada evita buscar todo o histórico só para descobrir a chegada.
    prisma.message.groupBy({ by: ["conversationId"],
      where: { role: "user", conversation: { tenantId, isTest: false, lead: { isTest: false } }, conversationId: { in: conversationIds } }, _min: { createdAt: true } }),
    // Áudio sem transcrição: a IA não ouviu, então não é tempo que ela assumiu.
    // Consulta à parte para não carregar o texto de todas as mensagens do mês.
    prisma.message.findMany({ where: { role: "user", content: UNTRANSCRIBED_AUDIO, conversationId: { in: conversationIds }, createdAt: { gte: start, lt: end } }, select: { id: true } }),
  ]) : [[], []];
  const firstById = new Map(firstInbound.map((r) => [r.conversationId, r._min.createdAt]));
  const unheardIds = new Set(unheard.map((m) => m.id));
  const missingCities = rawConversations.filter((c) => !c.insight?.cityKey).map((c) => c.id);
  const missingCityIds = new Set(missingCities);
  const [historicalCities, previousCities, conversationStarts, previousStarts] = await Promise.all([
    loadHistoricalCities(tenantId, missingCities, window.end),
    loadHistoricalCities(tenantId, missingCities, previousWindow.end),
    loadConversationStarts(tenantId, conversationIds, window.end, window.start),
    loadConversationStarts(tenantId, conversationIds, previousWindow.end, previousWindow.start),
  ]);
  const conversations = rawConversations.map((c) => ({ ...c,
    firstMessage: conversationStarts.get(c.id) ?? null,
    insight: historicalCities.has(c.id) ? { ...c.insight, city: historicalCities.get(c.id)!.city, cityKey: historicalCities.get(c.id)!.cityKey,
      firstQuestionKey: c.insight?.firstQuestionKey ?? null, lossReasonKey: c.insight?.lossReasonKey ?? null } : c.insight, firstInbound: firstById.get(c.id) ?? null,
    messages: c.messages.map(({ audioUrl, audioSeconds, ...m }) => ({ ...m,
      audio: audioUrl || audioSeconds != null || unheardIds.has(m.id) ? { seconds: audioSeconds, heard: !unheardIds.has(m.id) } : null })) }));
  const now = new Date();
  const trackingSince = new Date(Math.max(tenant.createdAt.getTime(), tenant.reportTrackingStartedAt.getTime()));
  const { metrics: automaticCurrent, evidence, data } = evaluateMonthlyMetrics({ start: window.start, end: window.end, now, trackingSince, accountCreatedAt: tenant.createdAt, config: assumptions, conversations, appointments, events, gaps, surveys, uptime, clinicorp, area });
  if (lead) { evidence.leads = lead.leads; evidence.leadPopulation = "attended"; }
  capEvidence(evidence);
  const previousSnapshot = previousSaved?.status === "ready" && previousSaved.snapshot ? previousSaved.snapshot as unknown as MonthlyReport : null;
  const { metrics: previousAuto, data: previousData } = evaluateMonthlyMetrics({ start: previousWindow.start, end: previousWindow.end, now, trackingSince, accountCreatedAt: tenant.createdAt, config: previousAssumptions, conversations: conversations.map((c) => {
    const previousContact = { ...c, firstMessage: previousStarts.get(c.id) ?? null };
    if (!missingCityIds.has(c.id)) return previousContact;
    const old = previousCities.get(c.id);
    return { ...previousContact, insight: { city: old?.city ?? null, cityKey: old?.cityKey ?? null, firstQuestionKey: c.insight?.firstQuestionKey ?? null, lossReasonKey: c.insight?.lossReasonKey ?? null } };
  }), appointments, events, gaps, uptime, clinicorp, area });
  // Comparativo só com o mês anterior inteiro medido: conta ativa e eventos
  // registrados desde o dia 1. Senão a coluna some, em vez de sair zerada.
  if (trackingSince <= previousWindow.start) data.comparison = monthlyComparison(previousData);
  // As ações avaliadas neste mês são as do relatório anterior APROVADO: plano em rascunho não foi combinado com ninguém.
  const previousPlan = previousSnapshot?.version === 1 ? previousSnapshot.nextActions ?? [] : [];
  const samePreviousScope = sameMonthlyAgentScope(assumptions, originalPreviousAssumptions);
  const automaticPrevious = samePreviousScope && previousBase ? previousBase.previous
    : samePreviousScope && previousSnapshot?.version === 1 ? previousSnapshot.current
    : applyMonthlyOverrides(previousAuto, samePreviousScope ? parseMonthlyOverrides(previousSaved?.assumptions).current : {}, previousAssumptions);
  const metricOverrides = parseMonthlyOverrides(saved?.assumptions);
  const current = applyMonthlyOverrides(automaticCurrent, metricOverrides.current, assumptions);
  // Um comparativo fechado conserva sua base financeira quando não houve correção.
  const previous = Object.keys(metricOverrides.previous).length ? applyMonthlyOverrides(automaticPrevious, metricOverrides.previous, previousAssumptions) : automaticPrevious;
  const agentNames = assumptions.agentIds?.length ? (await prisma.agent.findMany({ where: { tenantId, id: { in: assumptions.agentIds } }, select: { name: true }, orderBy: { name: "asc" } })).map((a) => a.name) : undefined;
  const report: MonthlyReport = { version: 1, tenantName: tenant.name, month, label: new Intl.DateTimeFormat("pt-BR", { timeZone: assumptions.timezone, month: "long", year: "numeric" }).format(window.start),
    previousMonth: window.previousMonth, generatedAt: now.toISOString(), dueAt: window.dueAt.toISOString(), partial: now < window.end,
    assumptions, investmentSource, agentNames, ...(inherited ? { assumptionsFromMonth: inherited.month } : {}), revision: saved?.updatedAt?.toISOString(), metricOverrides,
    automatic: { current: automaticCurrent, previous: automaticPrevious }, previousAssumptions, previousConfigured: previousBase?.previousConfigured ?? Boolean(previousSaved), current, previous,
    clinicorpError: clinicorp.error, clinicorpStatusTypes: clinicorp.statusTypes, clinicorpIntegrationState: clinicorp.integrationState,
    adjustments: saved?.adjustments ?? "", nextMonth: saved?.nextMonth ?? "", decisionMaker: saved?.decisionMaker ?? "",
    featuredCase: saved?.featuredCase ?? "", caseFacts: parseCaseFacts(saved?.caseFacts),
    previousActions: reviewPreviousActions(previousPlan, parsePreviousActions(saved?.previousActions)),
    decisionMakerRole: saved?.decisionMakerRole ?? "", operationalContact: saved?.operationalContact ?? "",
    agentChanges: parseAgentChanges(saved?.agentChanges), snapshotVersion: saved?.version ?? 0,
    highlights: saved?.highlights ?? "", limitationsNote: saved?.limitationsNote ?? "", nextActions: parseNextActions(saved?.nextActions),
    ...(lead ? { leadQuality: lead.quality } : {}),
    evidence, data,
    status: saved?.status ?? "draft", finalizedAt: saved?.finalizedAt?.toISOString() ?? null,
    sentAt: saved?.sentAt?.toISOString() ?? null, meetingAt: saved?.meetingAt?.toISOString() ?? null };
  // Calculado aqui, com as correções já aplicadas, para o snapshot congelar o
  // selo junto com o número: o PDF e o painel leem o mesmo.
  report.quality = monthlyQuality(report);
  // Mesma regra, mesmo momento: o fechamento congela a lista que o admin confirmou.
  report.limitations = monthlyLimitations(report);
  return report;
}

/**
 * O relatório aprovado de uma competência: o snapshot congelado no fechamento,
 * e só ele. É o que a clínica recebe (painel e PDF) — rascunho, relatório
 * reaberto e fechamento sem snapshot válido devolvem `null`, nunca um cálculo
 * feito na hora no lugar do que foi aprovado.
 */
export async function loadApprovedReport(tenantId: string, month: string): Promise<MonthlyReport | null> {
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
  if (saved?.status !== "ready" || !saved.snapshot) return null;
  const snapshot = saved.snapshot as unknown as MonthlyReport;
  if (snapshot.version !== 1 || snapshot.month !== month) return null;
  return { ...snapshot, revision: saved.updatedAt?.toISOString(), status: saved.status, finalizedAt: saved.finalizedAt?.toISOString() ?? null,
    sentAt: saved.sentAt?.toISOString() ?? null, meetingAt: saved.meetingAt?.toISOString() ?? null };
}

export type MonthlyCaseCandidate ={ conversationId: string; firstAt: string; audios: number[];
  /** Dia da semana e período do primeiro áudio longo, no fuso da clínica, e se o contato agendou no mês. */
  weekday: number; period: CasePeriod; scheduled: boolean };

/**
 * Conversas do mês em que o agente ouviu áudios longos, com o que se mede
 * delas. `conversationId` restringe a uma (para gravar os fatos do caso); o
 * filtro de conta e de agentes é sempre o do relatório.
 */
async function readCaseConversations(tenantId: string, month: string, config: MonthlyAssumptions, conversationId?: string): Promise<MonthlyCaseCandidate[]> {
  const window = monthlyWindow(month, config.timezone);
  const rows = await prisma.message.findMany({
    where: { role: "user", audioSeconds: { gt: LONG_AUDIO_SECONDS }, content: { not: UNTRANSCRIBED_AUDIO },
      createdAt: { gte: window.start, lt: window.end }, ...(conversationId ? { conversationId } : {}),
      conversation: { tenantId, isTest: false, lead: { isTest: false }, ...(config.agentIds?.length ? { agentId: { in: config.agentIds } } : {}) } },
    select: { conversationId: true, audioSeconds: true, createdAt: true }, orderBy: { audioSeconds: "desc" }, take: 200,
  });
  const byConversation = new Map<string, { first: Date; audios: { at: Date; seconds: number }[] }>();
  for (const row of rows) {
    const entry = byConversation.get(row.conversationId) ?? { first: row.createdAt, audios: [] };
    entry.audios.push({ at: row.createdAt, seconds: row.audioSeconds! });
    if (row.createdAt < entry.first) entry.first = row.createdAt;
    byConversation.set(row.conversationId, entry);
  }
  const longest = (audios: { seconds: number }[]) => Math.max(...audios.map((a) => a.seconds));
  const top = [...byConversation].sort(([, a], [, b]) => longest(b.audios) - longest(a.audios) || b.audios.length - a.audios.length).slice(0, 5);
  // O caso pode ser de quem não agendou: o dado entra como fato, não como filtro.
  const booked = top.length ? await prisma.appointment.findMany({
    where: { tenantId, source: "agent", status: { not: "canceled" }, conversationId: { in: top.map(([id]) => id) }, createdAt: { gte: window.start, lt: window.end } },
    select: { conversationId: true },
  }) : [];
  const scheduled = new Set(booked.map((a) => a.conversationId));
  return top.map(([id, entry]) => {
    const local = partsInZone(entry.first, config.timezone);
    return { conversationId: id, firstAt: entry.first.toISOString(), weekday: local.weekday, period: casePeriod(local.hour), scheduled: scheduled.has(id),
      audios: entry.audios.sort((a, b) => a.at.getTime() - b.at.getTime()).map((a) => a.seconds) };
  });
}

/**
 * Sugestões para o caso do mês (só no admin, nunca no snapshot nem no PDF):
 * conversas em que o agente ouviu áudios longos. A Mavellium abre a conversa,
 * confere o que aconteceu e escreve o caso só com o perfil genérico.
 */
export function loadMonthlyCaseCandidates(tenantId: string, month: string, config: MonthlyAssumptions): Promise<MonthlyCaseCandidate[]> {
  return readCaseConversations(tenantId, month, config);
}

/**
 * Os fatos do caso, lidos da conversa escolhida: duração de cada áudio, dia da
 * semana e período. O formulário só informa qual conversa e a idade — duração
 * é medida, nunca digitada. `null` = a conversa não é desta conta, deste mês ou
 * não tem áudio longo ouvido pelo agente.
 */
export async function loadMonthlyCaseFacts(tenantId: string, month: string, config: MonthlyAssumptions, conversationId: string, age: number | null): Promise<CaseFacts | null> {
  const [found] = await readCaseConversations(tenantId, month, config, conversationId);
  if (!found) return null;
  return { conversationId, age, audioSeconds: found.audios.slice(0, CASE_AUDIOS_MAX), weekday: found.weekday, period: found.period, scheduled: found.scheduled };
}
