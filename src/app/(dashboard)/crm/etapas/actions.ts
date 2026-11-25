"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isFrameworkSignal } from "@/components/ui/toast/save-service";
import type { ActionResult } from "@/components/ui/toast/types";
import { requireCrmSession } from "@/modules/crm/access";
import { editCrmStages, stageEditSchema } from "@/modules/crm/stage-settings";
import { parseCrmLossCatalog, updateCrmLossCatalog } from "@/modules/crm/loss-reasons";

const success = {
  create: "Etapa criada.", rename: "Etapa renomeada.", move: "Ordem das etapas atualizada.", archive: "Etapa arquivada.",
};

export async function saveCrmStage(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou. Faça login novamente." };
    const session = await requireCrmSession();
    const actor = { tenantId: session.user.tenantId, userId: session.user.id };
    const direction = formData.get("direction");
    const parsed = stageEditSchema.safeParse({
      ...Object.fromEntries(formData),
      neighborId: formData.get(direction === "up" ? "beforeId" : "afterId"),
    });
    if (!parsed.success) return { ok: false, code: "validation", error: "Confira os dados da etapa e tente salvar novamente." };

    const result = await editCrmStages(actor, parsed.data);
    if (result === "forbidden") return { ok: false, code: "forbidden", error: "O CRM está indisponível para esta conta." };
    if (result === "system_stage") return { ok: false, code: "validation", error: "Etapas de sistema permanecem ativas." };
    if (result === "duplicate") return { ok: false, code: "validation", error: "Já existe uma etapa ativa com esse nome." };
    if (result === "stale" || result === "destination") {
      revalidatePath("/crm/etapas");
      const error = result === "stale"
        ? "As etapas mudaram. Confira a lista atual e tente novamente."
        : "Escolha outra etapa ativa para receber os leads.";
      return { ok: false, code: "validation", error };
    }
    revalidatePath("/crm");
    revalidatePath("/crm/etapas");
    return { ok: true, info: result === "changed" ? success[parsed.data.intent] : "A etapa já está atualizada." };
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso à configuração do CRM." };
    console.error("[crm] falha ao configurar etapa", error);
    return { ok: false, code: "server", error: "Não foi possível salvar a etapa. Tente novamente." };
  }
}

export async function saveCrmLossCatalog(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou." };
    const session = await requireCrmSession();
    const labels = parseCrmLossCatalog(form.get("reasons"));
    const previous = form.get("revision");
    if (!labels || typeof previous !== "string" || !/^[a-f0-9]{64}$/.test(previous)) {
      return { ok: false, code: "validation", error: "Informe de 1 a 20 motivos diferentes, com até 80 caracteres em cada linha." };
    }
    const result = await updateCrmLossCatalog(session.user.tenantId, labels, previous);
    if (result === "unavailable") return { ok: false, code: "forbidden", error: "O CRM está indisponível para esta conta." };
    revalidatePath("/crm/etapas");
    if (result === "stale") return { ok: false, code: "validation", error: "Os motivos mudaram. Confira a lista atual e salve novamente." };
    revalidatePath("/crm");
    return { ok: true, info: "Motivos de perda salvos." };
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso à configuração do CRM." };
    console.error("[crm] falha ao configurar motivos de perda", error);
    return { ok: false, code: "server", error: "Não foi possível salvar os motivos de perda." };
  }
}
