/**
 * Contatos do disparo que não vêm de arquivo: escolhidos na lista da conta ou
 * digitados/colados. Sem prisma aqui — a tela usa as mesmas regras para mostrar
 * o que será importado antes de enviar ao servidor.
 *
 * O resultado passa por `parseBroadcastRows`, a mesma validação do arquivo:
 * telefone com DDI, variáveis em uma linha, duplicados removidos.
 */
import { normalizeBroadcastPhone } from "./phone";

/** Teto de contatos por disparo, para arquivo e lista. */
export const MAX_RECIPIENTS = 1000;

export type ListContact = { phone: string; name: string | null };

/** De onde sai cada variável `{{n}}` quando não há colunas de arquivo. */
export type VariableSource = {
  /**
   * `firstName`/`name`: primeiro nome ou nome completo do contato (`text` é o
   * que vai no lugar para quem não tem nome, no modo "text");
   * `text`: o mesmo texto para todos.
   */
  source: "firstName" | "name" | "text";
  text: string;
};

/** O que fazer com quem não tem nome quando a mensagem usa o nome. */
export type NamelessMode = "template" | "text" | "skip";

const SOURCES = ["firstName", "name", "text"] as const;
const MODES = ["template", "text", "skip"] as const;

export function defaultVariables(count: number): VariableSource[] {
  return Array.from({ length: count }, (_, i) => ({
    source: i === 0 ? "firstName" : "text",
    text: "",
  }));
}

/** "Daniela Reis" → "Daniela". */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

export function hasName(contact: ListContact): boolean {
  return Boolean(contact.name?.trim());
}

/** Posições (1, 2…) das variáveis que usam o nome do contato. */
export function nameSlots(variables: VariableSource[]): number[] {
  return variables.flatMap((v, i) => (v.source === "text" ? [] : [i + 1]));
}

/**
 * Texto de cada variável para um contato, ou `null` quando falta o nome e não
 * há texto para quem não tem nome.
 */
export function variableValues(
  contact: ListContact,
  variables: VariableSource[],
): string[] | null {
  const values = variables.map((v) => {
    if (v.source === "text") return v.text.trim();
    const value = v.source === "firstName" ? firstName(contact.name) : contact.name?.trim();
    return value || v.text.trim();
  });
  return values.some((v) => !v) ? null : values;
}

/** Variáveis da versão sem nome: só as de texto, na ordem (a versão é renumerada). */
export function namelessValues(variables: VariableSource[]): string[] {
  return variables.filter((v) => v.source === "text").map((v) => v.text.trim());
}

/** Recusa entrada malformada (a action recebe JSON do navegador). */
export function validateListInput(
  contacts: unknown,
  variables: unknown,
  parameterCount: number,
  nameless?: unknown,
): {
  contacts: ListContact[];
  variables: VariableSource[];
  nameless: { mode: NamelessMode; templateId: string };
} {
  if (!Array.isArray(contacts) || !contacts.length)
    throw new Error("Adicione pelo menos um contato.");
  if (contacts.length > MAX_RECIPIENTS)
    throw new Error(`O limite é de ${MAX_RECIPIENTS} contatos por disparo.`);
  const list = contacts.map((c) => {
    if (!c || typeof c !== "object") throw new Error("Contato inválido.");
    const { phone, name } = c as Record<string, unknown>;
    if (typeof phone !== "string" || phone.length > 40)
      throw new Error("Contato com telefone inválido.");
    if (name != null && (typeof name !== "string" || name.length > 120))
      throw new Error("Nome acima de 120 caracteres.");
    return { phone, name: (name as string | null | undefined)?.trim() || null };
  });
  if (!Array.isArray(variables) || variables.length !== parameterCount)
    throw new Error("Preencha todas as variáveis da mensagem.");
  const vars = variables.map((v, i) => {
    const { source, text } = (v ?? {}) as Record<string, unknown>;
    if (!SOURCES.includes(source as never) || typeof text !== "string")
      throw new Error("Variável inválida.");
    if (text.length > 1024)
      throw new Error(`Texto do espaço ${i + 1} acima de 1.024 caracteres.`);
    if (source === "text" && !text.trim())
      throw new Error(`Escreva o texto do espaço ${i + 1}.`);
    return { source, text } as VariableSource;
  });
  const raw = (nameless ?? {}) as Record<string, unknown>;
  const mode = MODES.includes(raw.mode as never) ? (raw.mode as NamelessMode) : "text";
  const templateId = typeof raw.templateId === "string" ? raw.templateId : "";
  if (mode === "template" && nameSlots(vars).length && !templateId)
    throw new Error("Escolha a mensagem para quem não tem nome.");
  return { contacts: list, variables: vars, nameless: { mode, templateId } };
}

