import { formatBRL } from "@/lib/format";
import { leadQualityHeadline } from "@/modules/lead-insights/summary";
import type { MonthlyReport, SplitCount } from "./monthly";
import { financialEnabled } from "./monthly-config";
import type { MonthlySatisfaction } from "./monthly-data";
import { formatDuration, timeBreakdown, timeHeadline } from "./monthly-time";
import { ARRIVAL_LABEL, type ArrivalSlot } from "./monthly-operations";
import { caseFactItems } from "./monthly-case";
import type { PreviousAction } from "./monthly-previous-actions";
import type { QualityKey } from "./monthly-quality";

/*
 * O conteúdo do relatório mensal que o decisor lê (PDF e topo do painel).
 *
 * Decisão de 30/09/2026: tudo que puder ser medido aparece, e TODOS os contatos
 * entram, de dentro e de fora do expediente — o agente atende todos igual. A
 * divisão por expediente é um detalhe dentro de cada número. A regra
 * conservadora (receita só de quem chegou com a recepção fechada) vale apenas
 * no bloco opcional de retorno estimado, que só existe ligado e calculado
 * (`monthlyFinancial`); senão o bloco some — nunca "pendente", nunca zero.
 *
 * Puro. PDF e painel leem daqui para mostrarem exatamente o mesmo, e nenhum
 * texto deste módulo diz "pendente" ou "não verificado": número que não dá
 * para mostrar vira travessão com a explicação ao lado. Nada aqui é escrito
 * por IA: são os números do motor de dados, já validados.
 */

export type ExecutiveKpi = { key: QualityKey; label: string; value: string; hint: string;
  /** Comparação com o mês anterior ou o que ainda falta acontecer. */
  delta?: string;
  /** A métrica âncora do relatório. */
  anchor?: boolean };
export type ExecutiveFinancial = { revenueCents: number; savingsCents: number; investmentCents: number | null; roiPercent: number };
/** `estimate`: a linha leva o selo "estimativa" (só as estimadas levam). */
export type ExecRow = { cells: string[]; estimate?: boolean; strong?: boolean };
export type ExecTable = { title: string; head: string[]; rows: ExecRow[]; note?: string };
export type ExecutiveSummary = {
  /** A frase que abre o relatório. */
  lede: string;
  /** Na ordem do modelo: contatos, avaliações agendadas (âncora), comparecimentos, primeira resposta. */
  kpis: ExecutiveKpi[];
  attendance: string[];
  /** Pesquisa de satisfação (sub-bloco do atendimento): vazio sem respostas no mês. */
  satisfaction: string[];
  agenda: string[];
  adjustments: string;
  /** Perguntas em que o agente ficou sem resposta, com o mês anterior. */
  questions: string | null;
  /** Ações combinadas no relatório anterior, já avaliadas. */
  previousActions: PreviousAction[];
  /** Fatos medidos do caso do mês (idade, dia e período, áudios). */
  caseItems: string[];
  leads: string;
  tables: Record<"time" | "arrivals" | "reception" | "outcome" | "procedures" | "doubts" | "reasons", ExecTable | null> & { funnel: ExecTable };
  /** "O que não saiu como planejado": aparece sempre. Sem nada comprovado, diz `NO_INCIDENT`. */
  unplanned: { note: string; incidents: string[]; limitations: string[]; none: boolean };
  financial: ExecutiveFinancial | null;
};

/** Sem incidente comprovado nos dados nem texto da revisão. Ninguém inventa problema para preencher a seção. */
export const NO_INCIDENT = "Nenhum incidente relevante identificado neste mês.";
/** Acima disto as quedas saem resumidas numa linha, em vez de uma por queda. */
const INCIDENTS_LISTED = 3;

const total = (s: SplitCount) => s.inside + s.outside + s.unclassified;
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const count = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;
const pct = (part: number, whole: number) => whole > 0 ? `${Math.round(part / whole * 100)}%` : null;
const seconds = (s: number) => s < 60 ? `${Math.round(s)} s` : formatDuration(s);
const versus = (now: number, before: number) => now === before ? "igual ao mês anterior" : `${now > before ? "+" : "−"}${n(Math.abs(now - before))} vs. mês anterior`;

