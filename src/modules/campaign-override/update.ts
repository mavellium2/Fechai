import { normalizeAdCode, parseOverrideRules, type OverrideRules } from "./config";

/**
 * Montagem e validação da alteração da regra provisória (função pura, usada por
 * `scripts/campanha-override.ts`). O script só lê o banco para dizer quais leads
 * pertencem à conta; o resto é decidido aqui e testado sem banco.
 */

export type OverrideState = {
  adCodes: string[];
  adSourceIds: string[];
  broadcastCampaignIds: string[];
  leadIds: string[];
  rules: unknown;
};

export type OverrideChanges = {
  codes?: string[];
  sourceIds?: string[];
  broadcasts?: string[];
  capacityPerDay?: number;
  offerText?: string;
  addLeads?: string[];
  removeLeads?: string[];
};

export type OverrideUpdate = {
  adCodes: string[];
  adSourceIds: string[];
  broadcastCampaignIds: string[];
  leadIds: string[];
  rules: OverrideRules;
};

/** Visão da regra para auditoria: ids e números, nunca dado do lead (só a quantidade marcada). */
export function auditView(state: OverrideUpdate) {
  return {
    adCodes: state.adCodes,
    adSourceIds: state.adSourceIds,
    broadcastCampaignIds: state.broadcastCampaignIds,
    capacityPerDay: state.rules.capacityPerDay ?? null,
    offerText: state.rules.offerText ?? null,
    markedLeads: state.leadIds.length,
  };
}

export function currentUpdate(state: OverrideState): OverrideUpdate {
  return {
    adCodes: state.adCodes.map((code) => normalizeAdCode(code)).filter((code): code is string => code !== null),
    adSourceIds: [...state.adSourceIds],
    broadcastCampaignIds: [...state.broadcastCampaignIds],
    leadIds: [...state.leadIds],
    rules: parseOverrideRules(state.rules),
  };
}

const unique = (values: string[]) => [...new Set(values)];

/**
 * Aplica as mudanças pedidas sobre o estado atual. `ownedLeadIds` são os leads
 * (de `addLeads`) que o banco confirmou serem da conta. Devolve os erros todos
 * de uma vez; sem erro, devolve o novo estado.
 */
export function buildOverrideUpdate(
  state: OverrideState,
  changes: OverrideChanges,
  ownedLeadIds: ReadonlySet<string>,
): { ok: true; next: OverrideUpdate } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const next = currentUpdate(state);

  if (changes.codes) {
    const codes = changes.codes.map((code) => normalizeAdCode(code));
    if (!codes.length || codes.some((code) => code === null)) errors.push("--set-codes: informe códigos não vazios (ex.: AD27,AD31).");
    else next.adCodes = unique(codes as string[]);
  }
  if (changes.sourceIds) {
    const ids = changes.sourceIds.map((id) => id.trim());
    if (!ids.length || ids.some((id) => !id)) errors.push("--set-source-ids: informe ids não vazios.");
    else next.adSourceIds = unique(ids);
  }
  if (changes.broadcasts) {
    const ids = changes.broadcasts.map((id) => id.trim());
    if (!ids.length || ids.some((id) => !id)) errors.push("--set-broadcasts: informe ids de disparo não vazios.");
    else next.broadcastCampaignIds = unique(ids);
  }
  if (changes.capacityPerDay !== undefined) {
    if (!Number.isInteger(changes.capacityPerDay) || changes.capacityPerDay < 1) errors.push("--set-capacity: informe um inteiro maior ou igual a 1.");
    else next.rules = { ...next.rules, capacityPerDay: changes.capacityPerDay };
  }
  if (changes.offerText !== undefined) {
    const text = changes.offerText.trim();
    if (!text) errors.push("--set-offer: o texto da oferta não pode ser vazio.");
    else next.rules = { ...next.rules, offerText: text };
  }
  for (const id of changes.addLeads ?? []) {
    if (!id.trim() || !ownedLeadIds.has(id.trim())) errors.push("--add-lead: há lead que não existe nesta conta.");
    else if (!next.leadIds.includes(id.trim())) next.leadIds.push(id.trim());
  }
  if (changes.removeLeads?.length) {
    const drop = new Set(changes.removeLeads.map((id) => id.trim()));
    next.leadIds = next.leadIds.filter((id) => !drop.has(id));
  }
  if (errors.length) return { ok: false, errors: unique(errors) };
  return { ok: true, next };
}
