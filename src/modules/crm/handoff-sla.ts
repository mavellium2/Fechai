import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { panelBaseUrl } from "@/modules/agent-engine/handoff";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { partsInZone, zonedTimeToUtc } from "@/modules/scheduling/time";
import { getWeeklyAvailability, type WeeklyAvailability } from "@/modules/scheduling/weekly-availability";
import { reflectHandoffInGroup } from "./handoff-panel";
import { crmDurationLabel } from "./sla";
import { recordCrmTrail } from "./trail";

/**
 * Prazo do transbordo (CRM-10).
 *
 * A espera (`HandoffNotice` em `waiting`) é acompanhada pelo worker a cada
 * minuto. Passou do 1º limite, o grupo é avisado de novo citando o aviso;
 * passou do 2º, a espera é escalonada aos donos (painel e e-mail). Um alerta
 * por limite: a marca (`alertedAt`/`escalatedAt`) é gravada **antes** do
 * envio, então falha nunca repete. Assumir fecha a espera e para o relógio.
 *
 * Com "contar só o expediente" (padrão), o tempo só corre dentro do horário de
 * atendimento cadastrado (do agente principal); sem horário cadastrado, corre o
 * tempo todo. Só contas com o CRM ligado; conversa de teste nunca entra.
 */

export const HANDOFF_SLA_DEFAULTS = { alertMinutes: 15, escalateMinutes: 60, businessHoursOnly: true, escalateByEmail: true };
export const HANDOFF_SLA_MAX_MINUTES = 7 * 24 * 60;
export type HandoffSla = typeof HANDOFF_SLA_DEFAULTS;

/** Lê a linha (ou a falta dela) sem lançar: valor estranho cai no padrão. */
export function parseHandoffSla(row: Partial<HandoffSla> | null | undefined): HandoffSla {
  const minutes = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= HANDOFF_SLA_MAX_MINUTES ? value : fallback;
  const alertMinutes = minutes(row?.alertMinutes, HANDOFF_SLA_DEFAULTS.alertMinutes);
  const escalate = minutes(row?.escalateMinutes, HANDOFF_SLA_DEFAULTS.escalateMinutes);
  return {
    alertMinutes,
    // Escalonar antes (ou junto) do 1º alerta não faz sentido: o escalonamento vem depois.
    escalateMinutes: escalate > alertMinutes ? escalate : Math.max(HANDOFF_SLA_DEFAULTS.escalateMinutes, alertMinutes + 1),
    businessHoursOnly: typeof row?.businessHoursOnly === "boolean" ? row.businessHoursOnly : HANDOFF_SLA_DEFAULTS.businessHoursOnly,
    escalateByEmail: typeof row?.escalateByEmail === "boolean" ? row.escalateByEmail : HANDOFF_SLA_DEFAULTS.escalateByEmail,
  };
}

export async function readHandoffSla(tenantId: string): Promise<HandoffSla> {
  const row = await prisma.handoffSlaSettings.findUnique({ where: { tenantId } }).catch(() => null);
  return parseHandoffSla(row);
}

export type BusinessCalendar = { timezone: string; week: WeeklyAvailability; blocked: ReadonlySet<string> };

/**
 * O expediente cadastrado da conta: o horário de atendimento do agente
 * principal (o mesmo que a agenda e os lembretes usam). `null` quando nunca foi
 * cadastrado: aí o prazo corre o tempo todo.
 */
