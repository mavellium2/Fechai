import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withConversationContactLock } from "@/modules/agent-engine/conversation-lock";
import { lockCrmAdmission } from "./admission";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";
import { activeCrm, realBoardLeads } from "./lead-scope";
import { CRM_MANUAL_NAME_MAX } from "./limits";

/**
 * Normaliza para E.164 (55 + DDD + número). Mesma regra de Contatos: aceita o
 * formato livre do Brasil e recusa o que não dá para discar.
 */
export function normalizeCrmPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  if (!/^[1-9]/.test(digits)) return null;
  return digits.length <= 11 ? `55${digits}` : digits;
}

/** Nome opcional, sem caractere de controle e com espaços normalizados. */
export function normalizeCrmName(raw: string): string | null {
  const name = raw.replace(/\p{Cc}/gu, " ").trim().replace(/\s+/g, " ");
  return name ? name.slice(0, CRM_MANUAL_NAME_MAX) : null;
}

export type CreateManualLeadResult =
  | { status: "created"; leadId: string; stageName: string; name: string; phone: string }
  | { status: "exists"; leadId: string }
  | { status: "stage_unavailable" };

/**
 * Cria um lead direto no quadro, na etapa escolhida.
 *
 * A criação e a transição inicial acontecem na mesma transação, com a trava de
 * admissão e a trava por telefone do atendimento — o mesmo caminho que o
 * webhook usa. Número que já existe na conta não é duplicado nem movido de
 * etapa: a tela avisa que ele já está na lista.
 */
export async function createManualCrmLead(input: {
  tenantId: string;
  userId: string;
  name: string;
  phone: string;
  stageId: string;
}): Promise<CreateManualLeadResult> {
  const { tenantId, userId, name, phone, stageId } = input;
  // O invólucro já segura a admissão compartilhada da conta e a trava por
  // telefone — as mesmas do webhook, então um número não nasce duas vezes.
  return withConversationContactLock(tenantId, phone, async (db) => {
    const stage = await db.pipelineStage.findFirst({
      where: {
        id: stageId, tenantId, archivedAt: null,
        pipeline: { key: DEFAULT_PIPELINE_KEY, tenant: activeCrm },
      },
      select: { id: true, name: true, kind: true },
    });
    // Perdido exige motivo e justificativa; não é um destino de cadastro.
    if (!stage || stage.kind === "lost") return { status: "stage_unavailable" } as const;

    const existing = await db.lead.findFirst({ where: { tenantId, phone }, select: { id: true } });
    if (existing) return { status: "exists", leadId: existing.id } as const;

    const lead = await db.lead.create({
      data: {
        tenantId, phone, name: name || null, originChannel: "manual", stageId: stage.id,
        transitions: { create: {
          dimension: "stage", source: "user", toStageId: stage.id, userId, reason: "lead_created_manual",
        } },
      },
      select: { id: true },
    });
    return { status: "created", leadId: lead.id, stageName: stage.name, name, phone } as const;
  });
}

const deletableSnapshot = {
  id: true, tenantId: true, name: true, phone: true, status: true, stageId: true,
  originChannel: true, isTest: true, createdAt: true, updatedAt: true,
} satisfies Prisma.LeadSelect;

export type DeleteManualLeadResult =
  | { status: "deleted"; label: string; snapshot: Prisma.LeadGetPayload<{ select: typeof deletableSnapshot }> }
  | { status: "not_found" }
  | { status: "has_history" };

/**
 * Exclui um lead do quadro somente quando ele não tem histórico: nenhuma
 * mensagem na conversa e nenhum agendamento. Assim o botão serve para tirar um
 * cadastro feito à mão (ou um teste), mas nunca apaga um atendimento real —
 * conversa, mensagens, agendamentos e linha do tempo vão embora junto.
 *
 * A checagem e a exclusão dividem a transação com a trava de admissão
 * compartilhada, a mesma das criações e movimentos.
 */
export async function deleteManualCrmLead(input: { tenantId: string; leadId: string }): Promise<DeleteManualLeadResult> {
  const { tenantId, leadId } = input;
  return prisma.$transaction(async (db) => {
    await lockCrmAdmission(db, tenantId, "shared");
    const lead = await db.lead.findFirst({
      where: { ...realBoardLeads(tenantId), id: leadId },
      select: {
        ...deletableSnapshot,
        conversation: { select: { _count: { select: { messages: true } } } },
        _count: { select: { appointments: true } },
      },
    });
    if (!lead) return { status: "not_found" } as const;
    if ((lead.conversation?._count.messages ?? 0) > 0 || lead._count.appointments > 0) {
      return { status: "has_history" } as const;
    }

    const snapshot = {
      id: lead.id, tenantId: lead.tenantId, name: lead.name, phone: lead.phone, status: lead.status,
      stageId: lead.stageId, originChannel: lead.originChannel, isTest: lead.isTest,
      createdAt: lead.createdAt, updatedAt: lead.updatedAt,
    };
    await db.lead.delete({ where: { id: lead.id, tenantId } });
    return {
      status: "deleted",
      label: lead.name?.trim() || lead.phone,
      snapshot,
    } as const;
  });
}