type Row = { row: number; value: Record<string, string> };

function toRow(row: number, contact: ListContact, values: string[]): Row {
  return {
    row,
    value: {
      telefone: contact.phone,
      nome: contact.name ?? "",
      ...Object.fromEntries(values.map((v, j) => [`var_${j + 1}`, v])),
    },
  };
}

/**
 * Linhas no formato do arquivo (`telefone`, `nome`, `var_n`) para
 * `parseBroadcastRows`, já separadas: `main` recebe a mensagem do disparo e
 * `nameless` a versão sem nome. A linha guarda a posição original do contato,
 * para os problemas apontarem o contato certo.
 */
export function listRows(
  contacts: ListContact[],
  variables: VariableSource[],
  mode: NamelessMode = "text",
): { main: Row[]; nameless: Row[]; skipped: number; issues: { row: number; error: string }[] } {
  const usesName = nameSlots(variables).length > 0;
  const main: Row[] = [];
  const nameless: Row[] = [];
  const issues: { row: number; error: string }[] = [];
  let skipped = 0;
  contacts.forEach((contact, i) => {
    const row = i + 1;
    if (usesName && !hasName(contact) && mode !== "text") {
      if (mode === "skip") skipped++;
      else nameless.push(toRow(row, contact, namelessValues(variables)));
      return;
    }
    const values = variableValues(contact, variables);
    if (!values) {
      const slot = nameSlots(variables)[0];
      issues.push({
        row,
        error: `Sem nome. Escreva no espaço ${slot} o que vai no lugar do nome.`,
      });
      return;
    }
    main.push(toRow(row, contact, values));
  });
  return { main, nameless, skipped, issues };
}

export type PastedLine =
  | { line: number; ok: true; phone: string; name: string | null }
  | { line: number; ok: false; text: string; missingCountry: boolean };

/**
 * Uma linha por contato: telefone e, se quiser, o nome depois de vírgula,
 * ponto e vírgula ou tabulação. Colar duas colunas do Excel chega com
 * tabulação, então funciona direto. Aceita também o nome antes do telefone.
 */
export function parsePastedContacts(text: string): PastedLine[] {
  const result: PastedLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line
      .split(/[\t;,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const phoneIndex = parts.findIndex((p) => /^\+?[\d\s().-]{8,}$/.test(p));
    const rawPhone = phoneIndex >= 0 ? parts[phoneIndex] : line;
    // "11 98765-4321" passaria como número estrangeiro (DDI 1): sem "+" na
    // frente, formato brasileiro sem o 55 é apontado, nunca enviado.
    const ambiguous =
      !rawPhone.trim().startsWith("+") && looksBrazilianWithoutCountry(rawPhone);
    const phone = ambiguous ? null : normalizeBroadcastPhone(rawPhone);
    const name =
      phoneIndex >= 0
        ? parts.filter((_, j) => j !== phoneIndex).join(" ").slice(0, 120) ||
          null
        : null;
    if (phone) result.push({ line: i + 1, ok: true, phone, name });
    else
      result.push({
        line: i + 1,
        ok: false,
        text: line,
        missingCountry: looksBrazilianWithoutCountry(rawPhone),
      });
  });
  return result;
}

/** DDD + 8 ou 9 dígitos, sem o 55. Só para oferecer o botão — nunca corrige sozinho. */
export function looksBrazilianWithoutCountry(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(digits);
}

/** Acrescenta `+55` às linhas que parecem brasileiras sem DDI — por clique explícito. */
export function addBrazilCountryCode(text: string): string {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const parts = raw.split(/([\t;,])/);
      return parts
        .map((p) =>
          looksBrazilianWithoutCountry(p) && /^\s*[\d\s().-]+\s*$/.test(p)
            ? p.replace(/^(\s*)/, "$1+55 ")
            : p,
        )
        .join("");
    })
    .join("\n");
}
