import { blockReminder, claimReminder, finishReminder, reminderAlreadyHandled, reminderSource, markReminderManual } from "../../src/modules/scheduling/reminder-dispatch";
import { recordMessageContext } from "../../src/modules/reports/contact-context-events";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { getWhatsAppProviderForInstance } from "../../src/modules/whatsapp/meta-config";
import { findWhatsappChannel } from "../../src/modules/whatsapp/instances";
import {
  parseScheduleConfig,
  isReminderTypeAllowed,
  renderReminder,
  type ReminderRule,
  type ScheduleConfig,
} from "../../src/modules/scheduling/config";
import { parseReminderOverride } from "../../src/modules/scheduling/reminder-override";
import { parseConversationVariables } from "../../src/modules/agent-engine/variables";
import { isPhoneBlocked } from "../../src/modules/whatsapp/blocklist";
import { dateInZone, dayKeyInZone, partsInZone, timeInZone, zonedTimeToUtc } from "../../src/modules/scheduling/time";

/**
 * Lembretes pré-consulta. Rodam no mesmo worker do follow-up (mesma varredura
 * periódica), mas é outra regra: o follow-up reage ao silêncio do lead, estes
 * reagem ao relógio da agenda.
 *
 * Uma consulta pode ter vários lembretes ("1 semana antes", "1 dia antes",
 * "2 horas antes"), e cada disparo é marcado sozinho em
 * `Appointment.remindersSent` — um booleano só calaria todos depois do
 * primeiro.
 */

type ReminderCandidate = {
  status: string;
  startsAt: Date;
  remindersSent: number[];
};

/** Instante de disparo no fuso da agenda; sem horário fixo, duração exata. */
export function reminderDueAt(startsAt: Date, rule: ReminderRule, timezone: string): Date {
  if (!rule.sendTime) return new Date(startsAt.getTime() - rule.minutesBefore * 60_000);
  const local = partsInZone(startsAt, timezone);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day - rule.minutesBefore / 1440));
  const [hour, minute] = rule.sendTime.split(":").map(Number);
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, timezone);
}

/** Lembretes de dias/semanas só valem no dia local previsto, inclusive no envio manual. */
export function isReminderSendDay(startsAt: Date, rule: ReminderRule, now: Date, timezone: string): boolean {
  return rule.minutesBefore < 1440 ||
    dayKeyInZone(now, timezone) === dayKeyInZone(reminderDueAt(startsAt, rule, timezone), timezone);
}

function reminderExpiresAt(startsAt: Date, rule: ReminderRule, timezone: string): Date {
  if (rule.minutesBefore < 1440) return startsAt;
  const day = partsInZone(reminderDueAt(startsAt, rule, timezone), timezone);
  return zonedTimeToUtc(day.year, day.month, day.day + 1, 0, 0, timezone);
}

/**
 * Quais disparos estão vencidos agora, do mais distante para o mais próximo.
 *
 * A janela começa em `reminderDueAt` (antecedência exata ou horário local fixo)
 * e termina no fim do dia local previsto para lembretes de dias/semanas,
 * ou em `startsAt` para os de minutos/horas. Não recuperamos a confirmação
 * da véspera no dia da consulta, mesmo que ela ainda não tenha começado.
 * Quem ficou para trás é fechado sem enviar (ver `scanAndSendReminders`), senão
 * a mesma consulta seria reavaliada em todo ciclo para sempre.
 */
export function dueReminders(
  appt: ReminderCandidate,
  reminders: ReminderRule[],
  now: Date,
  timezone = "America/Sao_Paulo",
): ReminderRule[] {
  if (appt.status !== "scheduled") return [];
  if (appt.startsAt.getTime() <= now.getTime()) return [];
  const sent = new Set(appt.remindersSent);
  return reminders
    .filter((r) => !sent.has(r.minutesBefore))
    .filter((r) => now.getTime() >= reminderDueAt(appt.startsAt, r, timezone).getTime())
    .filter((r) => now.getTime() < reminderExpiresAt(appt.startsAt, r, timezone).getTime())
    .sort((a, b) => b.minutesBefore - a.minutesBefore);
}

/**
 * Disparos que perderam a janela: a consulta já passou, ou o horário deles
 * ficou para trás enquanto o worker estava fora. São fechados sem enviar.
 *
 * Por que fechar em vez de ignorar: `remindersSent` é o que impede reavaliar
 * a mesma consulta para sempre. E por que não enviar: "sua consulta é amanhã"
 * chegando depois da consulta é pior do que lembrete nenhum.
 */
