import type { MonthlyReport } from "./monthly";
import { AFFECTED_METRIC_LABELS, affectedLabels, detectMonthlyPendencies, PENDENCY_TOPICS } from "./monthly-pendencies";
import { financialEnabled } from "./monthly-config";
import { clinicorpReadFailed, QUALITY_KEY_LABEL, QUALITY_KEYS } from "./monthly-quality";

/*
 * Limitações do fechamento mensal.
 *
 * Um relatório pode fechar com cobertura parcial, desde que o que ficou de fora
 * seja dito. Esta é a lista: cada pendência que `detectMonthlyPendencies` ainda
 * acusa (a mesma regra da central) mais o que falta de cobertura sem ser
 * pendência (histórico anterior à implantação, Clinicorp fora do ar, chegada
 * sem horário, áudio sem duração). Mês anterior sem premissas NÃO entra: limita
 * o comparativo, não a cobertura deste mês, e já sai como nota no painel e no PDF.
 *
 * É calculada, nunca escrita: `computeMonthlyReport` anexa ao relatório e o
 * fechamento congela no snapshot. O texto de `limitationsNote` explica a lista,
 * não a substitui. Fechar exige confirmar exatamente estas chaves: se a lista
 * mudou entre a conferência e o clique, o fechamento é recusado.
 *
 * Puro e sem dado de paciente: só contagens e nomes de procedimento.
 */

export type MonthlyLimitation = { key: string; text: string; affects: string[] };
type Source = Pick<MonthlyReport, "current" | "assumptions" | "clinicorpError" | "data"> & Partial<Pick<MonthlyReport, "clinicorpIntegrationState">>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function monthlyLimitations(r: Source): MonthlyLimitation[] {
  const a = r.current, c = r.assumptions;
  const found: MonthlyLimitation[] = [];
  // No relatório v2 o financeiro é opcional: o que só desliga o retorno estimado não é limitação.
  const pendencies = detectMonthlyPendencies(a, c, r.data).filter((p) => !p.optional);
  for (const topic of PENDENCY_TOPICS) {
    const texts = pendencies.filter((p) => p.topic === topic).map((p) => p.text);
    if (texts.length) found.push({ key: topic, text: texts.join(" "), affects: affectedLabels(topic, c) });
  }
  if (!a.trackingComplete) found.push({ key: "tracking", affects: ["Leads qualificados", "Transbordos", "Perguntas sem resposta"],
    text: "Só eventos registrados depois da implantação: o histórico anterior não foi medido e não significa zero." });
  if (clinicorpReadFailed(r)) found.push({ key: "clinicorp", affects: ["Avaliações realizadas"],
    text: "A agenda do Clinicorp não pôde ser lida: comparecimentos vinculados ficaram sem confirmação." });
  // Sem expediente, dentro/fora inteiro já é a pendência "hours".
  const noArrival = [
    a.conversations.unclassified && plural(a.conversations.unclassified, "conversa", "conversas"),
    a.scheduled.unclassified && plural(a.scheduled.unclassified, "avaliação agendada", "avaliações agendadas"),
  ].filter(Boolean);
  if (c.humanHours && noArrival.length) found.push({ key: "arrival", affects: [AFFECTED_METRIC_LABELS.classification],
    text: `Sem horário de chegada do contato: ${noArrival.join(" e ")}, fora da divisão dentro/fora.` });
  if (a.time?.unmeasuredAudios) found.push({ key: "audio",
    affects: c.secondsPerMessage != null ? ["Horas devolvidas", ...(financialEnabled(c) ? ["Economia estimada"] : [])] : ["Áudios ouvidos"],
    text: `${plural(a.time.unmeasuredAudios, "áudio", "áudios")} sem duração medida: entram só com o tempo de resposta.` });
  // `undefined` é snapshot antigo ou leitura indisponível: nada a dizer.
  if (a.availability === null) found.push({ key: "uptime", affects: ["Disponibilidade do agente"],
    text: "A conexão do WhatsApp ainda não era monitorada com registro de queda neste mês: a disponibilidade não foi medida." });
  else if (a.availability?.partial) found.push({ key: "uptime", affects: ["Disponibilidade do agente"],
    text: `A disponibilidade foi medida só a partir de ${new Intl.DateTimeFormat("pt-BR", { timeZone: c.timezone, day: "2-digit", month: "2-digit" }).format(new Date(a.availability.measuredFrom))}, quando o registro de quedas começou.` });
  if (r.data?.campaigns?.partialCapture) found.push({ key: "campaigns", affects: ["Leads por anúncio"],
    text: "O registro do anúncio de origem começou no meio deste mês: contatos anteriores ao registro aparecem em \"sem anúncio identificado\"." });
  return found;
}

/** Indicadores entregues como "não verificado" (sem dado para calcular). */
export function unverifiedMetrics(r: Pick<MonthlyReport, "quality">): string[] {
  return QUALITY_KEYS.filter((key) => r.quality?.[key]?.status === "pending").map((key) => QUALITY_KEY_LABEL[key]);
}

/**
 * O que o admin confirmou, com o texto (as contagens estão nele): 3 presenças
 * pendentes que viraram 5 depois da conferência pedem nova confirmação.
 */
export const limitationFingerprint = (list: MonthlyLimitation[]) => list.map((l) => `${l.key}|${l.text}`);
export const sameLimitations = (seen: string[], current: MonthlyLimitation[]) => {
  const now = limitationFingerprint(current);
  return seen.length === now.length && now.every((l, i) => l === seen[i]);
};

/** "Resumo do período" (coluna `highlights`): página 1 do PDF, com espaço medido para isso. */
export const HIGHLIGHTS_MAX = 600;
export const LIMITATIONS_NOTE_MAX = 400;
