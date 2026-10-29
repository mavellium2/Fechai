import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { MAX_GROUP_NAME, normalizeGroupId } from "@/modules/agent-engine/handoff";
import { TIMEZONES } from "@/modules/scheduling/time";
import { normalizeBrazilianPhone } from "@/modules/whatsapp/contact-phone";
import { parseCampaignSettings, type CampaignSettings } from "./settings";

const flag = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const optionalText = z.preprocess((v) => (typeof v === "string" ? v : ""), z.string());

export const PHONE_HELP = "Informe o número com DDD, ex.: (11) 98765-4321.";

/**
 * O que a clínica ajusta na tela: ligar, dia da semana, hora, fuso e o destino
 * (um grupo ou um número). Os dois destinos são sempre enviados, para trocar de
 * um para o outro sem perder o que estava salvo no outro.
 */
export const campaignSettingsFormSchema = z
  .object({
    enabled: flag,
    weekday: z.coerce.number({ message: "Escolha o dia da semana." }).int("Escolha o dia da semana.").min(0, "Dia inválido.").max(6, "Dia inválido."),
    hour: z.coerce.number({ message: "Escolha a hora." }).int("Escolha a hora.").min(0, "Hora inválida.").max(23, "Hora inválida."),
    timezone: z.string().refine((v) => TIMEZONES.some((z) => z.value === v), "Fuso inválido."),
    destination: z.enum(["group", "phone"], { message: "Escolha para onde enviar." }),
    groupId: optionalText,
    groupName: optionalText,
    phone: optionalText,
  })
  .superRefine((data, ctx) => {
    if (data.groupId.trim() && !normalizeGroupId(data.groupId)) {
      ctx.addIssue({ code: "custom", path: ["groupId"], message: "O grupo escolhido não é válido." });
    }
    if (data.phone.trim() && !normalizeBrazilianPhone(data.phone)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: PHONE_HELP });
    }
  })
  .transform((data) => {
    const groupId = normalizeGroupId(data.groupId);
    return {
      enabled: data.enabled,
      weekday: data.weekday,
      hour: data.hour,
      timezone: data.timezone,
      destination: data.destination,
      groupId,
      groupName: groupId && data.groupName.trim() ? data.groupName.trim().slice(0, MAX_GROUP_NAME) : null,
      phone: normalizeBrazilianPhone(data.phone),
    };
  });

export type CampaignSettingsForm = z.infer<typeof campaignSettingsFormSchema>;

/**
 * Ligar o envio exige um destino completo: um número, ou um grupo (o escolhido
 * aqui ou, sem escolha, o dos avisos de Perguntas). Desligado, salva incompleto:
 * é rascunho. `null` = tudo certo.
 */
export function destinationProblem(data: CampaignSettingsForm, questionsGroupId: string | null): string | null {
  if (!data.enabled) return null;
  if (data.destination === "phone") return data.phone ? null : PHONE_HELP;
  return data.groupId || questionsGroupId ? null : "Escolha o grupo do WhatsApp que recebe o relatório.";
}

export async function getCampaignSettings(tenantId: string): Promise<CampaignSettings> {
  const row = await prisma.campaignReportSettings.findUnique({ where: { tenantId } });
  return parseCampaignSettings(row);
}

export async function saveCampaignSettings(tenantId: string, data: CampaignSettingsForm): Promise<CampaignSettings> {
  const row = await prisma.campaignReportSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return parseCampaignSettings(row);
}
