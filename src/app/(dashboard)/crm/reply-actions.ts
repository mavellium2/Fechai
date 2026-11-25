"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isFrameworkSignal } from "@/components/ui/toast/save-service";
import type { ActionResult } from "@/components/ui/toast/types";
import { requireCrmSession } from "@/modules/crm/access";
import { sendManualReply } from "@/modules/agent-engine/conversation";
import { validCrmId } from "@/modules/crm/board-filters";
import { CRM_REPLY_LIMIT } from "@/modules/crm/limits";

export async function sendCrmReply(leadId: string, _previous: ActionResult | null, form: FormData): Promise<ActionResult & { ok: boolean }> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou." };
    const session = await requireCrmSession();
    const conversationId = form.get("conversationId");
    const raw = form.get("text");
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!validCrmId(leadId) || !validCrmId(conversationId) || !text || text.length > CRM_REPLY_LIMIT || text.includes("\0")) {
      return { ok: false, code: "validation", error: "Confira a conversa e escreva uma resposta de até 4.096 caracteres." };
    }
    const result = await sendManualReply(session.user.tenantId, conversationId, text, undefined, { leadId, userId: session.user.id });
    revalidatePath("/crm");
    revalidatePath("/conversas");
    revalidatePath("/inicio");
    return result.ok ? { ok: true, info: "Resposta enviada." } : result;
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso ao CRM." };
    console.error("[crm] falha ao confirmar a resposta");
    return { ok: false, code: "server", error: "Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente." };
  }
}
