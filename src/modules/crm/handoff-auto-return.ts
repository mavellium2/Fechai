import { prisma } from "@/lib/prisma";
import { loadBusinessCalendar, slaMinutes, type HandoffSla } from "./handoff-sla";
import { reflectHandoffInGroup, replyPendingAfterReturn, returnConversationToAi } from "./handoff-panel";

/**
 * Devolução automática para a IA (CRM-12).
 *
 * Desligada por padrão (`HandoffSlaSettings.autoReturnHours` null). Ligada, o
 * worker devolve a conversa para a IA quando a equipe passou N horas sem
 * responder:
 *
 * - **esperando** (`waiting`): nenhuma resposta humana desde o transbordo;
 * - **em atendimento humano** (`assumed`, só com a opção ligada): a mensagem
 *   do contato mais antiga ainda sem resposta humana.
 *
 * Uma resposta humana antes do prazo cancela (o relógio passa a contar da
 * próxima mensagem do contato). Card em Fechado ou Perdido nunca volta.
 * Devolve uma vez: a espera vira `returned` (`returnedVia: auto`), a IA
 * responde a mensagem pendente pedindo desculpas pela demora
 * (`autoReturnTurnInstruction`) e o grupo recebe o aviso citando o aviso.
 * Só contas com o CRM ligado; conversa de teste nunca. **Nunca lança.**
 */

export const AUTO_RETURN_SUGGESTED_HOURS = 4;
export const AUTO_RETURN_MAX_HOURS = 7 * 24;

export type AutoReturn = { hours: number | null; businessHoursOnly: boolean; humanStage: boolean };

/** Lê a configuração sem lançar: horas fora da faixa desligam. */
export function parseAutoReturn(row: { autoReturnHours?: number | null; autoReturnBusinessHoursOnly?: boolean; autoReturnHumanStage?: boolean } | null | undefined): AutoReturn {
  const hours = row?.autoReturnHours;
  return {
    hours: typeof hours === "number" && Number.isInteger(hours) && hours >= 1 && hours <= AUTO_RETURN_MAX_HOURS ? hours : null,
    businessHoursOnly: row?.autoReturnBusinessHoursOnly === true,
    humanStage: row?.autoReturnHumanStage === true,
  };
}

export const autoReturnGroupText = (hours: number) => `↩️ Sem resposta em ${hours} h — a IA voltou a atender`;

type Candidate = { id: string; conversationId: string; status: "waiting" | "assumed"; createdAt: Date; assumedAt: Date | null };

/**
 * Desde quando o contato espera uma pessoa, ou `null` se não há o que devolver
 * (alguém respondeu, ou não há mensagem do contato sem resposta).
 */
async function waitingSince(tenantId: string, notice: Candidate): Promise<Date | null> {
  const lastHuman = await prisma.message.findFirst({
    where: { conversationId: notice.conversationId, conversation: { tenantId }, role: "assistant", sentBy: "human" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  if (notice.status === "waiting") {
    return lastHuman && lastHuman.createdAt > notice.createdAt ? null : notice.createdAt;
  }
  const base = [lastHuman?.createdAt, notice.assumedAt ?? notice.createdAt]
    .filter((date): date is Date => Boolean(date))
    .reduce((latest, date) => (date > latest ? date : latest));
  const unanswered = await prisma.message.findFirst({
    where: { conversationId: notice.conversationId, conversation: { tenantId }, role: "user", createdAt: { gt: base } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { createdAt: true },
  });
  return unanswered?.createdAt ?? null;
}

export type AutoReturnScan = { returned: number };

/** Uma volta do worker (na mesma fila do prazo do transbordo). */
export async function scanAutoReturn(now = new Date()): Promise<AutoReturnScan> {
  const result: AutoReturnScan = { returned: 0 };
  let accounts;
  try {
    accounts = await prisma.handoffSlaSettings.findMany({
      where: { autoReturnHours: { not: null }, tenant: { crmEnabled: true, status: "active" } },
      select: { tenantId: true, autoReturnHours: true, autoReturnBusinessHoursOnly: true, autoReturnHumanStage: true },
    });
  } catch (error) {
    console.error("[crm] devolução automática: varredura falhou", error);
    return result;
  }

  for (const account of accounts) {
    const { tenantId } = account;
    try {
      const config = parseAutoReturn(account);
      if (!config.hours) continue;
      const calendar = config.businessHoursOnly ? await loadBusinessCalendar(tenantId) : null;
      // `slaMinutes` decide entre só o expediente e o tempo corrido.
      const clock = { businessHoursOnly: config.businessHoursOnly } as HandoffSla;
      const notices = await prisma.handoffNotice.findMany({
        where: {
          tenantId,
          status: { in: config.humanStage ? ["waiting", "assumed"] : ["waiting"] },
          createdAt: { gte: new Date(+now - 30 * 86_400_000) },
          conversation: { isTest: false },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 500,
        select: { id: true, conversationId: true, status: true, createdAt: true, assumedAt: true },
      });
      const seen = new Set<string>();
      for (const notice of notices) {
        if (seen.has(notice.conversationId)) continue;
        seen.add(notice.conversationId);
        // Só a espera mais recente da conversa conta (uma antiga já foi encerrada).
        const latest = await prisma.handoffNotice.findFirst({
          where: { tenantId, conversationId: notice.conversationId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (latest?.id !== notice.id) continue;
        const conversation = await prisma.conversation.findFirst({
          where: { id: notice.conversationId, tenantId, isTest: false },
          select: { lead: { select: { stage: { select: { kind: true } } } } },
        });
        // Fechado ou Perdido é decisão da equipe: a IA não volta.
        const kind = conversation?.lead.stage?.kind;
        if (!conversation || kind === "won" || kind === "lost") continue;

        const since = await waitingSince(tenantId, notice as Candidate);
        if (!since || slaMinutes(since, now, clock, calendar) < config.hours * 60) continue;

        const returned = await returnConversationToAi({ tenantId, conversationId: notice.conversationId, actorUserId: null, via: "auto" });
        if (returned.status !== "returned") continue;
        result.returned++;
        // O aviso sai antes da resposta da IA: se ela falhar, uma espera nova
        // abre, e o grupo precisa ouvir sobre a que foi devolvida.
        await reflectHandoffInGroup(tenantId, notice.conversationId, autoReturnGroupText(config.hours));
        await replyPendingAfterReturn(tenantId, notice.conversationId, returned.agentId);
      }
    } catch (error) {
      console.error("[crm] devolução automática: conta não processada", tenantId, error);
    }
  }
  return result;
}
