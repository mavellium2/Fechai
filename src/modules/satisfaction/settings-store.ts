import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TIMEZONES } from "@/modules/scheduling/time";
import {
  DEFAULT_SURVEY_TEXTS,
  SURVEY_DELAY_MAX,
  SURVEY_DELAY_MIN,
  SURVEY_TEXT_MAX,
  parseSurveySettings,
  type SurveySettings,
} from "./settings";

const flag = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const text = z.string().trim().max(SURVEY_TEXT_MAX, `Use até ${SURVEY_TEXT_MAX} caracteres.`).optional().default("");

/** O que a clínica ajusta na tela: ligar, esperar, horário e os textos. */
export const surveySettingsFormSchema = z
  .object({
    enabled: flag,
    delayMinutes: z.coerce
      .number({ message: "Informe a espera em minutos." })
      .int("Informe a espera em minutos.")
      .min(SURVEY_DELAY_MIN, `A espera mínima é de ${SURVEY_DELAY_MIN} minutos.`)
      .max(SURVEY_DELAY_MAX, "A espera máxima é de 20 horas."),
    windowStartHour: z.coerce.number().int().min(0, "Hora inválida.").max(23, "Hora inválida."),
    windowEndHour: z.coerce.number().int().min(1, "Hora inválida.").max(24, "Hora inválida."),
    timezone: z.string().refine((v) => TIMEZONES.some((z) => z.value === v), "Fuso inválido."),
    ratingText: text,
    lowText: text,
    highText: text,
    thanksText: text,
  })
  .superRefine((d, ctx) => {
    if (d.windowEndHour <= d.windowStartHour) {
      ctx.addIssue({ code: "custom", path: ["windowEndHour"], message: "O fim da janela precisa ser depois do início." });
    }
  });

export type SurveySettingsForm = z.infer<typeof surveySettingsFormSchema>;

/** Texto vazio ou igual ao padrão não é gravado: continua valendo o padrão. */
const store = (value: string, fallback: string) => (value && value !== fallback ? value : null);

export async function getSurveySettings(tenantId: string): Promise<SurveySettings> {
  const row = await prisma.satisfactionSurveySettings.findUnique({ where: { tenantId } });
  return parseSurveySettings(row);
}

export async function saveSurveySettings(tenantId: string, data: SurveySettingsForm): Promise<SurveySettings> {
  const values = {
    enabled: data.enabled,
    delayMinutes: data.delayMinutes,
    windowStartHour: data.windowStartHour,
    windowEndHour: data.windowEndHour,
    timezone: data.timezone,
    ratingText: store(data.ratingText, DEFAULT_SURVEY_TEXTS.rating),
    lowText: store(data.lowText, DEFAULT_SURVEY_TEXTS.low),
    highText: store(data.highText, DEFAULT_SURVEY_TEXTS.high),
    thanksText: store(data.thanksText, DEFAULT_SURVEY_TEXTS.thanks),
  };
  const row = await prisma.satisfactionSurveySettings.upsert({
    where: { tenantId },
    create: { tenantId, ...values },
    update: values,
  });
  return parseSurveySettings(row);
}
