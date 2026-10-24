import { prisma } from "@/lib/prisma";

/**
 * Quais calendários a conta habilitou em /integracoes › Calendários.
 *
 * Habilitar é uma decisão anterior a configurar: em /integracoes a pessoa diz
 * "quero usar o Clinicorp", e só então os campos de credencial aparecem na
 * /agenda, que é onde a agenda de fato se configura. Sem isso a lateral da
 * agenda mostraria formulários de todo sistema que já integramos, para toda
 * conta — a maioria nunca vai usar nenhum.
 *
 * Desabilitar **não apaga** as credenciais (isso é desconectar, na /agenda):
 * quem desliga por uma semana espera reencontrar tudo ao religar.
 */

export type CalendarFeatureKey = "google" | "clinicorp" | "icloud";

export type CalendarFeatures = {
  googleEnabled: boolean;
  clinicorpEnabled: boolean;
  icloudEnabled: boolean;
};

/** Coluna de cada calendário. Uma chave nova entra aqui e no tipo acima — mais nada. */
export const CALENDAR_FEATURE_FIELDS = {
  google: "googleEnabled",
  clinicorp: "clinicorpEnabled",
  icloud: "icloudEnabled",
} as const satisfies Record<CalendarFeatureKey, keyof CalendarFeatures>;

/** Nada habilitado — o padrão de toda conta que nunca abriu a aba. */
const NONE: CalendarFeatures = { googleEnabled: false, clinicorpEnabled: false, icloudEnabled: false };

export async function getCalendarFeatures(tenantId: string, onUnavailable?: () => void): Promise<CalendarFeatures> {
  const row = await prisma.calendarFeatures
    .findUnique({
      where: { tenantId },
      select: { googleEnabled: true, clinicorpEnabled: true, icloudEnabled: true },
    })
    .catch(() => { onUnavailable?.(); return null; });
  return row ?? NONE;
}

export async function setCalendarFeature(
  tenantId: string,
  key: CalendarFeatureKey,
  enabled: boolean,
): Promise<void> {
  const field = CALENDAR_FEATURE_FIELDS[key];
  await prisma.calendarFeatures.upsert({
    where: { tenantId },
    create: { tenantId, ...NONE, [field]: enabled },
    update: { [field]: enabled },
  });
}
