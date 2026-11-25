"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isFrameworkSignal } from "@/components/ui/toast/save-service";
import type { ActionResult } from "@/components/ui/toast/types";
import { requireCrmSession } from "@/modules/crm/access";
import { CRM_TAG_MAX, CRM_TASK_MAX, validCrmId } from "@/modules/crm/board-filters";
import { editCrmLead, parseCrmTaskDue } from "@/modules/crm/lead-detail-actions";
import { setLeadStage } from "@/modules/crm/lead-stage";
import { claimCrmConversation } from "@/modules/crm/assignments";
import { currentAssigneeName, returnToAiAndReply, transferCrmConversation } from "@/modules/crm/handoff-panel";
import { claimPhoneReplies } from "@/modules/crm/phone-reply";
import { CRM_MANUAL_NAME_MAX } from "@/modules/crm/limits";
import {
  createManualCrmLead, deleteManualCrmLead, normalizeCrmName, normalizeCrmPhone,
} from "@/modules/crm/manual-leads";
import { recordAudit, recordDeletion } from "@/modules/audit/log";

export async function moveCrmCard(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou." };
    const session = await requireCrmSession();
    const tenantId = session.user.tenantId;
    const userId = session.user.id;
    const leadId = form.get("leadId");
    const expectedStageId = form.get("fromStageId");
    const stageId = form.get("stageId");
    const reason = form.get("reason");
    const note = form.get("lossReasonNote");
    if (!validCrmId(leadId) || !validCrmId(expectedStageId) || !validCrmId(stageId)
      || (reason && !validCrmId(reason))) {
      return { ok: false, code: "validation", error: "Confira o destino e o motivo da movimentação." };
    }
    const result = await setLeadStage({ tenantId, leadId, expectedStageId, stageId, source: "user", userId,
      reason: validCrmId(reason) ? reason : undefined, lossReasonNote: typeof note === "string" ? note : undefined });
    if (result === "loss_reason_required") {
      revalidatePath("/crm");
      return { ok: false, code: "validation", error: "Escolha um motivo de perda disponível para esta conta." };
    }
    if (result === "loss_note_required") return { ok: false, code: "validation", error: "Informe uma justificativa de até 500 caracteres." };
    if (result === "not_found") return { ok: false, code: "forbidden", error: "O lead ou a etapa não está disponível." };
    revalidatePath("/crm");
    if (result === "conflict") return { ok: false, code: "validation", error: "O lead mudou de etapa. Confira o quadro e tente novamente." };
    return { ok: true, info: result === "moved" ? "Lead movido." : "O lead já está nessa etapa." };
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso ao CRM." };
    console.error("[crm] falha ao mover card", error);
    return { ok: false, code: "server", error: "Não foi possível mover o lead. Tente novamente." };
  }
}

/**
 * Adiciona um lead direto no quadro. O número entra como cadastro manual e a
 * etapa escolhida vale como entrada: nada de conversa, mensagem ou disparo.
 */
export async function createCrmLead(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou." };
    const session = await requireCrmSession();
    const tenantId = session.user.tenantId;
    const stageId = form.get("stageId");
    const rawName = form.get("name");
    const rawPhone = form.get("phone");
    if (!validCrmId(stageId)) return { ok: false, code: "validation", error: "Escolha a etapa inicial do lead." };
    if (typeof rawName === "string" && rawName.trim().length > CRM_MANUAL_NAME_MAX) {
      return { ok: false, code: "validation", error: `O nome pode ter até ${CRM_MANUAL_NAME_MAX} caracteres.` };
    }
    const phone = normalizeCrmPhone(typeof rawPhone === "string" ? rawPhone : "");
    if (!phone) return { ok: false, code: "validation", error: "Telefone inválido. Use DDD + número (ex.: 11 99999-9999)." };

    const name = normalizeCrmName(typeof rawName === "string" ? rawName : "");
    const result = await createManualCrmLead({ tenantId, userId: session.user.id, name: name ?? "", phone, stageId });
    if (result.status === "stage_unavailable") {
      return { ok: false, code: "validation", error: "Escolha uma etapa disponível do seu funil." };
    }
    revalidatePath("/crm");
    if (result.status === "exists") {
      return { ok: false, code: "validation", error: "Este número já está na sua lista. Abra o card para ver o lead." };
    }

    await recordAudit({
      event: "lead.created",
      target: { type: "Lead", id: result.leadId, label: result.name || result.phone },
      after: { name: result.name || null, phone: result.phone, stage: result.stageName },
    });
    revalidatePath("/conversas");
    revalidatePath("/contatos");
    revalidatePath("/inicio");
    return {
      ok: true,
      info: result.name
        ? `Lead de ${result.name} criado em ${result.stageName}.`
        : `Lead criado em ${result.stageName}.`,
    };
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso ao CRM." };
    console.error("[crm] falha ao adicionar lead", error);
    return { ok: false, code: "server", error: "Não foi possível adicionar o lead. Tente novamente." };
  }
}

