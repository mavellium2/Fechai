"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isFrameworkSignal } from "@/components/ui/toast/save-service";
import type { ActionResult } from "@/components/ui/toast/types";
import { requireCrmSession } from "@/modules/crm/access";
import { HANDOFF_SLA_MAX_MINUTES } from "@/modules/crm/handoff-sla";
import { AUTO_RETURN_MAX_HOURS } from "@/modules/crm/handoff-auto-return";

const minutes = z.coerce.number().int().min(1).max(HANDOFF_SLA_MAX_MINUTES);
const slaSchema = z.object({
  alertMinutes: minutes,
  escalateMinutes: minutes,
  businessHoursOnly: z.boolean(),
  escalateByEmail: z.boolean(),
  // CRM-12: desligada = null. Ligada exige as horas.
  autoReturnHours: z.coerce.number().int().min(1).max(AUTO_RETURN_MAX_HOURS).nullable(),
  autoReturnBusinessHoursOnly: z.boolean(),
  autoReturnHumanStage: z.boolean(),
}).refine(({ alertMinutes, escalateMinutes }) => escalateMinutes > alertMinutes, { path: ["escalateMinutes"] });

/** Prazos do transbordo da conta (CRM-10). */
export async function saveHandoffSlaSettings(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou. Faça login novamente." };
    const session = await requireCrmSession();
    const parsed = slaSchema.safeParse({
      alertMinutes: form.get("alertMinutes"),
      escalateMinutes: form.get("escalateMinutes"),
      businessHoursOnly: form.get("businessHoursOnly") === "on",
      escalateByEmail: form.get("escalateByEmail") === "on",
      autoReturnHours: form.get("autoReturn") === "on" ? form.get("autoReturnHours") : null,
      autoReturnBusinessHoursOnly: form.get("autoReturnBusinessHoursOnly") === "on",
      autoReturnHumanStage: form.get("autoReturnHumanStage") === "on",
    });
    if (!parsed.success) {
      // A única regra entre os dois campos é a ordem; o resto é faixa de minutos.
      const orderOnly = parsed.error.issues.every(({ code }) => code === "custom");
      return {
        ok: false, code: "validation",
        error: orderOnly
          ? "O escalonamento precisa vir depois do primeiro alerta."
          : parsed.error.issues.some(({ path }) => path[0] === "autoReturnHours")
            ? `Para devolver para a IA, use horas inteiras entre 1 e ${AUTO_RETURN_MAX_HOURS} (7 dias).`
            : `Use minutos inteiros entre 1 e ${HANDOFF_SLA_MAX_MINUTES} (7 dias).`,
      };
    }
    const tenantId = session.user.tenantId;
    await prisma.handoffSlaSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...parsed.data, updatedById: session.user.id },
      update: { ...parsed.data, updatedById: session.user.id },
    });
    revalidatePath("/crm/transbordo");
    revalidatePath("/crm");
    return { ok: true };
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso ao CRM." };
    console.error("[crm] falha ao salvar os prazos do transbordo", error);
    return { ok: false, code: "server", error: "Não foi possível salvar. Tente novamente." };
  }
}