export async function loadBusinessCalendar(tenantId: string): Promise<BusinessCalendar | null> {
  const action = await prisma.tenantAction.findFirst({
    where: { tenantId, key: "schedule_meeting", agent: { archived: false } },
    orderBy: [{ agent: { isPrimary: "desc" } }, { agent: { createdAt: "asc" } }],
    select: { config: true },
  });
  if (!action?.config) return null;
  const cfg = parseScheduleConfig(action.config);
  return { timezone: cfg.timezone, week: getWeeklyAvailability(cfg), blocked: new Set(cfg.blockedDates.map(({ date }) => date)) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutos entre `from` e `to` que caem dentro do expediente (dias bloqueados fora). Pura. */
export function businessMinutesBetween(from: Date, to: Date, calendar: BusinessCalendar): number {
  if (+to <= +from) return 0;
  const { timezone } = calendar;
  const start = partsInZone(from, timezone);
  let day = new Date(Date.UTC(start.year, start.month - 1, start.day));
  let total = 0;
  // Um mês de dias basta: a varredura só olha esperas dos últimos 7 dias.
  for (let i = 0; i < 31; i++) {
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    if (+zonedTimeToUtc(y, m, d, 0, 0, timezone) >= +to) break;
    if (!calendar.blocked.has(`${y}-${pad(m)}-${pad(d)}`)) {
      for (const range of calendar.week[day.getUTCDay()] ?? []) {
        const opens = +zonedTimeToUtc(y, m, d, Math.floor(range.start / 60), range.start % 60, timezone);
        const closes = +zonedTimeToUtc(y, m, d, Math.floor(range.end / 60), range.end % 60, timezone);
        const overlap = Math.min(closes, +to) - Math.max(opens, +from);
        if (overlap > 0) total += overlap;
      }
    }
    day = new Date(Date.UTC(y, m - 1, d + 1));
  }
  return Math.floor(total / 60_000);
}

/** Minutos que contam para o prazo: só o expediente, ou o tempo corrido. */
export function slaMinutes(from: Date, now: Date, sla: HandoffSla, calendar: BusinessCalendar | null): number {
  return sla.businessHoursOnly && calendar
    ? businessMinutesBetween(from, now, calendar)
    : Math.max(0, Math.floor((+now - +from) / 60_000));
}

export const handoffSlaText = {
  alert: (waited: number) => `⏰ Aguardando há ${crmDurationLabel(waited)}`,
};

/** E-mail único por conta e volta, com o link de cada card. Sem nome, telefone ou texto da conversa. */
async function emailOwners(tenantId: string, leads: { leadId: string; waited: number }[], sla: HandoffSla) {
  const owners = await prisma.user.findMany({ where: { tenantId, role: "OWNER", usesProduct: true }, select: { email: true } });
  if (!owners.length) return;
  const base = panelBaseUrl()?.match(/^https?:\/\//) ? panelBaseUrl() : null;
  const lines = leads.map(({ leadId, waited }) =>
    `- Aguardando há ${crmDurationLabel(waited)}${base ? `: ${base}/crm?lead=${encodeURIComponent(leadId)}` : ""}`);
  const subject = leads.length === 1
    ? "Um lead passou do prazo de espera da equipe"
    : `${leads.length} leads passaram do prazo de espera da equipe`;
  const text = [
    `Passou de ${crmDurationLabel(sla.escalateMinutes)} sem ninguém da equipe assumir:`,
    "",
    ...lines,
    "",
    "Abra o CRM do Fechai para assumir ou transferir o atendimento.",
  ].join("\n");
  const html = `<p>Passou de ${crmDurationLabel(sla.escalateMinutes)} sem ninguém da equipe assumir:</p><ul>${leads.map(({ leadId, waited }) =>
    `<li>Aguardando há ${crmDurationLabel(waited)}${base ? ` · <a href="${base}/crm?lead=${encodeURIComponent(leadId)}">abrir o card</a>` : ""}</li>`).join("")}</ul><p>Abra o CRM do Fechai para assumir ou transferir o atendimento.</p>`;
  for (const { email } of owners) {
    await sendMail({ to: email, subject, text, html }).catch(() => ({ ok: false as const, error: "" }));
  }
}

export type HandoffSlaScan = { alerts: number; escalations: number };

/** Uma volta do worker. Nunca lança: falha de uma conta não segura as outras. */
export async function scanHandoffSla(now = new Date()): Promise<HandoffSlaScan> {
  const result: HandoffSlaScan = { alerts: 0, escalations: 0 };
  let notices;
  try {
    notices = await prisma.handoffNotice.findMany({
      where: {
        status: "waiting",
        createdAt: { gte: new Date(+now - HANDOFF_SLA_MAX_MINUTES * 60_000) },
        OR: [{ alertedAt: null }, { escalatedAt: null }],
        conversation: { isTest: false, tenant: { crmEnabled: true, status: "active" } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true, tenantId: true, conversationId: true, createdAt: true, alertedAt: true, escalatedAt: true,
        conversation: { select: { leadId: true } } },
    });
  } catch (error) {
    console.error("[crm] prazo do transbordo: varredura falhou", error);
    return result;
  }

  const byTenant = new Map<string, typeof notices>();
  for (const notice of notices) byTenant.set(notice.tenantId, [...(byTenant.get(notice.tenantId) ?? []), notice]);

  for (const [tenantId, waits] of byTenant) {
    try {
      const sla = await readHandoffSla(tenantId);
      const calendar = sla.businessHoursOnly ? await loadBusinessCalendar(tenantId) : null;
      const escalated: { leadId: string; waited: number }[] = [];
      for (const notice of waits) {
        const counted = slaMinutes(notice.createdAt, now, sla, calendar);
        const waited = Math.max(0, Math.floor((+now - +notice.createdAt) / 60_000));
        if (!notice.alertedAt && counted >= sla.alertMinutes) {
          const claim = await prisma.handoffNotice.updateMany({
            where: { id: notice.id, tenantId, status: "waiting", alertedAt: null }, data: { alertedAt: now },
          });
          if (claim.count) {
            result.alerts++;
            await recordCrmTrail({
              tenantId, event: "handoff.sla_alerted", actor: { kind: "system" }, leadId: notice.conversation.leadId, at: now,
              meta: { level: "alert", conversationId: notice.conversationId, waitedMinutes: waited, countedMinutes: counted },
            });
            await reflectHandoffInGroup(tenantId, notice.conversationId, handoffSlaText.alert(waited));
          }
        }
        if (!notice.escalatedAt && counted >= sla.escalateMinutes) {
          const claim = await prisma.handoffNotice.updateMany({
            where: { id: notice.id, tenantId, status: "waiting", escalatedAt: null }, data: { escalatedAt: now },
          });
          if (claim.count) {
            result.escalations++;
            escalated.push({ leadId: notice.conversation.leadId, waited });
            await recordCrmTrail({
              tenantId, event: "handoff.sla_alerted", actor: { kind: "system" }, leadId: notice.conversation.leadId, at: now,
              meta: { level: "escalated", conversationId: notice.conversationId, waitedMinutes: waited, countedMinutes: counted },
            });
          }
        }
      }
      if (escalated.length && sla.escalateByEmail) await emailOwners(tenantId, escalated, sla);
    } catch (error) {
      console.error("[crm] prazo do transbordo: conta não processada", tenantId, error);
    }
  }
  return result;
}

/** Esperas escalonadas que seguem sem ninguém (o aviso do painel). */
export function countEscalatedWaits(tenantId: string): Promise<number> {
  return prisma.handoffNotice.count({
    where: { tenantId, status: "waiting", escalatedAt: { not: null }, conversation: { isTest: false } },
  }).catch(() => 0);
}
