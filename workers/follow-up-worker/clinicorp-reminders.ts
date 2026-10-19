import { blockReminder, claimReminder, finishReminder, markReminderManual, reminderAlreadyHandled, type ReminderKey } from "../../src/modules/scheduling/reminder-dispatch";
import { recordMessageContext } from "../../src/modules/reports/contact-context-events";
import { prisma } from "../../src/lib/prisma";
import {
  CLINICORP_UNNAMED_PATIENT,
  listClinicorpAgenda,
  listClinicorpCategories,
  type ClinicorpAgendaItem,
} from "../../src/modules/scheduling/clinicorp";
import { isReminderTypeAllowed, renderReminder, type ScheduleConfig } from "../../src/modules/scheduling/config";
import { metaReminderParameters } from "../../src/modules/scheduling/meta-reminder";
import { dateInZone, dayKeyInZone, timeInZone } from "../../src/modules/scheduling/time";
import { getBroadcastConnection } from "../../src/modules/broadcasts/connection";
import { broadcastPhoneVariants, normalizeBroadcastPhone } from "../../src/modules/broadcasts/phone";
import { renderBroadcast } from "../../src/modules/broadcasts/template";
import { getOrCreateConversation } from "../../src/modules/agent-engine/conversation";
import { parseConversationVariables } from "../../src/modules/agent-engine/variables";
import { isPhoneBlocked } from "../../src/modules/whatsapp/blocklist";
import { getWhatsAppProviderForInstance } from "../../src/modules/whatsapp/meta-config";
import {
  listWhatsappChannels,
  pickWhatsappChannel,
  setConversationChannel,
} from "../../src/modules/whatsapp/instances";
import { dueReminders, isReminderSendDay, loadAccountScheduleConfigs, staleReminders } from "./reminders";

/**
 * Confirmações das consultas diretas do Clinicorp. Mesmo calendário de regras
 * da agenda local; consultas espelhadas usam a fila local e a mesma chave.
 * QR sem histórico só com opt-in da conta e categoria explicitamente autorizada.
 * Canal conhecido do paciente nunca muda. Claim precede POST; resultado incerto
 * aguarda conferência e não autoriza uma segunda tentativa automática.
 */

/** Guardar o que saiu por mais tempo que isso só enche a tabela. */
const KEEP_SENT_DAYS = 90;

/**
 * O telefone do Clinicorp no formato do WhatsApp, ou null.
 *
 * O Clinicorp é brasileiro e guarda o número como a recepção digitou:
 * "14991406457", "+55 14 98187-2315", "(14) 9…". Dez ou onze dígitos são DDD +
 * número, e ganham o 55 — é a única suposição, e só vale porque o sistema é de
 * clínicas no Brasil. O resto passa pela mesma validação dos Disparos.
 */
export function clinicorpWhatsappPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return normalizeBroadcastPhone(digits.length === 10 || digits.length === 11 ? `55${digits}` : digits);
}

type MetaChannel = {
  kind: "meta";
  connection: NonNullable<Awaited<ReturnType<typeof getBroadcastConnection>>>;
  template: NonNullable<ScheduleConfig["metaReminderTemplate"]>;
};
type EvolutionChannel = {
  kind: "evolution";
  externalId: string;
  provider: ReturnType<typeof getWhatsAppProviderForInstance>;
};
type Channel = MetaChannel | EvolutionChannel;
/** As conexões por onde a conta pode lembrar agora; cada uma existe só se estiver pronta. */
type Channels = { evolution?: EvolutionChannel; meta?: MetaChannel };

/**
 * Por onde esta conta pode lembrar, ou null se não pode (desconectada, Meta sem
 * template). Com as duas conexões de pé, as duas entram e a escolha é por
 * paciente (`chooseChannel`).
 */
async function channelsFor(tenantId: string, cfg: ScheduleConfig): Promise<Channels | null> {
  const instances = await listWhatsappChannels(tenantId);
  const channels: Channels = {};

  const evolution = pickWhatsappChannel(instances, "evolution");
  if (evolution?.externalId) {
    const provider = getWhatsAppProviderForInstance(evolution);
    if (provider.isConfigured()) {
      channels.evolution = { kind: "evolution", externalId: evolution.externalId, provider };
    }
  }

  if (cfg.metaReminderTemplate && pickWhatsappChannel(instances, "meta")) {
    const connection = await getBroadcastConnection(tenantId);
    if (connection) channels.meta = { kind: "meta", connection, template: cfg.metaReminderTemplate };
  }

  return channels;
}

