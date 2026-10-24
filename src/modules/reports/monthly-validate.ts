import { normalizeLabel } from "./monthly-config";
import type { MonthlyReport } from "./monthly";
import type { MonthlyReportData, Split } from "./monthly-data";
import { allowedNumbers, hasFullDate, unknownNumbers } from "./monthly-text-guard";
import { SURVEY_TOPIC_KEYS } from "@/modules/satisfaction/categories";
import { roundAverage, TOP_TOPICS } from "@/modules/satisfaction/summary";

/*
 * Validador do relatório mensal v2. Roda ao salvar, antes da redação da IA e
 * no fechamento. `blocking` impede fechar: é número que não fecha ou decisor
 * errado, coisas que o decisor da clínica veria. `warning` não bloqueia: o
 * número sai com o status que tem (parcial, não verificado) e a central de
 * pendências mostra o que fazer.
 *
 * Falta de ticket, conversão ou custo da equipe NÃO é problema: só desliga o
 * bloco de retorno estimado.
 */

export type IssueSeverity = "blocking" | "warning";
export type MonthlyIssue = { key: string; severity: IssueSeverity; metric: string; message: string; action: string };

/** Acima disto, a mediana do agente provavelmente mistura resposta humana ou fila parada. */
export const SLOW_AGENT_SECONDS = 300;
/** Abaixo disto de contatos com cidade informada, a leitura de área é parcial. */
export const MIN_CITY_COVERAGE = 0.5;

type Texts = Pick<MonthlyReport, "decisionMaker" | "operationalContact"> & Partial<Pick<MonthlyReport, "highlights" | "featuredCase" | "month" | "previousMonth">>;

const splitBroken = (s: Split) => s.inside.value !== null && s.outside.value !== null
  && s.inside.value + s.outside.value + s.unclassified !== s.total.value;