/** Retorno estimado ligado E calculado. É a única porta para dinheiro aparecer. */
export function monthlyFinancial(r: Pick<MonthlyReport, "current" | "assumptions">): ExecutiveFinancial | null {
  const a = r.current;
  if (!financialEnabled(r.assumptions) || a.revenueCents === null || a.savingsCents === null || a.roiPercent === null) return null;
  return { revenueCents: a.revenueCents, savingsCents: a.savingsCents, investmentCents: a.investmentCents, roiPercent: a.roiPercent };
}

/**
 * Incidentes comprovados pelos dados do mês: faltas, quedas do agente e
 * conversas que a recepção deixou esperando. Só o que os registros mostram —
 * é daqui (e das limitações) que a seção "O que não saiu como planejado" sai.
 */
export function monthlyIncidents(r: Pick<MonthlyReport, "current" | "assumptions">): string[] {
  const a = r.current, out: string[] = [];
  const noShow = a.agenda ? total(a.agenda.noShow) : 0;
  if (noShow) out.push(`${count(noShow, "falta", "faltas")}: ${pct(noShow, noShow + total(a.attended))} das consultas com presença ou falta registrada.`);
  const availability = a.availability;
  if (availability?.incidents.length) {
    const zone = r.assumptions.timezone;
    const day = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, day: "2-digit", month: "2-digit" });
    const hour = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
    const waited = (contacts: number) => contacts ? ` ${count(contacts, "contato escreveu", "contatos escreveram")} nesse período e ${contacts === 1 ? "esperou" : "esperaram"} a conexão voltar.` : "";
    if (availability.incidents.length > INCIDENTS_LISTED) {
      out.push(`O agente ficou fora do ar ${availability.incidents.length} vezes, ${formatDuration(availability.downSeconds)} no total.${waited(availability.contactsAffected)}`);
    } else for (const incident of availability.incidents) {
      const from = new Date(incident.startedAt);
      const until = incident.endedAt ? `, das ${hour.format(from)} às ${hour.format(new Date(incident.endedAt))}` : `, desde as ${hour.format(from)}, e seguia fora no fim do período`;
      out.push(`O agente ficou ${formatDuration(incident.seconds)} fora do ar em ${day.format(from)}${until}.${waited(incident.contacts)}`);
    }
  }
  const reception = a.reception;
  if (reception && (reception.overHour || reception.unanswered)) {
    const waiting = reception.overHour ? `${count(reception.overHour, "conversa passada para a recepção esperou", "conversas passadas para a recepção esperaram")} mais de 1 hora` : "";
    const open = reception.unanswered ? `${count(reception.unanswered, "seguia", "seguiam")} sem resposta no fim do mês` : "";
    out.push(waiting && open ? `${waiting}, e ${open}.` : waiting ? `${waiting}.` : `${count(reception.unanswered, "conversa passada para a recepção seguia", "conversas passadas para a recepção seguiam")} sem resposta no fim do mês.`);
  }
  return out;
}

/**
 * As frases da pesquisa de satisfação, só com respostas no mês. A média só
 * entra com 5 ou mais respostas; antes disso, "amostra pequena". Os motivos
 * são os do conjunto fechado, nunca o texto de um comentário.
 */
export function satisfactionLines(sat: MonthlySatisfaction | undefined): string[] {
  if (!sat || sat.answered === 0) return [];
  const rate = sat.responseRatePercent === null ? "" : ` (${n(sat.responseRatePercent)}% dos ${n(sat.sent)} contatos que receberam a pesquisa)`;
  const head = sat.smallSample || sat.average.value === null
    ? `${count(sat.answered, "contato respondeu", "contatos responderam")} à pesquisa de satisfação${rate}: amostra pequena para calcular uma média.`
    : `Nota média ${n(sat.average.value)} de 5, em ${count(sat.answered, "resposta", "respostas")}${rate}.`;
  const topics = sat.improvementTopics.length
    ? [`Pontos de melhoria mais citados: ${sat.improvementTopics.map((t) => `${t.label} (${n(t.count)})`).join(", ")}.`] : [];
  return [head, ...topics];
}