/** Preserva o canal do contato; primeiro QR exige a opção específica da conta. */
export function chooseClinicorpReminderChannel(
  channels: Channels,
  conversation: { lastInboundAt: Date | null; whatsappProvider: string | null } | null | undefined,
  allowQr = false,
): Channel | null {
  if (conversation?.whatsappProvider === "meta") return channels.meta ?? null;
  if (conversation?.whatsappProvider === "evolution") {
    return conversation.lastInboundAt || allowQr ? channels.evolution ?? null : null;
  }
  if (channels.evolution && (conversation?.lastInboundAt || allowQr)) return channels.evolution;
  return channels.meta ?? null;
}

export async function scanAndSendClinicorpReminders(now: Date = new Date()) {
  const result = { tenants: 0, scanned: 0, sent: 0, firstContactSkipped: 0, typeSkipped: 0, unknownTypeSkipped: 0 };
  const configs = await loadAccountScheduleConfigs();

  await prisma.reminderReceipt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_SENT_DAYS * 24 * 60 * 60_000) } } });
  await prisma.clinicorpReminder.deleteMany({
    where: { startsAt: { lt: new Date(now.getTime() - KEEP_SENT_DAYS * 24 * 60 * 60_000) } },
  });

  for (const [tenantId, cfg] of configs) {
    if (!cfg.reminderEnabled || cfg.reminders.length === 0) continue;
    try {
      const channels = await channelsFor(tenantId, cfg);
      if (!channels) continue;
      const counts = await remindTenant(tenantId, cfg, channels, now);
      result.tenants++;
      result.scanned += counts.scanned;
      result.sent += counts.sent;
      result.firstContactSkipped += counts.firstContactSkipped;
      result.typeSkipped += counts.typeSkipped;
      result.unknownTypeSkipped += counts.unknownTypeSkipped;
    } catch (err) {
      // Uma conta com problema não pode calar os lembretes das outras.
      console.error("[lembrete clinicorp] conta falhou", tenantId, err);
    }
  }
  return result;
}

async function remindTenant(tenantId: string, cfg: ScheduleConfig, channels: Channels, now: Date) {
  const counts = { scanned: 0, sent: 0, firstContactSkipped: 0, typeSkipped: 0, unknownTypeSkipped: 0 };
  const maxLead = Math.max(...cfg.reminders.map((r) => r.minutesBefore + (r.sendTime ? 1440 : 0)));
  const agenda = await listClinicorpAgenda(tenantId, dayKeyInZone(now, cfg.timezone),
    dayKeyInZone(new Date(now.getTime() + (maxLead + 1440) * 60_000), cfg.timezone), cfg.timezone, { fresh: true });
  if (agenda.status !== "ok") return counts;
  const upcoming = agenda.items.filter((item) => !item.canceled && item.startsAt > now);
  counts.scanned = upcoming.length;
  const mirrored = await prisma.appointment.findMany({ where: { tenantId, clinicorpAppointmentId: { in: upcoming.map((i) => i.id) } }, select: { clinicorpAppointmentId: true } });
  const ours = new Set(mirrored.map((a) => a.clinicorpAppointmentId));
  const categories = cfg.reminderAudience === "selected_types" && upcoming.some((i) => i.categoryId) ? await listClinicorpCategories(tenantId) : null;
  for (const item of upcoming) {
    if (ours.has(item.id)) continue;
    const category = item.categoryId ? categories?.ok ? categories.data.find((c) => c.id === item.categoryId)?.name : null : item.category;
    const result = await sendClinicorpConfirmation(tenantId, item, cfg, { now, channels, category });
    if (result.sent) counts.sent++;
    if (result.reason === "channel") counts.firstContactSkipped++;
    if (result.reason === "type") { counts.typeSkipped++; if (!category) counts.unknownTypeSkipped++; }
  }
  return counts;
}