export function validateMonthlyReport(data: MonthlyReportData, texts: Texts): MonthlyIssue[] {
  const issues: MonthlyIssue[] = [];
  const add = (severity: IssueSeverity, key: string, metric: string, message: string, action: string) => issues.push({ key, severity, metric, message, action });
  const s = data.service, a = data.schedule;
  const contacts = s.contacts.total.value ?? 0, scheduled = a.cohort.total.total.value ?? 0;
  if (s.contexts) {
    const ctx = s.contexts;
    if (ctx.groups.reduce((n, g) => n + g.contacts, 0) !== ctx.active
      || ctx.groups.reduce((n, g) => n + g.attended, 0) !== contacts
      || ctx.attended !== contacts
      || ctx.groups.reduce((n, g) => n + g.evaluations, 0) !== ctx.attributedEvaluations
      || ctx.attributedEvaluations + ctx.unattributedEvaluations !== scheduled
      || ctx.groups.some((g) => g.scheduledContacts > g.contacts
        || g.conversionPercent !== (g.contacts && g.key !== "unknown" ? Math.round(g.scheduledContacts / g.contacts * 1000) / 10 : null))) {
      add("blocking", "contexts_sum", "Conversão por contexto", "As bases, avaliações ou taxas por contexto não fecham com os registros do mês.", "Reimporte os dados; não combine bases diferentes na conversão.");
    }
  }

  /* ------------------------------ Bloqueantes ------------------------------ */
  if ((s.aiOnly.value ?? 0) + (s.transferred.value ?? 0) !== contacts) {
    add("blocking", "service_sum", "Contatos atendidos", `Só o agente (${s.aiOnly.value}) + passadas para a recepção (${s.transferred.value}) não somam os ${contacts} contatos.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const c = a.cohort;
  const cohortSum = (c.attended.total.value ?? 0) + (c.no_show.total.value ?? 0) + (c.upcoming.total.value ?? 0) + (c.unverified.total.value ?? 0);
  if (cohortSum !== scheduled) {
    add("blocking", "cohort_sum", "Avaliações agendadas", `Compareceram + faltaram + aguardando + não verificado (${cohortSum}) não somam as ${scheduled} agendadas.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const splits: [string, Split][] = [["Contatos atendidos", s.contacts], ["Qualificados", a.qualified], ["Compareceram", c.attended],
    ["Faltaram", c.no_show], ["Aguardando consulta", c.upcoming], ["Comparecimento não verificado", c.unverified], ["Avaliações agendadas", c.total]];
  for (const [label, split] of splits) if (splitBroken(split)) {
    add("blocking", "split_sum", label, `${label}: expediente + fora não somam o total.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const reasons = data.leads.reasons.reduce((n, r) => n + r.contacts, 0);
  if (reasons !== contacts - a.scheduledContacts) {
    add("blocking", "reasons_sum", "Motivo de não agendar", `Os motivos somam ${reasons}, mas ${contacts - a.scheduledContacts} contatos não agendaram.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const sat = data.satisfaction;
  if (sat) {
    const counted = sat.distribution.reduce((n, v) => n + v, 0);
    const weighted = sat.distribution.reduce((n, v, i) => n + v * (i + 1), 0);
    if (counted !== sat.answered) {
      add("blocking", "satisfaction_sum", "Satisfação", `A distribuição das notas soma ${counted}, mas há ${sat.answered} respostas.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
    } else if (sat.average.value !== roundAverage(weighted, sat.answered)) {
      add("blocking", "satisfaction_average", "Satisfação", "A nota média não bate com a distribuição das notas.", "Reimporte os dados; se persistir, avise o desenvolvimento.");
    }
    // O top 3 só pode conter chaves do conjunto fechado, contadas e dentro do limite de respostas.
    const top = sat.improvementTopics;
    if (top.length > TOP_TOPICS || top.some((t, i) => !SURVEY_TOPIC_KEYS.includes(t.key) || t.count < 1 || t.count > sat.answered || (i > 0 && t.count > top[i - 1].count))) {
      add("blocking", "satisfaction_topics", "Pontos de melhoria", "Os pontos de melhoria citados não vêm das chaves contadas nas respostas.", "Reimporte os dados; se persistir, avise o desenvolvimento.");
    }
  }
  const decisionMaker = texts.decisionMaker.trim(), operational = (texts.operationalContact ?? "").trim();
  if (!decisionMaker) {
    add("blocking", "decision_maker", "Decisor", "Decisor não informado.", "Informe o dono ou sócio que recebe o relatório.");
  } else if (operational && normalizeLabel(decisionMaker) === normalizeLabel(operational)) {
    add("blocking", "decision_maker", "Decisor", "O decisor é a mesma pessoa do contato operacional.", "O decisor é o dono ou sócio; a recepção entra como contato operacional, em cópia.");
  }

  // Um número existente em outro indicador não autoriza um ROI incompleto no resumo.
  if (texts.highlights && data.financialSummary?.status === "incomplete"
      && /(?:ROI(?:\s+total)?|retorno\s+(?:total|financeiro|líquido))\s*(?:(?:de|foi|é|está|estimado|em|:)\s*){0,3}(?:R\$\s*[−-]?\s*\d|[−-]?\s*\d+(?:[.,]\d+)?\s*(?:x|%))/iu.test(texts.highlights)) {
    add("blocking", "financial_claim", "Resumo financeiro", "O resumo apresenta retorno total apesar do cálculo financeiro incompleto.", "Explique que o ROI total está indisponível; economia e saldo operacional são parcelas separadas.");
  }

  // O resumo do período é rascunho da IA: número que o motor não calculou não chega ao decisor.
  if (texts.highlights && texts.month) {
    const unknown = unknownNumbers(texts.highlights, allowedNumbers(data, { month: texts.month, previousMonth: texts.previousMonth }));
    if (unknown.length) add("blocking", "text_numbers", "Resumo do período", `O resumo cita ${unknown.length === 1 ? "um número" : "números"} que não está${unknown.length === 1 ? "" : "ão"} nos dados do mês: ${unknown.join(", ")}.`, "Corrija o texto na etapa 4 ou gere a análise de novo.");
  }
  if (texts.highlights && s.contexts) {
    const text = texts.highlights;
    const paidClaim = /(?:leads|contatos|pacientes)\s+(?:de|do|dos|vindos\s+d[eo]|oriundos\s+d[eo])\s+(?:tr[aá]fego\s+pago|an[uú]ncios|base\s+qualificada)/iu.test(text);
    if (paidClaim && s.contexts.acquisition === "not_recorded") {
      add("blocking", "acquisition_claim", "Origem de aquisição", "O resumo atribui contatos a tráfego pago ou base qualificada sem origem registrada.", "Use o contexto comprovado: nova entrada, contato antigo ou abordagem. Não atribua um canal não registrado.");
    }
    const rates = new Set(s.contexts.groups.flatMap((g) => g.conversionPercent === null ? [] : [g.conversionPercent]));
    const claimed = [...text.matchAll(/convers[aã]o[^.!?%\n]{0,60}?(\d+(?:[.,]\d+)?)\s*%/giu)].map((m) => Number(m[1].replace(",", ".")));
    if (claimed.some((rate) => !rates.has(rate))) {
      add("blocking", "conversion_claim", "Conversão por contexto", "O resumo cita uma taxa de conversão que não pertence às bases calculadas.", "Use a taxa do grupo correspondente, sem dividir agendamentos pelo total de atendimentos.");
    }
  }
  for (const [label, text] of [["Caso do mês", texts.featuredCase], ["Resumo do período", texts.highlights]] as const) {
    if (text && hasFullDate(text)) add("blocking", "text_date", label, `${label} cita uma data completa.`, "Diga só o dia da semana e o período (manhã, tarde, noite).");
  }

  /* -------------------------------- Avisos -------------------------------- */
  if (!data.meta.hoursConfigured) {
    add("warning", "hours", "Expediente", "Expediente da clínica não cadastrado: os números saem só com o total, sem a quebra.", "Confirme o expediente na etapa 2.");
  }
  if (a.qualified.total.status === "partial") {
    add("warning", "qualification", "Qualificados", `${a.qualified.total.value} qualificados para ${scheduled} avaliações agendadas: o agente não está registrando a qualificação.`, "Revise a regra de qualificação do agente.");
  }
  const transferred = s.transferred.value ?? 0, events = s.handoffEvents.value ?? 0;
  if (transferred > 0 && events === 0) {
    add("warning", "handoff", "Passadas para a recepção", `${transferred} conversas tiveram resposta da equipe e o agente não registrou nenhum transbordo.`, "Confira se a ação de transferir para humano está ligada e quando a equipe assume.");
  }
  if ((s.reception.unanswered.value ?? 0) > 0) {
    add("warning", "reception", "Recepção", `${s.reception.unanswered.value} conversas passadas para a recepção seguiam sem resposta no fim do mês.`, "Avise a clínica: é a seção \"o que não saiu como planejado\".");
  }
  if ((s.agentFirstResponseSeconds.value ?? 0) > SLOW_AGENT_SECONDS) {
    add("warning", "agent_response", "1ª resposta do agente", `Mediana de ${s.agentFirstResponseSeconds.value} s na primeira resposta do agente.`, "Investigue atraso da fila ou agente pausado.");
  }
  if (data.leads.withCity.status === "partial") {
    add("warning", "city", "Qualidade dos leads", `Só ${data.leads.withCity.value} de ${contacts} contatos informaram a cidade.`, "Ajuste o agente para perguntar a cidade.");
  }
  if ((c.unverified.total.value ?? 0) > 0) {
    add("warning", "attendance", "Compareceram", `${c.unverified.total.value} avaliação(ões) com data passada e sem comparecimento confirmado.`, "Mapeie os status do Clinicorp ou marque o comparecimento na agenda.");
  }
  if (sat && sat.unclassified > 0) {
    add("warning", "satisfaction_topics_pending", "Pontos de melhoria", `${sat.unclassified} comentário(s) da pesquisa de satisfação ainda sem motivo classificado.`, "A classificação roda em segundo plano; confira o motivo na visão de satisfação ou aguarde antes de fechar.");
  }
  if (splits.some(([, split]) => split.unclassified > 0)) {
    add("warning", "arrival", "Expediente", "Há registros sem horário de chegada do contato, fora da quebra por expediente.", "Confira os registros sem classificação.");
  }
  return issues;
}

export const blockingIssues = (issues: MonthlyIssue[]) => issues.filter((i) => i.severity === "blocking");