export function executiveSummary(r: MonthlyReport): ExecutiveSummary {
  const a = r.current, b = r.previous, hours = Boolean(r.assumptions.humanHours), t = a.time;
  const monthName = r.label.split(" de ")[0];
  const financial = monthlyFinancial(r);
  const contacts = total(a.conversations), scheduled = total(a.scheduled), attended = total(a.attended);
  const split = (s: SplitCount) => hours ? `${n(s.inside)} no expediente · ${n(s.outside)} fora` : "";
  const noShow = a.agenda ? total(a.agenda.noShow) : 0, upcoming = a.agenda ? total(a.agenda.upcoming) : 0, unconfirmed = a.agenda ? total(a.agenda.unconfirmed) : a.attendanceUnknown;
  const rate = pct(attended, attended + noShow);

  // Agente e recepção ficam sempre separados; snapshot antigo só tem o tempo misturado.
  const agentOnly = a.agentFirstResponseMedianSeconds !== undefined;
  const median = agentOnly || a.firstResponseMedianSeconds !== undefined;
  const first = agentOnly ? a.agentFirstResponseMedianSeconds ?? null : a.firstResponseMedianSeconds !== undefined ? a.firstResponseMedianSeconds ?? null : a.firstResponseSeconds;
  const firstBefore = agentOnly ? b.agentFirstResponseMedianSeconds : a.firstResponseMedianSeconds !== undefined ? b.firstResponseMedianSeconds : b.firstResponseSeconds;

  const kpis: ExecutiveKpi[] = [
    { key: "conversations", label: "Contatos atendidos", value: n(contacts), hint: split(a.conversations) || "conversas respondidas pelo agente", delta: versus(contacts, total(b.conversations)) },
    { key: "scheduled", label: "Avaliações agendadas", value: n(scheduled), hint: split(a.scheduled) || "pelo agente no mês", delta: versus(scheduled, total(b.scheduled)), anchor: true },
    { key: "attended", label: "Compareceram", value: n(attended), hint: noShow && rate ? `${rate} das consultas com presença ou falta registrada` : "avaliações realizadas",
      delta: upcoming ? `${count(upcoming, "ainda vai", "ainda vão")} acontecer` : unconfirmed ? `${count(unconfirmed, "aguarda", "aguardam")} confirmação` : versus(attended, total(b.attended)) },
    { key: "firstResponse", label: agentOnly ? "1ª resposta do agente" : "Primeira resposta", value: first === null ? "—" : seconds(first),
      hint: first === null ? "sem respostas no mês" : agentOnly ? "mediana · 24h por dia" : median ? "mediana" : "média",
      ...(first !== null && firstBefore != null ? { delta: `era ${seconds(firstBefore)} no mês anterior` } : {}) },
  ];

  const lede = [
    `Em ${monthName}, o Fechai atendeu ${count(contacts, "contato", "contatos")} e marcou ${count(scheduled, "avaliação", "avaliações")}.`,
    attended ? `${count(attended, "paciente já compareceu", "pacientes já compareceram")}.` : "",
    hours && a.conversations.outside ? `${count(a.conversations.outside, "contato chegou", "contatos chegaram")} com a recepção fechada e ${a.conversations.outside === 1 ? "foi atendido" : "foram atendidos"} do mesmo jeito.` : "",
  ].filter(Boolean).join(" ");

  // Só o agente + recepção + equipe têm de somar os contatos; correção manual que quebra a soma cai na frase antiga.
  const reception = a.reception && a.reception.agentOnly + a.reception.transferred + a.reception.teamJoined === contacts ? a.reception : null;
  const availability = a.availability;
  const attendance = [
    `${count(contacts, "contato atendido", "contatos atendidos")}, ${a.newContacts === 1 ? "1 novo" : `${n(a.newContacts)} novos`}${hours ? `: ${n(a.conversations.inside)} no expediente e ${n(a.conversations.outside)} com a recepção fechada` : ""}.`,
    reception
      ? `${count(reception.agentOnly, "conversa resolvida", "conversas resolvidas")} só pelo agente${pct(reception.agentOnly, contacts) ? ` (${pct(reception.agentOnly, contacts)})` : ""} · ${count(reception.transferred, "passada", "passadas")} para a recepção${reception.teamJoined ? ` · ${count(reception.teamJoined, "com a equipe", "com a equipe")} na conversa sem transferência` : ""}.`
      : `${count(a.aiOnlyConversations, "conversa resolvida", "conversas resolvidas")} só com a IA · ${count(a.handoffs, "transbordo", "transbordos")} para a equipe.`,
    ...(availability ? [`Agente no ar em ${n(availability.percent)}% ${availability.partial ? "do período medido" : "do mês"}${availability.incidents.length
      ? ` · ${count(availability.incidents.length, "queda", "quedas")}, ${formatDuration(availability.downSeconds)} fora do ar · ${count(availability.contactsAffected, "contato afetado", "contatos afetados")}` : " · nenhuma queda registrada"}.`] : []),
    ...(t ? [timeHeadline(t, contacts, a.assumedHours, financial ? a.savingsCents : null)] : []),
  ];
  const agenda = [
    `${count(scheduled, "avaliação agendada", "avaliações agendadas")} pelo agente${split(a.scheduled) ? `: ${split(a.scheduled)}` : ""} · ${versus(scheduled, total(b.scheduled))}.`,
    `${count(attended, "comparecimento confirmado", "comparecimentos confirmados")}${split(a.attended) ? `: ${split(a.attended)}` : ""} · ${versus(attended, total(b.attended))}.`,
    ...(unconfirmed ? [`${count(unconfirmed, "avaliação aguarda", "avaliações aguardam")} confirmação de comparecimento na agenda: sem confirmação não é falta.`] : []),
    ...(a.untypedAppointments ? [`${count(a.untypedAppointments, "agendamento", "agendamentos")} sem tipo de atendimento, fora da conta até a conferência.`] : []),
  ];

  const timeRows = timeBreakdown(r);
  const arrivals = a.arrivals;
  const slots: ArrivalSlot[] = ["inside", "beforeOpen", "onBreak", "afterClose", "closedDay", "unclassified"];
  const cols = (s: SplitCount) => hours ? [n(s.inside), n(s.outside), n(total(s))] : [n(total(s))];
  const head = (label: string) => hours ? [label, "Exped.", "Fora", "Total"] : [label, "Total"];
  const consultations = a.agenda ? { inside: a.attended.inside + a.agenda.noShow.inside + a.agenda.unconfirmed.inside, outside: a.attended.outside + a.agenda.noShow.outside + a.agenda.unconfirmed.outside,
    unclassified: a.attended.unclassified + a.agenda.noShow.unclassified + a.agenda.unconfirmed.unclassified } : null;
  const byProcedure = a.procedures.filter((p) => p.scheduled !== undefined && (p.scheduled || p.attended || p.qualified));
  const q = r.leadQuality;

  const tables: ExecutiveSummary["tables"] = {
    time: timeRows.length ? { title: "Tempo devolvido à equipe", head: ["O que o agente assumiu", monthName], rows: timeRows.map((row) => ({ cells: [row.label, row.value], estimate: row.estimate, strong: row.strong })) } : null,
    // Pelo expediente cadastrado, não por faixa fixa de horário.
    arrivals: hours && arrivals ? { title: "Quando os contatos chegaram", head: ["Pelo expediente da clínica", "Contatos"],
      rows: slots.filter((slot) => slot === "inside" || arrivals[slot] > 0).map((slot) => ({ cells: [ARRIVAL_LABEL[slot], n(arrivals[slot])] })),
      note: "Classificado pelo expediente que a clínica cadastrou, no dia e na hora em que o contato escreveu." } : null,
    reception: reception && reception.transferred ? { title: "Conversas passadas para a recepção", head: ["O que a recepção fez", monthName], rows: [
      { cells: ["Respondidas pela recepção", `${n(reception.answered)} de ${n(reception.transferred)}`] },
      { cells: ["1ª resposta da recepção (mediana)", reception.medianSeconds === null ? "—" : seconds(reception.medianSeconds)] },
      { cells: ["Esperaram mais de 1 hora", n(reception.overHour)] },
      { cells: ["Ainda sem resposta no fim do mês", n(reception.unanswered)] },
    ], note: "Da transferência feita pelo agente até a primeira resposta de uma pessoa, em tempo corrido." } : null,
    funnel: { title: "Funil do mês", head: head("Etapa"), rows: [
      { cells: ["Contatos atendidos", ...cols(a.conversations)] },
      { cells: ["Qualificados", ...(hours ? ["—", "—"] : []), n(a.qualified)] },
      { cells: ["Agendaram avaliação", ...cols(a.scheduled)] },
      { cells: ["Compareceram", ...cols(a.attended)] },
    ], note: "Agendadas contam pelo mês da marcação e comparecimentos pelo mês da consulta: as etapas não são exatamente o mesmo grupo de pessoas." },
    outcome: a.agenda && consultations ? { title: "Consultas de avaliação do mês", head: head("Situação"), rows: [
      { cells: ["Compareceram", ...cols(a.attended)] },
      { cells: ["Faltaram", ...cols(a.agenda.noShow)] },
      { cells: ["Sem confirmação de comparecimento", ...cols(a.agenda.unconfirmed)] },
      { cells: ["Total de consultas já realizadas", ...cols(consultations)], strong: true },
    ], note: [rate && noShow ? `Comparecimento: ${n(attended)} de ${n(attended + noShow)} (${rate}).` : "", upcoming ? `${count(upcoming, "avaliação marcada no mês ainda vai", "avaliações marcadas no mês ainda vão")} acontecer: aguardam a consulta, não são falta.` : "",
      "Sem confirmação nunca é contado como falta."].filter(Boolean).join(" ") } : null,
    procedures: byProcedure.length ? { title: "Por procedimento", head: ["Procedimento", "Qualificados", "Agendadas", "Compareceram"],
      rows: byProcedure.map((p) => ({ cells: [p.name, n(p.qualified), n(p.scheduled ?? 0), n(p.attended ?? 0)] })) } : null,
    doubts: q && q.withDoubt > 0 ? { title: "Primeira dúvida", head: ["Assunto", "% dos que perguntaram"],
      rows: q.doubts.map((d) => ({ cells: [d.label, pct(d.count, q.withDoubt) ?? "—"] })), note: `${count(q.withDoubt, "lead teve", "leads tiveram")} a primeira dúvida registrada pelo agente.` } : null,
    // Um motivo principal por lead: a coluna soma exatamente os que não agendaram.
    reasons: q?.notScheduled && q.notScheduled.total > 0 ? { title: "Motivo principal de não agendar", head: ["Motivo", "Leads"], rows: [
      ...q.notScheduled.reasons.map((reason) => ({ cells: [reason.label, n(reason.count)] })),
      { cells: [`Total (${n(q.leads)} leads novos − ${n(q.outcomes.scheduled)} que agendaram)`, n(q.notScheduled.total)], strong: true },
    ] } : null,
  };

  const leads = !q ? "Sem registro de qualidade dos leads neste relatório." : q.leads === 0 ? "Sem leads novos neste mês." : leadQualityHeadline(q);
  const gap = a.gapAnswerSeconds != null && a.gapsAnswered ? ` A equipe respondeu ${count(a.gapsAnswered, "pergunta", "perguntas")} da fila, em média em ${formatDuration(a.gapAnswerSeconds)}.` : "";
  const questions = a.unanswered || b.unanswered
    ? `O agente ficou sem resposta para ${count(a.unanswered, "pergunta", "perguntas")} neste mês${a.unanswered === b.unanswered ? "" : ` (${b.unanswered === 1 ? "era 1" : `eram ${n(b.unanswered)}`} no mês anterior)`}.${gap}` : null;

  const note = (r.limitationsNote ?? "").trim();
  const incidents = monthlyIncidents(r), limitations = (r.limitations ?? []).map((l) => l.text);
  return { lede, kpis, attendance, satisfaction: satisfactionLines(r.data?.satisfaction), agenda, adjustments: r.adjustments, questions, previousActions: r.previousActions ?? [],
    caseItems: r.caseFacts ? caseFactItems(r.caseFacts) : [], leads, tables,
    unplanned: { note, incidents, limitations, none: !note && !incidents.length && !limitations.length }, financial };
}

/** A linha do bloco financeiro, quando ele existe. */
export function financialLine(f: ExecutiveFinancial): string {
  return `Retorno estimado: ROI ${n(f.roiPercent)}% · receita ${formatBRL(f.revenueCents)} · economia ${formatBRL(f.savingsCents)}${f.investmentCents === null ? "" : ` · mensalidade ${formatBRL(f.investmentCents)}`}.`;
}
