import { z } from "zod";
import {
  BUDGET_MAX_CENTS,
  DESCRIPTION_MAX,
  GOAL_MAX,
  GOAL_TYPES,
  KEYWORD_MAX,
  KEYWORDS_MAX,
  NAME_MAX,
  NAME_MIN,
  OBJECTIVE_MAX,
  OBJECTIVE_TYPES,
} from "./limits";
import { isAcceptableDay, MAX_YEAR, MIN_YEAR } from "./period";

/**
 * Validação do formulário de campanha — a regra que decide no servidor (a tela
 * só espelha os limites, vindos de `limits.ts`).
 *
 * Nada aqui fala de banco nem de fuso: as datas chegam como dia
 * `YYYY-MM-DD` (o valor de `<input type="date">`) e viram instante UTC em
 * `period.ts`.
 */

export { NAME_MAX, NAME_MIN, OBJECTIVE_MAX, DESCRIPTION_MAX };

export type CampaignField =
  | "name"
  | "objectiveType"
  | "objective"
  | "description"
  | "startsOn"
  | "endsOn"
  | "goalValue"
  | "goalType"
  | "budget"
  | "messageCost"
  | "keywords";
export type CampaignFieldErrors = Partial<Record<CampaignField, string>>;

const FIELDS: readonly CampaignField[] = [
  "name",
  "objectiveType",
  "objective",
  "description",
  "startsOn",
  "endsOn",
  "goalValue",
  "goalType",
  "budget",
  "messageCost",
  "keywords",
];

/** "1.500,50" / "1500.5" / "1500" → centavos; vazio → null; inválido → NaN. */
export function parseMoneyToCents(value: string): number | null {
  const raw = value.replace(/[R$\s]/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}

/** "implante, Implante; evento" → ["implante", "evento"] (sem repetidos, ordem mantida). */
export function parseKeywords(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value.split(/[,;\n]/)) {
    const term = item.trim().replace(/\s+/g, " ");
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

// NUL quebra o Postgres (`text` não guarda \u0000) e controle no nome vira lixo
// na lista. No objetivo, quebra de linha e tab são texto de gente e passam.
const CONTROL_IN_NAME = /[\u0000-\u001f\u007f]/;
const CONTROL_IN_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Dia opcional: vazio = sem data; preenchido tem de existir no calendário. */
const optionalDay = z
  .string()
  .trim()
  .refine((value) => value === "" || isAcceptableDay(value), {
    message: `Escolha uma data válida, entre ${MIN_YEAR} e ${MAX_YEAR}.`,
  })
  .transform((value) => (value === "" ? null : value));

export const campaignFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Dê um nome à campanha.")
      .min(NAME_MIN, `O nome precisa de pelo menos ${NAME_MIN} letras.`)
      .max(NAME_MAX, `O nome pode ter até ${NAME_MAX} caracteres.`)
      .refine((value) => !CONTROL_IN_NAME.test(value), { message: "O nome não pode ter quebra de linha." }),
    objective: z
      .string()
      .trim()
      .max(OBJECTIVE_MAX, `O objetivo pode ter até ${OBJECTIVE_MAX} caracteres.`)
      .refine((value) => !CONTROL_IN_TEXT.test(value), { message: "O objetivo tem um caractere que não pode ser salvo." })
      .transform((value) => (value === "" ? null : value)),
    objectiveType: z
      .string()
      .trim()
      .refine((value) => value === "" || (OBJECTIVE_TYPES as readonly string[]).includes(value), {
        message: "Escolha um objetivo da lista.",
      })
      .transform((value) => (value === "" ? null : value)),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, `A descrição pode ter até ${DESCRIPTION_MAX} caracteres.`)
      .refine((value) => !CONTROL_IN_TEXT.test(value), { message: "A descrição tem um caractere que não pode ser salvo." })
      .transform((value) => (value === "" ? null : value)),
    startsOn: optionalDay,
    endsOn: optionalDay,
    goalValue: z
      .string()
      .trim()
      .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= GOAL_MAX), {
        message: `A meta é um número inteiro entre 1 e ${GOAL_MAX}.`,
      })
      .transform((value) => (value === "" ? null : Number(value))),
    goalType: z
      .string()
      .trim()
      .refine((value) => value === "" || (GOAL_TYPES as readonly string[]).includes(value), { message: "Escolha o tipo da meta." })
      .transform((value) => (value === "" ? null : value)),
    budget: z
      .string()
      .trim()
      .transform((value) => parseMoneyToCents(value))
      .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= BUDGET_MAX_CENTS), {
        message: "Informe o investimento em reais, como 1.500,00.",
      }),
    messageCost: z
      .string()
      .trim()
      .transform((value) => parseMoneyToCents(value))
      .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 10_000), {
        message: "Informe o custo por mensagem em reais, como 0,35.",
      }),
    keywords: z
      .string()
      .transform((value) => parseKeywords(value))
      .refine((list) => list.length <= KEYWORDS_MAX, { message: `Use até ${KEYWORDS_MAX} palavras-chave.` })
      .refine((list) => list.every((k) => k.length <= KEYWORD_MAX), {
        message: `Cada palavra-chave pode ter até ${KEYWORD_MAX} caracteres.`,
      }),
  })
  .refine((value) => !(value.goalValue !== null && value.goalType === null), {
    message: "Diga do que é a meta (leads, agendamentos ou comparecimentos).",
    path: ["goalType"],
  })
  // Só roda quando os campos individuais passaram. Datas ISO comparam como texto.
  .refine((value) => !(value.startsOn && value.endsOn && value.endsOn < value.startsOn), {
    message: "O fim não pode ser antes do início.",
    path: ["endsOn"],
  });

export type ParsedCampaignForm = z.output<typeof campaignFormSchema>;

export type CampaignFormParse =
  | { ok: true; data: ParsedCampaignForm }
  | { ok: false; errors: CampaignFieldErrors };

/** Campo de formulário → texto. Ausente ou arquivo vira vazio; CRLF vira LF (o `<textarea>` envia CRLF e contaria o dobro). */
function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
}

/**
 * Lê o que veio do formulário. Só os campos conhecidos entram: qualquer
 * outro (`tenantId`, `createdById`, `status`…) é ignorado aqui, de propósito —
 * quem manda no tenant é a sessão, nunca o formulário.
 */
export function parseCampaignForm(raw: Partial<Record<CampaignField, unknown>>): CampaignFormParse {
  const result = campaignFormSchema.safeParse({
    name: text(raw.name),
    objectiveType: text(raw.objectiveType),
    objective: text(raw.objective),
    description: text(raw.description),
    startsOn: text(raw.startsOn),
    endsOn: text(raw.endsOn),
    goalValue: text(raw.goalValue),
    goalType: text(raw.goalType),
    budget: text(raw.budget),
    messageCost: text(raw.messageCost),
    keywords: text(raw.keywords),
  });
  if (result.success) return { ok: true, data: result.data };

  const errors: CampaignFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && (FIELDS as readonly string[]).includes(field) && !errors[field as CampaignField]) {
      errors[field as CampaignField] = issue.message;
    }
  }
  return { ok: false, errors };
}
