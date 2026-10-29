import { dayKeyInZone } from "@/modules/scheduling/time";
import { percent, type CampaignSummary } from "./summary";

/** Anúncios listados no grupo; o resto vira "e mais N" (a lista completa fica no painel). */
const LIST_LIMIT = 10;
const DAY_MS = 86_400_000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2026-10-23" → "23/10". */
const shortDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/** "23/10 a 29/10": do primeiro ao último dia da janela [from, to). */
export function rangeLabel(from: Date, to: Date, timezone: string): string {
  return `${shortDay(dayKeyInZone(from, timezone))} a ${shortDay(dayKeyInZone(new Date(to.getTime() - 1), timezone))}`;
}

function comparison(now: number, before: number): string {
  if (before === 0) return now === 0 ? "igual à semana anterior" : "semana anterior sem leads de anúncio";
  const delta = Math.round(((now - before) / before) * 100);
  if (delta === 0) return "igual à semana anterior";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)}% sobre a semana anterior (${before})`;
}

/** A versão curta, para caber num cartão do PDF. */
function shortComparison(now: number, before: number): string {
  if (before === 0) return now === 0 ? "igual à anterior" : "anterior sem anúncio";
  const delta = Math.round(((now - before) / before) * 100);
  if (delta === 0) return "igual à anterior";
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)}% vs. semana anterior`;
}

/**
 * Comparação dos leads de anúncio com a semana anterior — só quando essa semana
 * já tinha captura de anúncio; com captura pela metade seria uma conta falsa.
 * `null` = não comparar.
 */
export function adTrend(input: {
  current: CampaignSummary;
  previous: CampaignSummary | null;
  previousFrom: Date | null;
  trackedSince: Date | null;
}): { long: string; short: string } | null {
  const { current, previous, previousFrom, trackedSince } = input;
  if (current.adLeads === 0 || !previous || !previousFrom || !trackedSince) return null;
  if (trackedSince.getTime() > previousFrom.getTime() + DAY_MS) return null;
  return { long: comparison(current.adLeads, previous.adLeads), short: shortComparison(current.adLeads, previous.adLeads) };
}

/**
 * O relatório semanal como mensagem de WhatsApp (formatação `*negrito*`).
 * Só contagens e o nome da campanha: nunca nome, telefone ou texto de conversa
 * de paciente — o grupo é da equipe, mas o relatório não precisa deles.
 *
 * `previous` só entra quando a semana anterior já tinha captura de anúncio; com
 * captura pela metade a comparação seria uma conta falsa.
 */
export function formatCampaignMessage(input: {
  from: Date;
  to: Date;
  timezone: string;
  current: CampaignSummary;
  previous: CampaignSummary | null;
  previousFrom: Date | null;
  trackedSince: Date | null;
  link: string | null;
}): string {
  const { current, previous, previousFrom, trackedSince, link } = input;
  const lines = [`*Relatório semanal de campanhas*`, rangeLabel(input.from, input.to, input.timezone), ""];

  if (current.leads === 0) {
    lines.push("Nenhum lead novo na semana.");
  } else {
    lines.push(`*${plural(current.leads, "lead novo", "leads novos")}*`);
    lines.push(`• ${current.adLeads} de anúncio, ${current.otherLeads} sem anúncio identificado`);
    if (current.adLeads > 0) {
      const rate = percent(current.adScheduled, current.adLeads);
      lines.push(`• ${plural(current.adScheduled, "agendou", "agendaram")} entre os de anúncio${rate === null ? "" : ` (${rate}%)`}`);
      const trend = adTrend({ current, previous, previousFrom, trackedSince });
      if (trend) lines.push(`• ${trend.long}`);
    }
  }

  if (current.lines.length) {
    lines.push("", "*Por anúncio*");
    current.lines.slice(0, LIST_LIMIT).forEach((line, i) => {
      const rate = percent(line.scheduled, line.leads);
      lines.push(`${i + 1}. ${line.label} — ${plural(line.leads, "lead", "leads")} · ${line.scheduled} ${line.scheduled === 1 ? "agendou" : "agendaram"}${rate === null ? "" : ` (${rate}%)`}`);
    });
    if (current.lines.length > LIST_LIMIT) lines.push(`e mais ${current.lines.length - LIST_LIMIT} ${current.lines.length - LIST_LIMIT === 1 ? "anúncio" : "anúncios"}`);
  }

  lines.push("", link ? `Detalhes: ${link}` : "Detalhes em Relatórios › Campanhas, no painel.");
  lines.push("_Agendamentos contam até agora, de quem chegou na semana. \"Sem anúncio identificado\" pode ser orgânico ou contato antigo._");
  return lines.join("\n");
}

/**
 * A legenda do PDF no WhatsApp: curta, porque o relatório inteiro vai no
 * arquivo. Só contagens, nunca nome, telefone ou texto de conversa.
 */
export function formatCampaignCaption(input: {
  from: Date;
  to: Date;
  timezone: string;
  current: CampaignSummary;
  link: string | null;
}): string {
  const { current, link } = input;
  const lines = [`*Relatório semanal de campanhas*`, rangeLabel(input.from, input.to, input.timezone)];
  if (current.leads === 0) lines.push("Nenhum lead novo na semana.");
  else {
    lines.push(`${plural(current.leads, "lead novo", "leads novos")} · ${current.adLeads} de anúncio · ${plural(current.adScheduled, "agendou", "agendaram")}`);
  }
  if (link) lines.push(`Detalhes: ${link}`);
  return lines.join("\n");
}