/** Same path for the worker and the explicit per-appointment manual action. */
export async function sendClinicorpConfirmation(tenantId: string, item: ClinicorpAgendaItem, cfg: ScheduleConfig,
  options: { now?: Date; channels?: Channels; category?: string | null; operation?: "send" | "manual"; userId?: string } = {}) {
  const now = options.now ?? new Date();
  if (item.canceled || item.startsAt <= now || !cfg.reminderEnabled || !cfg.reminders.length) return { sent: false, reason: "inactive" };
  const legacy = await prisma.clinicorpReminder.findUnique({ where: { tenantId_clinicorpAppointmentId: { tenantId, clinicorpAppointmentId: item.id } } });
  const moved = Boolean(legacy && legacy.startsAt.getTime() !== item.startsAt.getTime());
  const already = legacy && !moved ? legacy.remindersSent : [];
  const expired = staleReminders({ status: "scheduled", startsAt: item.startsAt, remindersSent: already }, cfg.reminders, now, cfg.timezone)
    .map((r) => r.minutesBefore);
  const due = dueReminders({ status: "scheduled", startsAt: item.startsAt, remindersSent: options.operation ? [] : already }, cfg.reminders, now, cfg.timezone);
  // Envio explícito pode antecipar o horário, mas nunca mudar o dia do modelo.
  // Registrar algo já tratado pela equipe não envia mensagem e preserva esse registro.
  const available = options.operation === "send"
    ? cfg.reminders.filter((r) => isReminderSendDay(item.startsAt, r, now, cfg.timezone)) : cfg.reminders;
  const rules = options.operation ? due.length ? due : available : due;
  const toSend = [...rules].sort((a, b) => options.operation && !due.length ? b.minutesBefore - a.minutesBefore : a.minutesBefore - b.minutesBefore)[0];
  if (!toSend) {
    if (expired.length) await markSent(tenantId, item, already, expired, null, moved);
    return { sent: false, reason: options.operation === "send" ? "outside_window" : already.length ? "handled" : "waiting" };
  }
  if (already.includes(toSend.minutesBefore)) return { sent: false, reason: "handled" };
  const closing = [...new Set([
    ...expired,
    ...(due.length ? due.map((r) => r.minutesBefore) : [toSend.minutesBefore]),
  ])];
  const key: ReminderKey = { tenantId, sourceKey: `clinicorp:${item.id}`, startsAt: item.startsAt, minutesBefore: toSend.minutesBefore };
  const fetched = options.category === undefined && item.categoryId ? await listClinicorpCategories(tenantId) : null;
  const category = options.category !== undefined ? options.category : fetched ? fetched.ok ? fetched.data.find((c) => c.id === item.categoryId)?.name : null : item.category;
  if (!isReminderTypeAllowed(cfg, category) || (cfg.clinicorpQrEnabled && (!item.categoryId || !cfg.clinicorpReminderCategoryIds.includes(item.categoryId)))) {
    await blockReminder(key, "Esta consulta não tem uma categoria autorizada para confirmação.");
    return { sent: false, reason: "type" };
  }
  if (await reminderAlreadyHandled(key)) return { sent: false, reason: "handled" };
  const phone = clinicorpWhatsappPhone(item.phone);
  if (!phone || await isPhoneBlocked(tenantId, phone)) { await blockReminder(key, "Telefone inválido ou contato bloqueado."); return { sent: false, reason: "phone" }; }
  const known = await prisma.lead.findFirst({ where: { tenantId, phone: { in: broadcastPhoneVariants(phone) } },
    select: { phone: true, isTest: true, conversation: { select: { id: true, lastInboundAt: true, followUpReason: true, variables: true, whatsappProvider: true } } } });
  if (known?.isTest || known?.conversation?.followUpReason === "stop") {
    await blockReminder(key, "Conversa de teste ou contato que pediu para parar."); return { sent: false, reason: "stop" };
  }
  if (options.operation === "manual") {
    const recorded = await markReminderManual(key, options.userId ?? "");
    if (!recorded) return { sent: false, reason: "busy" };
    await markSent(tenantId, item, already, closing, null, moved);
    return { sent: false, reason: "manual" };
  }
  const channels = options.channels ?? await channelsFor(tenantId, cfg);
  const channel = channels && chooseClinicorpReminderChannel(channels, known?.conversation, cfg.clinicorpQrEnabled);
  if (!channel) { await blockReminder(key, "Conecte o canal do paciente ou habilite as confirmações do Clinicorp pelo QR."); return { sent: false, reason: "channel" }; }
  const name = item.patientName === CLINICORP_UNNAMED_PATIENT ? "" : item.patientName;
  const values = { nome: name, data: dateInZone(item.startsAt, cfg.timezone), hora: timeInZone(item.startsAt, cfg.timezone), local: cfg.location };
  const parameters = channel.kind === "meta" ? metaReminderParameters(channel.template, values) : null;
  const text = channel.kind === "meta" ? parameters ? renderBroadcast(channel.template, parameters) : "" : renderReminder(toSend.template, {
    ...values, extras: parseConversationVariables(known?.conversation?.variables) });
  if (!text) { await blockReminder(key, "Preencha os dados exigidos pela mensagem de confirmação."); return { sent: false, reason: "text" }; }
  const claim = await claimReminder(key);
  if (!claim) return { sent: false, reason: "busy" };
  // Check connection again after claim; never switch provider while an intent is owned.
  const current = await listWhatsappChannels(tenantId);
  if (!pickWhatsappChannel(current, channel.kind)) { await finishReminder(claim, "blocked", { reason: "O canal do paciente está desconectado." }); return { sent: false, reason: "channel" }; }
  const latestConfig = (await loadAccountScheduleConfigs()).get(tenantId);
  const day = dayKeyInZone(item.startsAt, cfg.timezone);
  const freshAgenda = await listClinicorpAgenda(tenantId, day, day, cfg.timezone, { fresh: true });
  const freshItem = freshAgenda.status === "ok" ? freshAgenda.items.find((a) => a.id === item.id) : null;
  if (!latestConfig || JSON.stringify(latestConfig) !== JSON.stringify(cfg) || !freshItem || freshItem.canceled ||
      freshItem.startsAt.getTime() !== item.startsAt.getTime() || freshItem.categoryId !== item.categoryId ||
      freshItem.category !== item.category || clinicorpWhatsappPhone(freshItem.phone) !== phone || await isPhoneBlocked(tenantId, phone)) {
    await finishReminder(claim, "blocked", { reason: "A configuração ou a consulta mudou. Confira os dados antes do envio." });
    return { sent: false, reason: "changed" };
  }
  let messageId: string | null;
  try {
    messageId = channel.kind === "evolution" ? await channel.provider.sendMessage(channel.externalId, known?.phone ?? phone, text)
      : await channel.connection.provider.sendBroadcastTemplate(phone, channel.template, parameters!);
  } catch {
    await finishReminder(claim, "unknown", { provider: channel.kind, reason: "O WhatsApp não confirmou o envio. Confira antes de tentar novamente." });
    return { sent: false, reason: "unknown" };
  }
  if (!messageId) {
    await finishReminder(claim, "unknown", { provider: channel.kind, reason: "O WhatsApp respondeu sem identificar a mensagem. Confira o envio." });
    return { sent: false, reason: "unknown" };
  }
  // Save acknowledgement before optional conversation/history writes.
  await finishReminder(claim, "sent", { provider: channel.kind, messageId, acceptedAt: now });
  try {
    const conversation = known?.conversation ?? (await getOrCreateConversation(tenantId, phone, name || undefined)).conversation;
    await setConversationChannel(conversation, channel.kind, { onlyIfUnset: true });
    const saved = await prisma.message.create({ data: { conversationId: conversation.id, role: "assistant", content: text, whatsappMessageId: messageId ?? undefined } });
    await prisma.reminderDispatch.updateMany({ where: { id: claim.id, tenantId }, data: { conversationId: conversation.id } });
    await recordMessageContext(tenantId, saved?.id, "contact_reminder");
  } catch { console.error("[reminder] Envio aceito, mas histórico ainda não foi registrado."); }
  await markSent(tenantId, item, already, closing, now, moved);
  return { sent: true, reason: "sent" };
}

/**
 * Fecha os disparos indicados. `reminderSentAt` só quando uma mensagem saiu
 * (a `/agenda` mostra "lembrete enviado" a partir dele); numa consulta
 * remarcada, o envio da data antiga deixa de valer e é limpo.
 */
async function markSent(
  tenantId: string,
  item: ClinicorpAgendaItem,
  already: number[],
  closing: number[],
  sentAt: Date | null,
  moved: boolean,
) {
  const remindersSent = [...new Set([...already, ...closing])];
  await prisma.clinicorpReminder.upsert({
    where: { tenantId_clinicorpAppointmentId: { tenantId, clinicorpAppointmentId: item.id } },
    create: { tenantId, clinicorpAppointmentId: item.id, startsAt: item.startsAt, remindersSent, reminderSentAt: sentAt },
    update: {
      startsAt: item.startsAt,
      remindersSent: { set: remindersSent },
      ...(sentAt ? { reminderSentAt: sentAt } : moved ? { reminderSentAt: null } : {}),
    },
  });
}