/**
 * Exclui um lead sem histórico do quadro. Lead com mensagem ou agendamento é
 * recusado: o botão existe para limpar cadastro manual e teste, não para apagar
 * atendimento — a exclusão leva junto conversa, mensagens e histórico.
 */
export async function deleteCrmLead(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou." };
    const session = await requireCrmSession();
    const leadId = form.get("leadId");
    if (!validCrmId(leadId)) return { ok: false, code: "validation", error: "O lead não está disponível." };

    const result = await deleteManualCrmLead({ tenantId: session.user.tenantId, leadId });
    if (result.status === "not_found") return { ok: false, code: "forbidden", error: "O lead não está disponível no CRM." };
    if (result.status === "has_history") {
      return { ok: false, code: "validation", error: "Este lead tem conversa ou agendamento e não pode ser excluído pelo quadro." };
    }

    revalidatePath("/crm");
    await recordDeletion({
      event: "lead.deleted",
      target: { type: "Lead", id: leadId, label: result.label },
      snapshot: result.snapshot,
      meta: { via: "crm_board" },
      tenantId: session.user.tenantId,
    });
    revalidatePath("/conversas");
    revalidatePath("/contatos");
    revalidatePath("/inicio");
    return { ok: true, info: "Lead excluído." };
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso ao CRM." };
    console.error("[crm] falha ao excluir lead", error);
    return { ok: false, code: "server", error: "Não foi possível excluir o lead. Tente novamente." };
  }
}

