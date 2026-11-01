import { leadOutcome, type LeadOutcome, type LeadRow } from "@/modules/lead-insights/summary";

/**
 * Leads por anúncio. Puro: recebe as linhas já lidas e devolve números.
 *
 * A unidade é o **lead criado na janela**, com ou sem anúncio, então
 * `adLeads + otherLeads = leads` sempre. O resultado (agendou, passou para a
 * equipe, perdeu, em andamento) é o de `leadOutcome` da inteligência de
 * conversas — a mesma regra do relatório "Qualidade dos leads", calculada na
 * leitura e nunca gravada.
 *
 * "Sem anúncio identificado" não quer dizer orgânico: quer dizer que a mensagem
 * não trazia anúncio. Contato que escreveu antes da captura, ou por um número
 * sem o dado, cai aqui.
 */

export type CampaignRow = LeadRow & {
  origin: { sourceId: string | null; code: string | null; name: string | null } | null;
};

export type CampaignLine = {
  /** Chave de agrupamento: o código da campanha, ou o id do anúncio quando não há código. */
  key: string;
  code: string | null;
  name: string | null;
  sourceId: string | null;
  label: string;
  leads: number;
  scheduled: number;
  handoff: number;
  lost: number;
  open: number;
};

export type OutcomeCounts = Record<LeadOutcome, number>;

export type CampaignSummary = {
  leads: number;
  adLeads: number;
  otherLeads: number;
  /** Agendaram, entre os leads de anúncio. */
  adScheduled: number;
  /** Agendaram, entre os sem anúncio identificado. */
  otherScheduled: number;
  lines: CampaignLine[];
};

const emptyOutcomes = (): OutcomeCounts => ({ scheduled: 0, handoff: 0, lost: 0, open: 0 });

function labelOf(code: string | null, name: string | null, sourceId: string | null): string {
  if (code) return name ? `${code} - ${name}` : code;
  return sourceId ? `Anúncio sem código (final ${sourceId.slice(-4)})` : "Anúncio sem código";
}

/** Percentual inteiro; null sem base (nunca "0%" de zero leads). */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export function summarizeCampaigns(rows: CampaignRow[], now: Date): CampaignSummary {
  const groups = new Map<string, {
    code: string | null; sourceId: string | null; names: Map<string, number>; outcomes: OutcomeCounts; leads: number;
  }>();
  let adLeads = 0, adScheduled = 0, otherScheduled = 0;

  for (const row of rows) {
    const { outcome } = leadOutcome(row, now);
    if (!row.origin) {
      if (outcome === "scheduled") otherScheduled++;
      continue;
    }
    adLeads++;
    if (outcome === "scheduled") adScheduled++;
    const { code, sourceId, name } = row.origin;
    const key = code ?? (sourceId ? `id:${sourceId}` : "sem-id");
    const group = groups.get(key) ?? { code, sourceId, names: new Map(), outcomes: emptyOutcomes(), leads: 0 };
    group.leads++;
    group.outcomes[outcome]++;
    // O mesmo código pode ter sido renomeado; vale o nome mais frequente.
    if (name) group.names.set(name, (group.names.get(name) ?? 0) + 1);
    group.sourceId ??= sourceId;
    groups.set(key, group);
  }

  const lines: CampaignLine[] = [...groups.entries()].map(([key, g]) => {
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      key,
      code: g.code,
      name,
      sourceId: g.sourceId,
      label: labelOf(g.code, name, g.sourceId),
      leads: g.leads,
      scheduled: g.outcomes.scheduled,
      handoff: g.outcomes.handoff,
      lost: g.outcomes.lost,
      open: g.outcomes.open,
    };
  });
  lines.sort((a, b) => b.leads - a.leads || b.scheduled - a.scheduled || a.label.localeCompare(b.label, "pt-BR"));

  return { leads: rows.length, adLeads, otherLeads: rows.length - adLeads, adScheduled, otherScheduled, lines };
}

export const NO_AD_LABEL = "Sem anúncio identificado";
export const NO_AD_KEY = "__sem_anuncio__";
export const REST_KEY = "__outros__";

export type CampaignBar = {
  key: string;
  label: string;
  leads: number;
  scheduled: number;
  kind: "ad" | "rest" | "none";
};

/**
 * Barras do gráfico: os `top` maiores anúncios, "Outros N anúncios" (soma do
 * resto) e "Sem anúncio identificado" sempre por último. A soma das barras é
 * sempre o total de leads do período.
 */
export type CampaignBarsSource = {
  lines: Pick<CampaignLine, "key" | "label" | "leads" | "scheduled">[];
  otherLeads: number;
  otherScheduled: number;
};

export function campaignBars(summary: CampaignBarsSource, top = 10): { bars: CampaignBar[]; restCount: number; restLeads: number; restScheduled: number } {
  const shown = summary.lines.slice(0, top);
  const rest = summary.lines.slice(top);
  const restLeads = rest.reduce((n, l) => n + l.leads, 0);
  const restScheduled = rest.reduce((n, l) => n + l.scheduled, 0);
  const bars: CampaignBar[] = shown.map((l) => ({ key: l.key, label: l.label, leads: l.leads, scheduled: l.scheduled, kind: "ad" }));
  if (rest.length) bars.push({ key: REST_KEY, label: `Outros ${rest.length} anúncios`, leads: restLeads, scheduled: restScheduled, kind: "rest" });
  if (summary.otherLeads > 0) bars.push({ key: NO_AD_KEY, label: NO_AD_LABEL, leads: summary.otherLeads, scheduled: summary.otherScheduled, kind: "none" });
  return { bars, restCount: rest.length, restLeads, restScheduled };
}