export function staleReminders(
  appt: ReminderCandidate,
  reminders: ReminderRule[],
  now: Date,
  timezone = "America/Sao_Paulo",
): ReminderRule[] {
  const sent = new Set(appt.remindersSent);
  const pending = reminders.filter((r) => !sent.has(r.minutesBefore));
  if (appt.status !== "scheduled" || appt.startsAt.getTime() <= now.getTime()) return pending;
  return pending.filter((r) => now.getTime() >= reminderExpiresAt(appt.startsAt, r, timezone).getTime());
}

/**
 * A configuração GERAL de lembretes de cada conta: a do agente principal (o
 * que atende o WhatsApp), com `schedule_meeting` ligada.
 *
 * É a conta, e não o `agentId` gravado na consulta, que decide — a mesma regra
 * de `/agenda`, que mostra os lembretes do principal como "Do agente". Ler pelo
 * `agentId` fazia a tela prometer uma coisa e o worker fazer outra: consulta
 * marcada antes de trocar o agente do WhatsApp (ou por um agente apagado, que
 * deixa `agentId` null) seguia uma config sem lembrete, e só disparava depois
 * que alguém salvava lembretes próprios nela.
 */
export async function loadAccountScheduleConfigs(): Promise<Map<string, ScheduleConfig>> {
  // A configuração dos lembretes mora na ação `schedule_meeting` (não numa
  // ação própria), e só age com a ação LIGADA — mesma regra de
  // `getActiveHandoffConfig`: config salva com a ação desligada não atua.
  const enabled = await prisma.tenantAction.findMany({
    where: { key: "schedule_meeting", enabled: true, tenant: { status: "active" } },
    select: { tenantId: true, agentId: true, config: true },
  });
  if (enabled.length === 0) return new Map();

  // Mesma ordem de `resolveAgent`: é o agente que atende o WhatsApp.
  const agents = await prisma.agent.findMany({
    where: { tenantId: { in: [...new Set(enabled.map((a) => a.tenantId))] }, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, tenantId: true },
  });
  const primaryByTenant = new Map<string, string>();
  for (const agent of agents) {
    if (!primaryByTenant.has(agent.tenantId)) primaryByTenant.set(agent.tenantId, agent.id);
  }

  return new Map(
    enabled
      .filter((a) => primaryByTenant.get(a.tenantId) === a.agentId)
      .map((a) => [a.tenantId, parseScheduleConfig(a.config)]),
  );
}

/** Os lembretes que valem para esta consulta: os dela, ou os gerais da conta. */
export function remindersFor(
  appt: { reminderOverride: unknown },
  cfg: Pick<ScheduleConfig, "reminderEnabled" | "reminders">,
): ReminderRule[] {
  const override = parseReminderOverride(appt.reminderOverride);
  // Lista vazia no override é uma escolha ("esta consulta não recebe
  // lembrete"), diferente de não ter override. Por isso `!== null`, e não
  // um `||` que trataria vazio como ausente.
  if (override !== null) return override;
  return cfg.reminderEnabled ? cfg.reminders : [];
}