export async function saveCrmLead(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    if (!(await auth())?.user) return { ok: false, code: "auth", error: "Sua sessão expirou." };
    const session = await requireCrmSession();
    const leadId = form.get("leadId");
    if (!validCrmId(leadId)) return { ok: false, code: "validation", error: "O lead não está disponível." };
    if (form.get("operation") === "claim") {
      const conversationId = form.get("conversationId");
      if (!validCrmId(conversationId)) return { ok: false, code: "validation", error: "Esta conversa está indisponível." };
      const result = await claimCrmConversation({ tenantId: session.user.tenantId, userId: session.user.id, leadId, conversationId });
      if (result === "unavailable") return { ok: false, code: "forbidden", error: "Esta conversa está indisponível no CRM." };
      revalidatePath("/crm");
      if (result === "assigned_elsewhere") {
        const name = await currentAssigneeName(session.user.tenantId, conversationId);
        return { ok: false, code: "validation", error: name ? `Esta conversa já está com ${name}.` : "Outra pessoa já está atendendo esta conversa." };
      }
      revalidatePath("/conversas");
      return { ok: true, info: "Atendimento assumido." };
    }
    if (form.get("operation") === "itWasMe") {
      const conversationId = form.get("conversationId");
      if (!validCrmId(conversationId)) return { ok: false, code: "validation", error: "Esta conversa está indisponível." };
      const tenantId = session.user.tenantId;
      const result = await claimPhoneReplies({ tenantId, userId: session.user.id, leadId, conversationId });
      revalidatePath("/crm");
      revalidatePath("/conversas");
      if (result === "unavailable") return { ok: false, code: "forbidden", error: "Esta conversa está indisponível no CRM." };
      if (result === "assigned_elsewhere") {
        const name = await currentAssigneeName(tenantId, conversationId);
        return { ok: false, code: "validation", error: name ? `Esta conversa já está com ${name}.` : "Outra pessoa já está atendendo esta conversa." };
      }
      return { ok: true, info: "Pronto: as respostas pelo celular ficaram com você." };
    }
    if (form.get("operation") === "transfer") {
      const conversationId = form.get("conversationId");
      const toUserId = form.get("toUserId");
      const expectedUserId = form.get("expectedUserId");
      if (!validCrmId(conversationId) || !validCrmId(expectedUserId)) return { ok: false, code: "validation", error: "Esta conversa está indisponível." };
      if (!validCrmId(toUserId)) return { ok: false, code: "validation", error: "Escolha para quem transferir." };
      const tenantId = session.user.tenantId;
      const result = await transferCrmConversation({ tenantId, conversationId, actorUserId: session.user.id, toUserId, expectedUserId });
      revalidatePath("/crm");
      revalidatePath("/conversas");
      if (result.status === "transferred") return { ok: true, info: "Atendimento transferido." };
      if (result.status === "same") return { ok: false, code: "validation", error: "Escolha outra pessoa da equipe." };
      if (result.status === "changed") {
        const name = await currentAssigneeName(tenantId, conversationId);
        return { ok: false, code: "validation", error: name ? `O atendimento mudou: agora está com ${name}.` : "O atendimento mudou. Confira e tente de novo." };
      }
      if (result.status === "not_assigned") return { ok: false, code: "validation", error: "Ninguém assumiu esta conversa ainda." };
      return { ok: false, code: "forbidden", error: "A conversa ou a pessoa escolhida não está disponível." };
    }
    if (form.get("operation") === "returnToAi") {
      const conversationId = form.get("conversationId");
      if (!validCrmId(conversationId)) return { ok: false, code: "validation", error: "Esta conversa está indisponível." };
      const tenantId = session.user.tenantId;
      const result = await returnToAiAndReply({ tenantId, conversationId, actorUserId: session.user.id });
      if (result.status === "no_agent") return { ok: false, code: "validation", error: "Ative um agente em Agentes antes de devolver esta conversa." };
      if (result.status !== "returned") return { ok: false, code: "forbidden", error: "Esta conversa está indisponível." };
      const { recovery } = result;
      revalidatePath("/crm");
      revalidatePath("/conversas");
      if (recovery.status === "failed") return { ok: false, code: "server", error: recovery.error };
      return { ok: true, info: recovery.status === "sent" ? "Devolvido para a IA, que já respondeu a mensagem pendente." : "Devolvido para a IA." };
    }
    const edit = readEdit(form);
    if ("error" in edit) return { ok: false, code: "validation", error: edit.error };

    const result = await editCrmLead(session.user.tenantId, leadId, edit, session.user.id);
    if (result !== "ok") return { ok: false, code: "forbidden", error: "O lead, a etiqueta, a tarefa ou a pessoa selecionada não está disponível." };
    revalidatePath("/crm");
    return { ok: true, info: {
      addTag: "Etiqueta aplicada.", newTag: "Etiqueta aplicada.", removeTag: "Etiqueta removida.",
      createTask: "Tarefa criada.", completeTask: "Tarefa concluída.",
    }[edit.kind] };
  } catch (error) {
    if (isFrameworkSignal(error)) return { ok: false, code: "forbidden", error: "Você não tem acesso ao CRM." };
    console.error("[crm] falha ao atualizar detalhes do lead", error);
    return { ok: false, code: "server", error: "Não foi possível salvar. Tente novamente." };
  }
}

function readEdit(form: FormData): Parameters<typeof editCrmLead>[2] | { error: string } {
  const operation = form.get("operation");
  if (operation === "addTag" || operation === "removeTag") {
    const tagId = form.get("tagId");
    return validCrmId(tagId) ? { kind: operation, tagId } : { error: "Selecione uma etiqueta." };
  }
  if (operation === "newTag") {
    const value = form.get("name");
    const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    return name && name.length <= CRM_TAG_MAX && !/\p{Cc}/u.test(name)
      ? { kind: operation, name }
      : { error: `Informe um nome de até ${CRM_TAG_MAX} caracteres.` };
  }
  if (operation === "createTask") {
    const value = form.get("text");
    const text = typeof value === "string" ? value.trim() : "";
    const dueAt = parseCrmTaskDue(form.get("dueAt"));
    const assignee = form.get("assignedUserId");
    if (!text || text.length > CRM_TASK_MAX) return { error: `Descreva a tarefa em até ${CRM_TASK_MAX} caracteres.` };
    if (!dueAt) return { error: "Informe uma data e hora válidas para a tarefa." };
    if (assignee && !validCrmId(assignee)) return { error: "Selecione uma pessoa responsável válida." };
    return { kind: operation, text, dueAt, assignedUserId: validCrmId(assignee) ? assignee : null };
  }
  if (operation === "completeTask") {
    const taskId = form.get("taskId");
    return validCrmId(taskId) ? { kind: operation, taskId } : { error: "Selecione uma tarefa." };
  }
  return { error: "Operação inválida." };
}
