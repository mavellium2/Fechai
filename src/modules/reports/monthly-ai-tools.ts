import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { LlmToolSchema } from "@/modules/ai/types";
import { formatBRL } from "@/lib/format";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import { listWhatsappChannels } from "@/modules/whatsapp/instances";
import { KIND_LABELS, parseKind } from "@/modules/scheduling/dimensions";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { monthlyWindow } from "./monthly-config";
import type { MonthlyReport } from "./monthly";
import { ATTENDED_LABEL, BUCKET_LABEL, SCHEDULED_LABEL, bucketReason, type AppointmentAttended, type AppointmentEvidence, type AppointmentScheduled } from "./monthly-evidence";

/*
 * Ferramentas do assistente do relatório mensal: SOMENTE LEITURA.
 *
 * O assistente deixa de depender só do resumo do mês e investiga os registros
 * originais. Regras que não se quebram:
 *
 * - Agendamentos, conversas e eventos vêm de `report.evidence`, a MESMA
 *   passada que gerou os números (`evaluateMonthlyMetrics`). Consultar o banco
 *   com outra regra criaria exatamente a divergência que se quer explicar.
 * - O escopo é o do relatório: tenant da action, competência e agentes da
 *   revisão. `get_conversation` só abre conversa que está nos registros do
 *   mês — um id inventado ou de outra conta devolve "não encontrado".
 * - Nenhuma ferramenta devolve nome, telefone, e-mail ou texto de mensagem,
 *   nem credencial de integração. A equipe da Mavellium não é da clínica, e
 *   o que vai ao provedor de IA segue a mesma regra dos registros do painel.
 * - O servidor anota cada consulta (`consulted`): é isso que aparece como
 *   "Evidências consultadas", não o que a IA diz ter lido.
 * - Nada aqui grava. A lista de conferência que a IA pode propor é montada
 *   pelo servidor, a partir dos registros, e só aparece depois de a pessoa
 *   confirmar.
 */

export const MONTHLY_AI_TOOL_ROWS = 60;

const SCHEDULED = Object.keys(SCHEDULED_LABEL) as [AppointmentScheduled, ...AppointmentScheduled[]];
const ATTENDED = Object.keys(ATTENDED_LABEL) as [AppointmentAttended, ...AppointmentAttended[]];
const BUCKETS = ["inside", "outside", "unclassified"] as const;
const limit = z.number().int().min(1).max(MONTHLY_AI_TOOL_ROWS).optional();

const appointmentArgs = z.object({
  scheduled: z.enum(SCHEDULED).optional(), attended: z.enum(ATTENDED).optional(),
  untyped: z.boolean().optional(), bucket: z.enum(BUCKETS).optional(), limit,
}).strict();
const conversationArgs = z.object({
  counted: z.boolean().optional(), excluded: z.enum(["human_only", "no_reply"]).optional(),
  bucket: z.enum(BUCKETS).optional(), newContact: z.boolean().optional(), limit,
}).strict();
const eventArgs = z.object({ kind: z.enum(["qualified", "handoff", "unanswered"]).optional(), limit }).strict();
const conversationIdArgs = z.object({ conversationId: z.string().trim().min(1).max(100) }).strict();
const noArgs = z.object({}).strict();

const TOOL_ARGS = {
  list_appointments: appointmentArgs, list_conversations: conversationArgs, list_events: eventArgs,
  get_conversation: conversationIdArgs, get_configuration: noArgs, get_integrations: noArgs,
} as const;
export type MonthlyAiToolName = keyof typeof TOOL_ARGS;

