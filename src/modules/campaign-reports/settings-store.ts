import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TIMEZONES } from "@/modules/scheduling/time";
import { parseCampaignSettings, type CampaignSettings } from "./settings";

const flag = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** O que a clínica ajusta na tela: ligar, dia da semana, hora e fuso. */
export const campaignSettingsFormSchema = z.object({
  enabled: flag,
  weekday: z.coerce.number({ message: "Escolha o dia da semana." }).int("Escolha o dia da semana.").min(0, "Dia inválido.").max(6, "Dia inválido."),
  hour: z.coerce.number({ message: "Escolha a hora." }).int("Escolha a hora.").min(0, "Hora inválida.").max(23, "Hora inválida."),
  timezone: z.string().refine((v) => TIMEZONES.some((z) => z.value === v), "Fuso inválido."),
});

export type CampaignSettingsForm = z.infer<typeof campaignSettingsFormSchema>;

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
