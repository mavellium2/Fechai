import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { partsInZone, zonedTimeToUtc } from "@/modules/scheduling/time";
import { sendToInternalGroup } from "./group";
import { clinicAnswers, mavelliumAnswers, parseGapSettings, type GapSettings } from "./settings";

/**
 * Avisos da fila — rodam no worker (`workers/follow-up-worker`), nunca no
 * turno do agente: e-mail e grupo são rede, e o contato não pode esperar por
 * eles para receber o "vou confirmar com a equipe".
 *
 * - **Na hora**: um aviso por varredura e por conta, listando as perguntas
 *   NOVAS (repetição não avisa de novo; ela aparece no resumo). Claim por
 *   `notifiedAt`, então dois workers não avisam duas vezes.
 * - **Resumo diário**: na hora local escolhida, com o que está aberto. Claim
 *   por `lastDigestAt`. Worker parado fora dessa hora pula o dia — resumo de
 *   ontem à tarde é ruído, e a fila continua no painel.
 *
 * Os avisos são para a clínica (e-mail dos usuários da conta, grupo interno)
 * só quando ela responde a fila. A Mavellium recebe um resumo próprio, só com
 * contagens por conta — pergunta e conversa ela vê mascaradas no painel.
 * Nenhum aviso leva nome ou telefone de paciente: o link basta.
 */

/** Pergunta nova que o worker só viu depois disso não vira aviso "na hora". */
const NOTICE_STALE_MS = 6 * 3_600_000;
const LIST_LIMIT = 5;
const ADMIN_DIGEST_KEY = "knowledge-gaps:admin-digest";
const ADMIN_DIGEST_HOUR = 8;
const ADMIN_TIMEZONE = "America/Sao_Paulo";

