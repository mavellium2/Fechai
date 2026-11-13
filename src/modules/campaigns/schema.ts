import { z } from "zod";
import { isAcceptableDay, MAX_YEAR, MIN_YEAR } from "./period";

/**
 * Validação do formulário de campanha — a mesma regra no cliente (limites que
 * a tela mostra) e no servidor (o que de fato decide).
 *
 * Nada aqui fala de banco nem de fuso: as datas chegam como dia
 * `YYYY-MM-DD` (o valor de `<input type="date">`) e viram instante UTC em
 * `period.ts`.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const OBJECTIVE_MAX = 280;

export type CampaignField = "name" | "objective" | "startsOn" | "endsOn";
export type CampaignFieldErrors = Partial<Record<CampaignField, string>>;

const FIELDS: readonly CampaignField[] = ["name", "objective", "startsOn", "endsOn"];

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
    startsOn: optionalDay,
    endsOn: optionalDay,
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
 * Lê o que veio do formulário. Só os quatro campos conhecidos entram: qualquer
 * outro (`tenantId`, `createdById`, `status`…) é ignorado aqui, de propósito —
 * quem manda no tenant é a sessão, nunca o formulário.
 */
export function parseCampaignForm(raw: Partial<Record<CampaignField, unknown>>): CampaignFormParse {
  const result = campaignFormSchema.safeParse({
    name: text(raw.name),
    objective: text(raw.objective),
    startsOn: text(raw.startsOn),
    endsOn: text(raw.endsOn),
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