export const MONTHLY_AI_TOOLS: LlmToolSchema[] = [
  { name: "list_appointments", description: "Lista os agendamentos do agente que entram na conta do mês (criados ou com consulta na competência), com tipo, status, procedimento, vínculo e status do Clinicorp, chegada do contato, classificação de horário e o critério que decidiu se contou em 'agendadas' e em 'realizadas'. Filtros combinam (E). Sem dados de paciente.",
    parameters: { type: "object", properties: {
      scheduled: { type: "string", enum: SCHEDULED, description: "Critério em 'avaliações agendadas'." },
      attended: { type: "string", enum: ATTENDED, description: "Critério em 'avaliações realizadas'." },
      untyped: { type: "boolean", description: "true = sem tipo explícito e sem nome de serviço." },
      bucket: { type: "string", enum: BUCKETS, description: "Horário de chegada do contato: dentro, fora ou sem classificação." },
      limit: { type: "integer", description: `Linhas devolvidas (máx. ${MONTHLY_AI_TOOL_ROWS}). O total vem sempre.` },
    } } },
  { name: "list_conversations", description: "Lista as conversas com mensagem do contato no mês: se contaram em 'conversas respondidas' e, se não, por quê; horário da chegada e classificação; se o contato é novo; se ficou só com a IA.",
    parameters: { type: "object", properties: {
      counted: { type: "boolean" }, excluded: { type: "string", enum: ["human_only", "no_reply"] },
      bucket: { type: "string", enum: BUCKETS }, newContact: { type: "boolean" }, limit: { type: "integer" },
    } } },
  { name: "list_events", description: "Lista os eventos registrados pelo agente no mês: qualificado (com procedimento), transbordo e pergunta sem resposta.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["qualified", "handoff", "unanswered"] }, limit: { type: "integer" } } } },
  { name: "get_conversation", description: "Linha do tempo de UMA conversa que aparece nos registros do mês: quem falou e quando (contato, agente, equipe), texto ou áudio e duração, canal, e os agendamentos e eventos dela. Não devolve o texto das mensagens nem dados do contato.",
    parameters: { type: "object", properties: { conversationId: { type: "string" } }, required: ["conversationId"] } },
  { name: "get_configuration", description: "Premissas da revisão (expediente, tipos considerados avaliação, status de comparecimento, procedimentos, custos) e a configuração de agendamento dos agentes do escopo (se a ação está ligada e quais tipos de atendimento o agente consegue registrar).",
    parameters: { type: "object", properties: {} } },
  { name: "get_integrations", description: "Estado das integrações da conta que afetam o relatório: Clinicorp (conexão, erro de leitura, status disponíveis, agendamentos vinculados), Google Agenda e WhatsApp (provedor e status). Nunca devolve credenciais.",
    parameters: { type: "object", properties: {} } },
];

export type MonthlyAiConsulted = { tool: MonthlyAiToolName; label: string; count: number };
export type MonthlyAiAgent = { id: string; name: string; isPrimary: boolean; archived: boolean; actions: { key: string; enabled?: boolean; config: unknown }[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isUntyped = (a: AppointmentEvidence) => !parseKind(a.kind) && !a.serviceType;
const typeOf = (a: AppointmentEvidence) => { const kind = parseKind(a.kind); return kind ? KIND_LABELS[kind] : a.serviceType; };

export function createMonthlyAiToolbox(ctx: { tenantId: string; report: MonthlyReport; agents: MonthlyAiAgent[] }) {
  const { report } = ctx;
  const tz = report.assumptions.timezone;
  const evidence = report.evidence;
  const at = (iso: string | null) => iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : null;
  const consulted: MonthlyAiConsulted[] = [];
  /** Agendamentos que alguma ferramenta devolveu nesta resposta: só eles podem ir para uma lista proposta. */
  const seenAppointments = new Set<string>();
  const note = (tool: MonthlyAiToolName, label: string, count: number) => consulted.push({ tool, label, count });
  const page = <T,>(rows: T[], n = MONTHLY_AI_TOOL_ROWS) => ({ total: rows.length, shown: Math.min(rows.length, n), rows: rows.slice(0, n) });
  const cut = (key: keyof NonNullable<MonthlyReport["evidence"]>["truncated"]) => evidence?.truncated[key]
    ? `A lista guardada foi cortada em ${evidence[key]?.length} de ${evidence.truncated[key]} registros; os números do relatório não.` : undefined;

  const appointmentRow = (a: AppointmentEvidence) => ({
    id: a.appointmentId, conversationId: a.conversationId, criado: at(a.createdAt), consulta: at(a.startsAt),
    tipo: typeOf(a) ?? null, semTipo: isUntyped(a), status: a.status, procedimento: a.procedure,
    clinicorp: a.clinicorp.linked ? a.clinicorp.statusType ?? "vinculado, sem status lido" : "sem vínculo",
    chegadaDoContato: at(a.arrivalAt), horario: BUCKET_LABEL[a.bucket], motivoSemHorario: bucketReason(a.bucket, a.arrivalAt),
    agendadas: SCHEDULED_LABEL[a.scheduled], realizadas: ATTENDED_LABEL[a.attended],
  });

  async function run(name: string, raw: Record<string, unknown>): Promise<string> {
    if (!Object.hasOwn(TOOL_ARGS, name)) return JSON.stringify({ erro: "Ferramenta inexistente." });
    const tool = name as MonthlyAiToolName;
    const parsed = TOOL_ARGS[tool].safeParse(raw ?? {});
    if (!parsed.success) return JSON.stringify({ erro: "Argumentos inválidos para esta ferramenta." });
    if (!evidence && ["list_appointments", "list_conversations", "list_events", "get_conversation"].includes(tool)) {
      return JSON.stringify({ erro: "Este relatório não tem registros guardados (fechado antes deles)." });
    }
    try {
      switch (tool) {
        case "list_appointments": {
          const f = parsed.data as z.infer<typeof appointmentArgs>;
          const rows = evidence!.appointments.filter((a) => (!f.scheduled || a.scheduled === f.scheduled) && (!f.attended || a.attended === f.attended)
            && (f.untyped === undefined || isUntyped(a) === f.untyped) && (!f.bucket || a.bucket === f.bucket));
          const described = [f.untyped === true && "sem tipo", f.untyped === false && "com tipo", f.bucket && (f.bucket === "unclassified" ? "sem classificação de horário" : `${BUCKET_LABEL[f.bucket].toLowerCase()} do horário`),
            f.scheduled && `agendadas: ${SCHEDULED_LABEL[f.scheduled].toLowerCase()}`, f.attended && `realizadas: ${ATTENDED_LABEL[f.attended].toLowerCase()}`].filter(Boolean);
          note(tool, `${plural(rows.length, "registro de agendamento", "registros de agendamento")}${described.length ? ` ${described.join(", ")}` : ""}`, rows.length);
          const out = page(rows, f.limit);
          out.rows.forEach((a) => seenAppointments.add(a.appointmentId));
          return JSON.stringify({ ...out, rows: out.rows.map(appointmentRow), aviso: cut("appointments"),
            noRelatorio: { agendadas: report.current.scheduled, realizadas: report.current.attended, semTipo: report.current.untypedAppointments, presencaPendente: report.current.attendanceUnknown } });
        }
        case "list_conversations": {
          const f = parsed.data as z.infer<typeof conversationArgs>;
          const rows = evidence!.conversations.filter((c) => (f.counted === undefined || c.counted === f.counted) && (!f.excluded || c.excluded === f.excluded)
            && (!f.bucket || c.bucket === f.bucket) && (f.newContact === undefined || c.newContact === f.newContact));
          note(tool, plural(rows.length, "registro de conversa", "registros de conversa"), rows.length);
          const out = page(rows, f.limit);
          return JSON.stringify({ ...out, aviso: cut("conversations"), rows: out.rows.map((c) => ({ id: c.conversationId, chegada: at(c.arrivalAt), horario: BUCKET_LABEL[c.bucket],
            contou: c.counted, foraPorque: c.excluded === "human_only" ? "só a equipe respondeu" : c.excluded === "no_reply" ? "ninguém respondeu no mês" : null, contatoNovo: c.newContact, soIA: c.aiOnly })),
            noRelatorio: { conversas: report.current.conversations, novosContatos: report.current.newContacts } });
        }
        case "list_events": {
          const f = parsed.data as z.infer<typeof eventArgs>;
          const rows = evidence!.events.filter((e) => !f.kind || e.kind === f.kind);
          note(tool, plural(rows.length, "evento registrado", "eventos registrados"), rows.length);
          const out = page(rows, f.limit);
          return JSON.stringify({ ...out, aviso: cut("events"), rows: out.rows.map((e) => ({ id: e.eventId, conversationId: e.conversationId, tipo: e.kind, em: at(e.at), procedimento: e.procedure })),
            coberturaCompleta: report.current.trackingComplete });
        }
        case "get_conversation": {
          const { conversationId } = parsed.data as z.infer<typeof conversationIdArgs>;
          const known = evidence!.conversations.some((c) => c.conversationId === conversationId)
            || evidence!.appointments.some((a) => a.conversationId === conversationId) || evidence!.events.some((e) => e.conversationId === conversationId);
          if (!known) return JSON.stringify({ erro: "Conversa não encontrada nos registros deste relatório." });
          const window = monthlyWindow(report.month, tz);
          const row = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId: ctx.tenantId, isTest: false },
            select: { whatsappProvider: true, variables: true, lead: { select: { createdAt: true, status: true } },
              messages: { where: { createdAt: { gte: window.start, lt: window.end }, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200,
                select: { role: true, sentBy: true, createdAt: true, audioUrl: true, audioSeconds: true } } } });
          if (!row) return JSON.stringify({ erro: "Conversa não encontrada nos registros deste relatório." });
          note(tool, "1 linha do tempo de conversa", 1);
          const variables = row.variables && typeof row.variables === "object" && !Array.isArray(row.variables) ? row.variables as Record<string, unknown> : {};
          const procedure = variables[report.assumptions.procedureVariable];
          const appointments = evidence!.appointments.filter((a) => a.conversationId === conversationId);
          appointments.forEach((a) => seenAppointments.add(a.appointmentId));
          return JSON.stringify({ id: conversationId, canal: row.whatsappProvider ?? "não registrado", contatoCriadoEm: at(row.lead?.createdAt.toISOString() ?? null), statusDoContato: row.lead?.status ?? null,
            procedimentoNaConversa: typeof procedure === "string" ? procedure.slice(0, 60) : null,
            mensagensNoMes: row.messages.map((m) => ({ em: at(m.createdAt.toISOString()), de: m.role === "user" ? "contato" : m.sentBy === "agent" ? "agente" : m.sentBy === "human" ? "equipe" : "automático",
              formato: m.audioUrl || m.audioSeconds != null ? "áudio" : "texto", segundos: m.audioSeconds })),
            registro: evidence!.conversations.find((c) => c.conversationId === conversationId) ?? null,
            agendamentos: appointments.map(appointmentRow), eventos: evidence!.events.filter((e) => e.conversationId === conversationId).map((e) => ({ tipo: e.kind, em: at(e.at), procedimento: e.procedure })) });
        }
        case "get_configuration": {
          const c = report.assumptions;
          const scope = c.agentIds?.length ? ctx.agents.filter((a) => c.agentIds!.includes(a.id)) : ctx.agents;
          note(tool, "configuração da revisão e dos agentes", 1);
          const time = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          return JSON.stringify({
            premissas: { fuso: tz, diasSemRecepcao: c.humanClosedDates ?? [], expediente: c.humanHours ? c.humanHours.map((day, i) => `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][i]} ${day.map((p) => `${time(p.start)}-${time(p.end)}`).join(",") || "fechado"}`) : "não conferido",
              tiposAvaliacao: c.evaluationTypes, semTipoContaComoAvaliacao: c.countUntypedAsEvaluations, statusQueComprovamComparecimento: c.completedStatusTypes,
              variavelDoProcedimento: c.procedureVariable, procedimentos: c.procedures.map((p) => ({ nome: p.name, ticket: p.ticketCents === null ? null : formatBRL(p.ticketCents), conversao: p.conversionBps === null ? null : `${p.conversionBps / 100}%` })),
              custoAtendente: c.attendantMonthlyCents === null ? null : formatBRL(c.attendantMonthlyCents), cargaMensal: c.attendantMonthlyHours, segundosPorMensagem: c.secondsPerMessage, minutosPorConversa: c.minutesPerConversation,
              mensalidade: c.investmentCents === null ? null : formatBRL(c.investmentCents) },
            agentes: scope.map((a) => {
              const action = a.actions.find((x) => x.key === "schedule_meeting");
              const schedule = action ? parseScheduleConfig(action.config) : null;
              return { nome: a.name, principal: a.isPrimary, arquivado: a.archived, agendamento: !action ? "ação não configurada" : action.enabled === false ? "desligado" : "ligado",
                tiposQueOAgenteRegistra: schedule ? [...new Set([...schedule.durations.map((d) => d.label), ...schedule.reminderTypes])] : [] };
            }),
          });
        }
        case "get_integrations": {
          note(tool, "estado das integrações", 1);
          const [features, channels] = await Promise.all([
            getCalendarFeatures(ctx.tenantId).catch(() => null),
            listWhatsappChannels(ctx.tenantId).then((rows) => rows.map((r) => ({ provedor: r.provider === "meta" ? "meta" : "evolution", status: r.status }))).catch(() => null),
          ]);
          return JSON.stringify({
            clinicorp: { ligadoNaConta: features?.clinicorpEnabled ?? "indisponível", estado: report.clinicorpIntegrationState ?? "sem registro", erroNaLeitura: report.clinicorpError,
              statusDisponiveis: report.clinicorpStatusTypes.map((s) => ({ id: s.type, nome: s.description })),
              agendamentosVinculados: evidence ? evidence.appointments.filter((a) => a.clinicorp.linked).length : null },
            googleAgenda: { ligadoNaConta: features?.googleEnabled ?? "indisponível" },
            calendarioApple: { ligadoNaConta: features?.icloudEnabled ?? "indisponível" },
            whatsapp: channels ?? "indisponível",
          });
        }
      }
    } catch (error) {
      console.error("[monthly-ai-tools] consulta falhou", error);
      return JSON.stringify({ erro: "A consulta falhou. Responda sem este dado e diga que não foi possível consultá-lo." });
    }
  }
  /** Lista proposta pela IA: só com agendamentos que as ferramentas devolveram nesta resposta. */
  const reviewRows = (ids: string[]) => monthlyReviewRows(report, [...new Set(ids)].filter((id) => seenAppointments.has(id)));
  const reset = () => { consulted.length = 0; seenAppointments.clear(); };
  return { run, consulted, reviewRows, reset, tools: MONTHLY_AI_TOOLS };
}
export type MonthlyAiToolbox = ReturnType<typeof createMonthlyAiToolbox>;

export type MonthlyReviewRow = { appointmentId: string; conversationId: string | null; when: string; issues: string[] };

/**
 * Lista de conferência para a recepção, montada pelo servidor a partir dos
 * registros (nunca pelo texto da IA). Identifica a consulta pela data e hora,
 * que a recepção acha na agenda, sem nome de paciente.
 */
export function monthlyReviewRows(report: MonthlyReport, ids: string[]): MonthlyReviewRow[] {
  const tz = report.assumptions.timezone;
  const fmt = (iso: string, withTime = true) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(iso));
  const byId = new Map((report.evidence?.appointments ?? []).map((a) => [a.appointmentId, a]));
  return ids.flatMap((id) => {
    const a = byId.get(id);
    if (!a) return [];
    const issues = [
      isUntyped(a) && "sem tipo de atendimento: era avaliação?",
      a.attended === "unknown" && "comparecimento não confirmado: a pessoa compareceu?",
      a.bucket === "unclassified" && !a.arrivalAt && "sem mensagem do contato antes da marcação (conferência interna)",
    ].filter((v): v is string => Boolean(v));
    return [{ appointmentId: id, conversationId: a.conversationId, when: `Consulta de ${fmt(a.startsAt)} (marcada em ${fmt(a.createdAt, false)})`, issues: issues.length ? issues : ["conferir o registro na agenda"] }];
  });
}
