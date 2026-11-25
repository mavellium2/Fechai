import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { eventDef, type AuditEvent } from "@/modules/audit/events";

/**
 * Trilha do CRM e do transbordo (CRM-11): quem fez, por onde, quando e quanto
 * tempo levou, na mesma `AuditLog` da auditoria, sempre com o **lead** como alvo
 * (`targetType: "Lead"`). É o que a linha do tempo do card e os indicadores
 * por pessoa leem.
 *
 * Escreve direto, sem a sessão (`modules/audit/log.ts` puxa o next-auth): os
 * eventos nascem também no webhook e no worker. O ator vem sempre explícito.
 * **Nunca lança**, e o meta só aceita ids, vias, tempos e rótulos: nada de
 * texto de mensagem nem telefone completo (`maskPhone`).
 */

export type CrmTrailEvent = Extract<AuditEvent, `crm.${string}` | `handoff.${string}`>;

export type TrailActor =
  /** Pessoa da equipe pelo painel. */
  | { kind: "user"; userId: string }
  /** O próprio Fechai: o agente, o worker, a devolução automática. */
  | { kind: "system" }
  /** Alguém no grupo de transbordo (CRM-08): a pessoa, ou o número mascarado. */
  | { kind: "group"; userId: string | null; phone?: string | null }
  /** Resposta pelo celular da clínica (CRM-09): o responsável, ou não identificado. */
  | { kind: "phone"; userId: string | null };

type MetaValue = string | number | boolean | null;

/** Só o final do número: o registro nunca guarda o telefone inteiro. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
}

/** Segundos entre dois instantes (nunca negativo), para os tempos do meta. */
export function secondsBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((+to - +from) / 1000));
}

const ROLE: Record<TrailActor["kind"], string> = { user: "OWNER", system: "SYSTEM", group: "GROUP", phone: "PHONE" };

export async function recordCrmTrail(input: {
  tenantId: string;
  event: CrmTrailEvent;
  actor: TrailActor;
  leadId: string | null;
  meta: Record<string, MetaValue>;
  at?: Date;
}): Promise<void> {
  try {
    const def = eventDef(input.event);
    if (!def) return;
    const { actor } = input;
    const userId = actor.kind === "system" ? null : actor.userId;
    const [user, tenant] = await Promise.all([
      userId ? prisma.user.findFirst({ where: { id: userId, tenantId: input.tenantId }, select: { id: true, email: true, role: true } }) : null,
      prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true } }),
    ]);
    const meta: Record<string, MetaValue> = { ...input.meta };
    if (actor.kind === "group" && !user) meta.actorPhone = maskPhone(actor.phone);
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        tenantName: tenant?.name ?? null,
        actorId: user?.id ?? null,
        actorEmail: user?.email ?? null,
        actorRole: actor.kind === "user" ? user?.role ?? ROLE.user : ROLE[actor.kind],
        event: input.event,
        kind: def.kind,
        targetType: "Lead",
        targetId: input.leadId,
        meta: meta as Prisma.InputJsonObject,
        ...(input.at ? { createdAt: input.at } : {}),
      },
    });
  } catch (error) {
    console.error("[crm] evento da trilha não gravado", input.event, error);
  }
}

/** O lead da conversa, para os pontos que só conhecem a conversa. */
export async function leadOfConversation(tenantId: string, conversationId: string): Promise<string | null> {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { leadId: true } }).catch(() => null);
  return conversation?.leadId ?? null;
}