export async function scanAndSendReminders(now: Date = new Date(), target?: { tenantId: string; id: string; operation: "send" | "manual"; userId: string }) {
  const loaded = await loadAccountScheduleConfigs();
  const configByTenant = target ? new Map([...loaded].filter(([id]) => id === target.tenantId)) : loaded;
  if (configByTenant.size === 0) return { scanned: 0, sent: 0 };

  // Teto da busca: a maior antecedência configurada. Sem ele, a varredura
  // carregaria a agenda inteira do ano para descartar quase tudo em memória.
  // Uma consulta pode ter override próprio mais distante que o do agente, por
  // isso o teto considera os dois.
  const configuredRules = [...configByTenant.values()]
    .filter((cfg) => cfg.reminderEnabled)
    .flatMap((cfg) => cfg.reminders);
  // Um horário fixo na véspera pode cair quase um dia antes do instante
  // "24 horas antes"; inclua essa margem na busca sem carregar o ano inteiro.
  const maxLeadMinutes = Math.max(0, ...configuredRules.map((r) =>
    r.minutesBefore + (r.sendTime ? 1440 : 0),
  ));

  const appointments = await prisma.appointment.findMany({
    where: {
      // Pela conta, não pelo `agentId`: ver `loadAccountScheduleConfigs`.
      tenantId: { in: [...configByTenant.keys()] },
      ...(target ? { id: target.id } : {}),
      status: "scheduled",
      // Não envie uma confirmação por WhatsApp enquanto a criação externa
      // ainda estiver sendo concluída ou tiver sido recusada.
      AND: [{ OR: [{ clinicorpSync: null }, { clinicorpSync: { state: "synced" }, clinicorpAppointmentId: { not: null } }] }],
      startsAt: { gte: now },
      // Conversa de teste não recebe lembrete: o sandbox usa telefone
      // sintético, mesma regra do follow-up e do grupo de handoff.
      lead: { isTest: false },
      ...(target ? {} : { OR: [
        { startsAt: { lte: new Date(now.getTime() + maxLeadMinutes * 60_000) } },
        // Consulta com lembretes próprios: a antecedência dela pode ser maior
        // que qualquer uma do agente, então não cabe no teto acima.
        { reminderOverride: { not: Prisma.DbNull } },
      ] }),
    },
    include: {
      // A consulta marcada à mão não guarda `conversationId`: o canal do
      // paciente também vem da conversa do lead.
      lead: { include: { conversation: { select: { whatsappProvider: true } } } },
      conversation: { select: { variables: true, whatsappProvider: true } },
    },
  });

  // Consultas que já passaram e ainda tinham disparo pendente: fechar sem
  // enviar nada. É o caso do worker que ficou fora do ar — a janela passou
  // junto com a consulta, e avisar agora seria pior do que não avisar.
  // Fechar (em vez de ignorar) é o que impede reavaliá-las em todo ciclo.
  const overdue = await prisma.appointment.findMany({
    where: {
      ...(target ? { id: target.id } : {}),
      tenantId: { in: [...configByTenant.keys()] },
      status: "scheduled",
      startsAt: { lt: now },
    },
    select: { id: true, tenantId: true, remindersSent: true, reminderOverride: true, startsAt: true, status: true },
  });
  for (const appt of overdue) {
    const cfg = configByTenant.get(appt.tenantId);
    if (!cfg) continue;
    const pending = staleReminders(appt, remindersFor(appt, cfg), now, cfg.timezone);
    if (pending.length === 0) continue;
    await markSent(appt.id, appt.remindersSent, pending.map((r) => r.minutesBefore), null);
  }

  let sent = 0;

  for (const appt of appointments) {
    const cfg = configByTenant.get(appt.tenantId);
    if (!cfg) continue;

    // O público da conta vale também para lembretes próprios da consulta.
    if (!isReminderTypeAllowed(cfg, appt.serviceType)) continue;

    const rules = remindersFor(appt, cfg);
    if (rules.length === 0) continue;

    const expired = staleReminders(appt, rules, now, cfg.timezone).map((r) => r.minutesBefore);
    const dueNow = dueReminders(target ? { ...appt, remindersSent: [] } : appt, rules, now, cfg.timezone);
    const available = target?.operation === "send"
      ? rules.filter((r) => isReminderSendDay(appt.startsAt, r, now, cfg.timezone)) : rules;
    const due = target && !dueNow.length ? available : dueNow;
    if (due.length === 0) {
      if (expired.length) await markSent(appt.id, appt.remindersSent, expired, null);
      if (target?.operation === "send") return { scanned: appointments.length, sent, reason: "outside_window" as const };
      continue;
    }

    // Vários disparos vencidos de uma vez (worker parado, ou dois lembretes
    // muito próximos): manda só o MAIS PRÓXIMO da consulta e fecha os outros.
    // Três mensagens seguidas dizendo "é daqui a uma semana / é amanhã / é em
    // duas horas" chegariam juntas, todas desatualizadas menos a última.
    const [toSend] = [...due].sort((a, b) => target && !dueNow.length ? b.minutesBefore - a.minutesBefore : a.minutesBefore - b.minutesBefore);
    if (target && appt.remindersSent.includes(toSend.minutesBefore)) continue;
    const closing = [...new Set([
      ...expired,
      ...(target && !dueNow.length ? [toSend.minutesBefore] : due.map((r) => r.minutesBefore)),
    ])];
    const dispatchKey = { tenantId: appt.tenantId, sourceKey: reminderSource(appt.id, appt.clinicorpAppointmentId), startsAt: appt.startsAt, minutesBefore: toSend.minutesBefore };
    const handled = await reminderAlreadyHandled(dispatchKey);
    if (handled) { await markSent(appt.id, appt.remindersSent, closing, handled.acceptedAt); continue; }
    if (target?.operation === "manual") {
      if (await markReminderManual(dispatchKey, target.userId)) await markSent(appt.id, appt.remindersSent, closing, null);
      continue;
    }



    if (!appt.lead?.phone) {
      await markSent(appt.id, appt.remindersSent, closing, null);
      continue;
    }

    // Uma consulta anterior ao bloqueio ainda aparece nesta varredura.
    // Fecha os disparos sem envio para não surgir lembrete atrasado depois de
    // desbloquear, preservando reminderSentAt como registro de envio real.
    if (await isPhoneBlocked(appt.tenantId, appt.lead.phone)) {
      await markSent(appt.id, appt.remindersSent, closing, null);
      continue;
    }

    const text = renderReminder(toSend.template, {
      // Contato sem nome cadastrado existe (o WhatsApp nem sempre entrega um):
      // `renderReminder` limpa o espaço e a pontuação que sobram.
      nome: appt.lead.name?.trim() ?? "",
      data: dateInZone(appt.startsAt, cfg.timezone),
      hora: timeInZone(appt.startsAt, cfg.timezone),
      local: cfg.location,
      extras: parseConversationVariables(appt.conversation?.variables),
    });
    if (!text) {
      await markSent(appt.id, appt.remindersSent, closing, null);
      continue;
    }

    if (!appt.lead?.phone) { await blockReminder(dispatchKey, "Cadastre um telefone válido para o contato."); continue; }
    const claim = await claimReminder(dispatchKey);
    if (!claim) continue;
    const currentConfig = (await loadAccountScheduleConfigs()).get(appt.tenantId);
    const currentAppointment = await prisma.appointment.findFirst({
      where: { id: appt.id, tenantId: appt.tenantId, status: "scheduled", startsAt: appt.startsAt,
        lead: { isTest: false }, AND: [{ OR: [{ clinicorpSync: null }, { clinicorpSync: { state: "synced" }, clinicorpAppointmentId: { not: null } }] }] },
      include: { lead: true },
    });
    if (!currentConfig || JSON.stringify(currentConfig) !== JSON.stringify(cfg) || !currentAppointment ||
        currentAppointment.lead?.phone !== appt.lead.phone || currentAppointment.clinicorpAppointmentId !== appt.clinicorpAppointmentId ||
        JSON.stringify(currentAppointment.reminderOverride) !== JSON.stringify(appt.reminderOverride) ||
        currentAppointment.serviceType !== appt.serviceType || await isPhoneBlocked(appt.tenantId, appt.lead.phone)) {
      await finishReminder(claim, "blocked", { reason: "A configuração ou a consulta mudou. Confira os dados antes do envio." });
      continue;
    }
    let keyId: string | null = null;
    let delivered = false;
    let sentProvider: string | undefined;
    {
      // Pelo número em que o paciente escreveu: com as duas conexões, a dele
      // fora do ar espera (o disparo não é consumido), não troca de número.
      const instance = await findWhatsappChannel(
        appt.tenantId,
        appt.conversation?.whatsappProvider ?? appt.lead?.conversation?.whatsappProvider,
      );
      if (instance?.externalId) {
        try {
          const provider = getWhatsAppProviderForInstance(instance);
          if (provider.isConfigured()) {
            keyId = await provider.sendMessage(instance.externalId, appt.lead.phone, text);
            delivered = true;
            sentProvider = instance.provider;
          }
        } catch (err) {
          console.error("[lembrete] envio não confirmado", appt.id, err);
          await finishReminder(claim, "unknown", { provider: instance.provider, reason: "O WhatsApp não confirmou o envio. Confira antes de tentar novamente." });
        }
      }
    }

    // Uma falha temporária de conexão não pode consumir o lembrete. Enquanto
    // a consulta ainda não começou, a próxima varredura tenta novamente.
    if (!delivered) {
      await finishReminder(claim, "blocked", { reason: "O canal do paciente está desconectado ou não foi configurado." });
      continue;
    }
    if (!keyId) { await finishReminder(claim, "unknown", { provider: sentProvider, reason: "O WhatsApp respondeu sem identificar a mensagem. Confira o envio." }); continue; }
    await finishReminder(claim, "sent", { provider: sentProvider, messageId: keyId, conversationId: appt.conversationId ?? undefined, acceptedAt: now });

    // A mensagem entra na conversa como fala do agente. É isso que faz a
    // resposta do paciente ("não vou poder") cair no `runAgentTurn` normal,
    // com o contexto da consulta vindo de `recognizeExisting` — cancelar e
    // reagendar já existem, o lembrete só precisa abrir a porta.
    if (appt.conversationId) {
      const savedMessage = await prisma.message.create({
        data: {
          conversationId: appt.conversationId,
          role: "assistant",
          content: text,
          whatsappMessageId: keyId ?? undefined,
        },
      });
      await recordMessageContext(appt.tenantId, savedMessage?.id, "contact_reminder");
    }
    await markSent(appt.id, appt.remindersSent, closing, now);
    sent++;
  }

  return { scanned: appointments.length, sent };
}

/**
 * Fecha os disparos indicados, preservando os que já estavam marcados.
 *
 * `sentAt` só é gravado quando uma mensagem de fato saiu: a tela mostra
 * "lembrete enviado há X" a partir dele, e um disparo fechado sem envio
 * (consulta já passada, contato sem telefone) faria essa frase mentir.
 */
async function markSent(
  id: string,
  already: number[],
  closing: number[],
  sentAt: Date | null,
) {
  await prisma.appointment.update({
    where: { id },
    data: {
      remindersSent: { set: [...new Set([...already, ...closing])] },
      ...(sentAt ? { reminderSentAt: sentAt } : {}),
    },
  });
}