function baseUrl(): string | null {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  return configured ? configured.trim().replace(/\/+$/, "") : null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function quoteLine(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

type NoticeItem = { question: string; askedCount: number };

export function formatGapNotice(items: NoticeItem[], link: string | null): string {
  const head = items.length === 1
    ? "O agente recebeu uma pergunta que ainda não sabe responder:"
    : `O agente recebeu ${items.length} perguntas que ainda não sabe responder:`;
  const list = items.slice(0, LIST_LIMIT).map((i) => `• “${quoteLine(i.question)}”`);
  if (items.length > LIST_LIMIT) list.push(`• e mais ${items.length - LIST_LIMIT}`);
  const tail = link
    ? `Responda e aprove em ${link} — a resposta entra na base e o agente passa a responder sozinho.`
    : "Responda e aprove em Perguntas, no painel — a resposta entra na base e o agente passa a responder sozinho.";
  return [head, ...list, "", tail].join("\n");
}

export function formatGapDigest(input: { open: number; newToday: number; top: NoticeItem[]; oldestHours: number | null }, link: string | null): string {
  const lines = [
    `Perguntas sem resposta na fila: ${input.open}` + (input.newToday ? ` (${input.newToday} ${input.newToday === 1 ? "nova" : "novas"} nas últimas 24h)` : ""),
  ];
  if (input.oldestHours !== null && input.oldestHours >= 24) {
    lines.push(`A mais antiga espera há ${Math.floor(input.oldestHours / 24)} ${Math.floor(input.oldestHours / 24) === 1 ? "dia" : "dias"}.`);
  }
  if (input.top.length) {
    lines.push("", "As mais perguntadas:");
    for (const item of input.top.slice(0, LIST_LIMIT)) {
      lines.push(`• “${quoteLine(item.question)}” — ${item.askedCount} ${item.askedCount === 1 ? "contato" : "contatos"}`);
    }
  }
  lines.push("", link ? `Responder: ${link}` : "Responda em Perguntas, no painel.");
  return lines.join("\n");
}

/** Envia pelos canais ligados da clínica. Nunca lança; diz se algum canal saiu. */
async function deliver(tenantId: string, settings: GapSettings, subject: string, text: string): Promise<boolean> {
  let delivered = false;
  if (settings.notifyEmail) {
    const users = await prisma.user.findMany({
      where: { tenantId, role: "OWNER", usesProduct: true },
      select: { email: true },
      take: 10,
    });
    const html = `<p>${escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
    for (const u of users) {
      const sent = await sendMail({ to: u.email, subject, text, html }).catch(() => ({ ok: false as const, error: "" }));
      if (sent.ok) delivered = true;
    }
  }
  if (settings.notifyWhatsapp && settings.groupId) {
    try {
      // Grupo é do número conectado por QR code (a Meta não tem grupos).
      if (await sendToInternalGroup(tenantId, settings.groupId, text)) delivered = true;
    } catch (err) {
      console.error("[knowledge-gaps] aviso no grupo falhou", tenantId, err);
    }
  }
  return delivered;
}

const hasChannel = (s: GapSettings) => s.notifyEmail || (s.notifyWhatsapp && Boolean(s.groupId));

async function settingsByTenant(tenantIds: string[]): Promise<Map<string, GapSettings>> {
  const rows = await prisma.knowledgeGapSettings.findMany({ where: { tenantId: { in: tenantIds } } });
  const map = new Map(rows.map((r) => [r.tenantId, parseGapSettings(r)]));
  for (const id of tenantIds) if (!map.has(id)) map.set(id, parseGapSettings(null));
  return map;
}

export async function sendGapNotices(now = new Date()): Promise<number> {
  const gaps = await prisma.knowledgeGap.findMany({
    where: { status: "open", notifiedAt: null, tenant: { status: "active" } },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, tenantId: true, question: true, askedCount: true, createdAt: true },
  });
  if (!gaps.length) return 0;

  const settings = await settingsByTenant([...new Set(gaps.map((g) => g.tenantId))]);
  const link = baseUrl();
  let notices = 0;

  const byTenant = new Map<string, typeof gaps>();
  for (const gap of gaps) byTenant.set(gap.tenantId, [...(byTenant.get(gap.tenantId) ?? []), gap]);

  for (const [tenantId, items] of byTenant) {
    const s = settings.get(tenantId)!;
    const claimed: typeof items = [];
    for (const gap of items) {
      const res = await prisma.knowledgeGap.updateMany({ where: { id: gap.id, notifiedAt: null }, data: { notifiedAt: now } });
      if (res.count) claimed.push(gap);
    }
    // Reivindicado mesmo sem enviar: sem aviso ligado, velho demais ou a
    // clínica não responde a fila — a pergunta não pode voltar a cada volta.
    const fresh = claimed.filter((g) => now.getTime() - g.createdAt.getTime() <= NOTICE_STALE_MS);
    if (!fresh.length || !s.immediate || !clinicAnswers(s.responders) || !hasChannel(s)) continue;
    try {
      const subject = fresh.length === 1 ? "Pergunta nova sem resposta no agente" : `${fresh.length} perguntas novas sem resposta no agente`;
      if (await deliver(tenantId, s, subject, formatGapNotice(fresh, link ? `${link}/perguntas` : null))) notices++;
    } catch (err) {
      console.error("[knowledge-gaps] aviso não enviado", tenantId, err);
    }
  }
  return notices;
}

function localDayStart(now: Date, timezone: string): Date {
  const p = partsInZone(now, timezone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timezone);
}

export async function sendGapDigests(now = new Date()): Promise<number> {
  const open = await prisma.knowledgeGap.groupBy({
    by: ["tenantId"],
    where: { status: "open", tenant: { status: "active" } },
    _count: { _all: true },
  });
  if (!open.length) return 0;

  const settings = await settingsByTenant(open.map((o) => o.tenantId));
  const link = baseUrl();
  let digests = 0;

  for (const row of open) {
    const s = settings.get(row.tenantId)!;
    if (!s.dailyDigest || !clinicAnswers(s.responders) || !hasChannel(s)) continue;
    if (partsInZone(now, s.timezone).hour !== s.digestHour) continue;
    try {
      const dayStart = localDayStart(now, s.timezone);
      await prisma.knowledgeGapSettings.createMany({ data: [{ tenantId: row.tenantId }], skipDuplicates: true });
      const claim = await prisma.knowledgeGapSettings.updateMany({
        where: { tenantId: row.tenantId, OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: dayStart } }] },
        data: { lastDigestAt: now },
      });
      if (!claim.count) continue;

      const [top, newToday, oldest] = await Promise.all([
        prisma.knowledgeGap.findMany({
          where: { tenantId: row.tenantId, status: "open" },
          orderBy: [{ askedCount: "desc" }, { lastAskedAt: "desc" }],
          take: LIST_LIMIT,
          select: { question: true, askedCount: true },
        }),
        prisma.knowledgeGap.count({ where: { tenantId: row.tenantId, status: "open", createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
        prisma.knowledgeGap.findFirst({ where: { tenantId: row.tenantId, status: "open" }, orderBy: { firstAskedAt: "asc" }, select: { firstAskedAt: true } }),
      ]);
      const text = formatGapDigest({
        open: row._count._all,
        newToday,
        top,
        oldestHours: oldest ? (now.getTime() - oldest.firstAskedAt.getTime()) / 3_600_000 : null,
      }, link ? `${link}/perguntas` : null);
      if (await deliver(row.tenantId, s, `Resumo do dia: ${row._count._all} ${row._count._all === 1 ? "pergunta" : "perguntas"} sem resposta`, text)) digests++;
    } catch (err) {
      console.error("[knowledge-gaps] resumo diário não enviado", row.tenantId, err);
    }
  }
  return digests;
}

/**
 * Resumo diário da Mavellium (`KNOWLEDGE_GAPS_ADMIN_EMAIL`): contas em que ela
 * responde a fila e quantas perguntas esperam. Sem texto de pergunta — o
 * e-mail sai do painel e não passa pela máscara.
 */
export async function sendAdminGapDigest(now = new Date()): Promise<boolean> {
  const to = process.env.KNOWLEDGE_GAPS_ADMIN_EMAIL?.trim();
  if (!to || partsInZone(now, ADMIN_TIMEZONE).hour !== ADMIN_DIGEST_HOUR) return false;

  const tenants = await prisma.knowledgeGapSettings.findMany({
    where: { responders: { in: ["mavellium", "both"] }, tenant: { status: "active" } },
    select: { tenantId: true, responders: true, tenant: { select: { name: true } } },
  });
  const counts = tenants.length
    ? await prisma.knowledgeGap.groupBy({
        by: ["tenantId"],
        where: { status: "open", tenantId: { in: tenants.map((t) => t.tenantId) } },
        _count: { _all: true },
      })
    : [];
  const rows = tenants
    .filter((t) => mavelliumAnswers(parseGapSettings(t).responders))
    .map((t) => ({ name: t.tenant.name, open: counts.find((c) => c.tenantId === t.tenantId)?._count._all ?? 0 }))
    .filter((r) => r.open > 0)
    .sort((a, b) => b.open - a.open);
  if (!rows.length) return false;

  // Claim no heartbeat: é o único estado global que já existe para o worker.
  const dayStart = localDayStart(now, ADMIN_TIMEZONE);
  await prisma.workerHeartbeat.createMany({ data: [{ key: ADMIN_DIGEST_KEY, lastSeenAt: now }], skipDuplicates: true });
  const claim = await prisma.workerHeartbeat.updateMany({
    where: { key: ADMIN_DIGEST_KEY, OR: [{ lastCompletedAt: null }, { lastCompletedAt: { lt: dayStart } }] },
    data: { lastCompletedAt: now, lastSeenAt: now },
  });
  if (!claim.count) return false;

  const link = baseUrl();
  const text = [
    "Contas com perguntas sem resposta na fila da Mavellium:",
    ...rows.map((r) => `• ${r.name}: ${r.open}`),
    "",
    link ? `Responder: ${link}/admin/perguntas` : "Responda em Admin › Perguntas.",
  ].join("\n");
  const sent = await sendMail({
    to,
    subject: `Fila de perguntas: ${rows.reduce((a, r) => a + r.open, 0)} aguardando`,
    text,
    html: `<p>${escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
  });
  return sent.ok;
}

/** Uma volta do worker. Cada parte com o próprio `try`: uma falha não cala as outras. */
export async function scanKnowledgeGaps(now = new Date()): Promise<{ notices: number; digests: number; admin: boolean }> {
  const notices = await sendGapNotices(now).catch((err) => {
    console.error("[knowledge-gaps] avisos falharam", err);
    return 0;
  });
  const digests = await sendGapDigests(now).catch((err) => {
    console.error("[knowledge-gaps] resumos falharam", err);
    return 0;
  });
  const admin = await sendAdminGapDigest(now).catch((err) => {
    console.error("[knowledge-gaps] resumo da Mavellium falhou", err);
    return false;
  });
  return { notices, digests, admin };
}
