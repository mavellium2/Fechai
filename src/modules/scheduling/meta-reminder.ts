import type { BroadcastTemplate } from "@/modules/broadcasts/template";

/**
 * Template aprovado da Meta para o lembrete de quem está **fora da janela de
 * 24h** — quem nunca conversou com o número da clínica (como os pacientes
 * marcados direto no Clinicorp) e quem sumiu há mais de um dia.
 *
 * Por que template, e não o texto do lembrete: fora da janela de 24h aberta
 * pelo cliente a Meta só aceita template aprovado, e um primeiro contato está
 * sempre fora dela. Dentro da janela o lembrete segue em texto livre
 * (`outsideMetaWindow`). Por que só a Meta: o Evolution manda como se fosse o
 * aparelho, e mensagem de número desconhecido é o que mais leva o WhatsApp a
 * bloquear o número da clínica — quem perde é a clínica, com todos os outros
 * pacientes. Ver `workers/follow-up-worker/clinicorp-reminders.ts`.
 *
 * Guarda o template **congelado** (corpo, cabeçalho, rodapé), como os
 * Disparos: a prévia da tela e o que entra na conversa saem daqui, e uma edição
 * na Meta não muda em silêncio o que a clínica revisou. `variables` diz o que
 * vai em cada `{{1}}`, `{{2}}`…, na ordem.
 *
 * Puro de propósito: a tela de agentes (cliente) importa este arquivo.
 */

/** Janela em que a Meta aceita texto livre depois da última mensagem do contato. */
export const META_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Fora da janela de 24h a Meta só aceita template; sem mensagem do contato, sempre fora. */
export function outsideMetaWindow(lastInboundAt: Date | null | undefined, now: Date): boolean {
  return !lastInboundAt || now.getTime() - lastInboundAt.getTime() >= META_SERVICE_WINDOW_MS;
}

/** O que um `{{n}}` do template pode receber — os mesmos dados do lembrete. */
export const META_REMINDER_VARIABLES = [
  { value: "nome", label: "Nome do paciente" },
  { value: "data", label: "Data da consulta" },
  { value: "hora", label: "Horário" },
  { value: "local", label: "Local ou formato" },
] as const;

export type MetaReminderVariable = (typeof META_REMINDER_VARIABLES)[number]["value"];

export type MetaReminderTemplate = BroadcastTemplate & { variables: MetaReminderVariable[] };

/** Teto de `{{n}}`, o mesmo dos Disparos (`supportedTemplate`). */
const MAX_PARAMETERS = 20;

const isVariable = (v: unknown): v is MetaReminderVariable =>
  META_REMINDER_VARIABLES.some((option) => option.value === v);

/**
 * Lê o template salvo. Nunca lança: config do banco pode ser antiga, parcial ou
 * editada à mão — e template pela metade é pior que nenhum, porque a Meta
 * recusaria cada envio. Qualquer defeito devolve null (= sem template).
 */
export function parseMetaReminderTemplate(raw: unknown): MetaReminderTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
  const id = text(t.id, 100);
  const name = text(t.name, 512);
  const language = text(t.language, 20);
  const body = text(t.body, 4096);
  const header = text(t.header ?? "", 1024);
  const footer = text(t.footer ?? "", 1024);
  const count = t.parameterCount;
  if (!id || !name || !language || !body || header === null || footer === null) return null;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > MAX_PARAMETERS) return null;
  if (!Array.isArray(t.variables) || t.variables.length !== count || !t.variables.every(isVariable)) return null;
  return { id, name, language, body, header, footer, parameterCount: count, variables: [...t.variables] };
}

/**
 * Os valores de cada `{{n}}`, na ordem. `null` quando algum sairia vazio: a
 * Meta recusa parâmetro em branco, e mandar um traço no lugar do nome seria
 * pior do que não mandar.
 */
export function metaReminderParameters(
  template: Pick<MetaReminderTemplate, "variables">,
  values: Record<MetaReminderVariable, string>,
): string[] | null {
  const params = template.variables.map((v) => values[v].trim());
  return params.every(Boolean) ? params : null;
}

/** Confere a escolha feita na tela: um dado por `{{n}}`, nada sobrando. */
export function validateMetaReminderTemplate(
  template: MetaReminderTemplate,
  { location }: { location: string },
): string | null {
  if (template.variables.length !== template.parameterCount) {
    return "Escolha o que vai em cada variável do template.";
  }
  // `{{local}}` vazio viraria parâmetro em branco, que a Meta recusa.
  if (template.variables.includes("local") && !location.trim()) {
    return "O template usa o local da consulta, mas o campo \"Local ou formato\" está em branco.";
  }
  return null;
}
