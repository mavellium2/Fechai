import { prisma } from "@/lib/prisma";
import type { IcloudCalendarIntegration } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getCalendarFeatures } from "./features";
import { parseScheduleConfig } from "./config";
import {
  deleteEvent, discoverCalendarHome, discoverPrincipal, listCalendars, putEvent, queryEvents, resolveIcloudUrl,
  type CalDavCalendar, type CaldavCredentials, type CaldavKind, type CaldavResponse,
} from "./caldav";
import { buildEvent, eventUid, localDayRange, parseBusyBlocks, type BusyBlock, type IcloudEventInput } from "./ical";
import { dayKeyInZone } from "./time";

/**
 * Espelho opcional no Calendário da Apple (iCloud, por CalDAV).
 *
 * Mesmo desenho do Google (`./google.ts`) e do Clinicorp (`./clinicorp.ts`): a
 * agenda do fechai é a **fonte da verdade** e o iCloud é espelho. Nenhuma função
 * pública daqui lança — um iCloud fora do ar, ou uma senha revogada, não pode
 * derrubar o atendimento nem desfazer um horário já combinado com o lead.
 *
 * Credencial: o cliente gera uma **senha de app** em appleid.apple.com (exige
 * verificação em duas etapas). Apple ID e senha ficam cifrados
 * (`src/lib/crypto.ts`) e só `getIntegration()` os decifra. **Nada de Apple ID,
 * senha, header ou corpo vai para log**: só o tenant e o código HTTP.
 *
 * O evento tem endereço fixo (`{calendário}fechai-<id>.ics`): enviar duas vezes
 * não duplica, e cancelar sabe onde apagar mesmo se o endereço não foi gravado.
 */

export type { CalDavCalendar };

export const AUTH_MESSAGE =
  "A senha de app foi revogada ou o Apple ID mudou. Gere uma nova senha em appleid.apple.com e reconecte.";
export const CALENDAR_GONE_MESSAGE =
  "O calendário escolhido não existe mais ou é somente leitura. Escolha outro em Integrações.";

type DecryptedIntegration = IcloudCalendarIntegration;

export type IcloudIntegrationState = "configured" | "not_connected" | "disabled" | "credentials_error" | "unavailable";

/**
 * A integração do tenant com Apple ID e senha **já decifrados**.
 *
 * Mesma regra do Clinicorp: a decifragem mora aqui para não existir caminho em
 * que alguém mande a senha cifrada no header Basic. Credencial ilegível (chave
 * trocada, linha corrompida) devolve `null` — para o resto do módulo é o mesmo
 * que "não conectado", e a pessoa reconecta na tela.
 */
async function getIntegration(
  tenantId: string,
  { ignoreFeatureFlag = false, onUnavailable, onInactive }: {
    ignoreFeatureFlag?: boolean; onUnavailable?: () => void;
    onInactive?: (state: IcloudIntegrationState) => void;
  } = {},
): Promise<DecryptedIntegration | null> {
  let rowUnavailable = false;
  let featuresUnavailable = false;
  const [row, features] = await Promise.all([
    prisma.icloudCalendarIntegration.findUnique({ where: { tenantId } }).catch(() => { rowUnavailable = true; onUnavailable?.(); return null; }),
    getCalendarFeatures(tenantId, () => { featuresUnavailable = true; onUnavailable?.(); }),
  ]);
  if (rowUnavailable || (featuresUnavailable && !ignoreFeatureFlag)) { onInactive?.("unavailable"); return null; }
  if (!row) { onInactive?.("not_connected"); return null; }

  // Desabilitar em /integracoes precisa PARAR a sincronização de verdade. A
  // exceção é limpar o que já foi enviado (`ignoreFeatureFlag`): cancelar aqui
  // tem que sumir do iPhone mesmo depois de desabilitar.
  if (!features.icloudEnabled && !ignoreFeatureFlag) { onInactive?.("disabled"); return null; }

  const appleId = decryptSecret(row.appleId);
  const appPassword = decryptSecret(row.appPassword);
  if (!appleId || !appPassword) {
    onInactive?.("credentials_error");
    console.error(`[icloud] credenciais ilegíveis para o tenant ${tenantId}`);
    if (row.checkAvailability) onUnavailable?.();
    return null;
  }
  return { ...row, appleId, appPassword };
}

function credOf(i: DecryptedIntegration): CaldavCredentials {
  return { appleId: i.appleId, appPassword: i.appPassword };
}

/** "m***@icloud.com": o suficiente para a pessoa reconhecer a conta, sem expô-la na tela. */
export function maskAppleId(appleId: string): string {
  const [user, domain] = appleId.split("@");
  if (!domain) return `${appleId.slice(0, 1)}***`;
  return `${user.slice(0, 1)}***@${domain}`;
}

// ---------------------------------------------------------------------------
// Cache da agenda (a leitura mensal entra na parte C; o cache é limpo por toda escrita)
// ---------------------------------------------------------------------------

type AgendaCacheStore = Map<string, unknown>;

/** No `globalThis`, como o do Clinicorp: página e rota do pulso são pacotes diferentes. */
export function icloudAgendaCache(): AgendaCacheStore {
  const g = globalThis as unknown as { __icloudAgendaCache?: AgendaCacheStore };
  g.__icloudAgendaCache ??= new Map();
  return g.__icloudAgendaCache;
}

/** Esquece o que foi lido de uma conta (ou de todas) — escrita, nova credencial, desconexão. */
export function clearIcloudAgendaCache(tenantId?: string): void {
  const store = icloudAgendaCache();
  for (const key of [...store.keys()]) {
    if (!tenantId || key.startsWith(`${tenantId}|`)) store.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

export type IcloudOp = "send" | "update" | "remove" | "read";

const OP_TEXT: Record<IcloudOp, string> = {
  send: "enviar o horário ao",
  update: "atualizar o horário no",
  remove: "remover o horário do",
  read: "conferir a disponibilidade no",
};

/** Mensagem para a tela, autoexplicativa e sem nenhum dado de credencial. */
export function describeFailure(op: IcloudOp, kind: CaldavKind, status: number): string {
  if (kind === "auth") return AUTH_MESSAGE;
  if (kind === "forbidden" || kind === "not_found") return CALENDAR_GONE_MESSAGE;
  const target = "Calendário da Apple";
  if (op === "read" && kind === "rejected") {
    return `Não foi possível ler a agenda do ${target} (resposta inesperada do iCloud). Novos horários não serão oferecidos até a leitura funcionar.`;
  }
  if (kind === "server" || kind === "timeout" || kind === "network") {
    return op === "read"
      ? `Não foi possível conferir a disponibilidade no ${target} (o iCloud não respondeu). Novos horários não serão oferecidos até a leitura funcionar.`
      : `Não foi possível ${OP_TEXT[op]} ${target} agora (o iCloud não respondeu). O fechai tenta de novo sozinho.`;
  }
  return `O iCloud recusou a operação (código ${status || "desconhecido"}) ao ${OP_TEXT[op].replace(/ [ao]+$/, "")}.`;
}

/**
 * Anota o resultado da última chamada — a tela mostra isso ao cliente.
 *
 * 401 trava tudo (`authFailedAt`): insistir com senha revogada só gera
 * tentativas inúteis até a Apple bloquear a conta. Nunca grava credencial.
 */
export async function recordOutcome(
  tenantId: string,
  outcome: { ok: true } | { ok: false; op: IcloudOp; kind: CaldavKind; status: number },
): Promise<void> {
  const now = new Date();
  const data = outcome.ok
    ? { lastSyncAt: now, lastError: null, lastErrorAt: null }
    : (() => {
        const message = describeFailure(outcome.op, outcome.kind, outcome.status).slice(0, 500);
        return {
          lastError: message,
          lastErrorAt: now,
          ...(outcome.kind === "auth" ? { authFailedAt: now, connectionError: message, connectionErrorAt: now } : {}),
          ...(outcome.kind === "forbidden" || outcome.kind === "not_found"
            ? { connectionError: message, connectionErrorAt: now }
            : {}),
        };
      })();
  await prisma.icloudCalendarIntegration.update({ where: { tenantId }, data }).catch(() => {});
}

/** Metadados para a UI, sem levar a senha (nem o Apple ID inteiro) à camada de apresentação. */
export async function getIcloudStatus(tenantId: string) {
  const i = await getIntegration(tenantId, { ignoreFeatureFlag: true });
  if (!i) return null;
  return {
    appleIdHint: maskAppleId(i.appleId),
    calendarUrl: i.calendarUrl,
    calendarName: i.calendarName,
    busyCalendarUrls: i.busyCalendarUrls,
    syncEnabled: i.syncEnabled,
    checkAvailability: i.checkAvailability,
    lastError: i.lastError,
    lastErrorAt: i.lastErrorAt,
    lastSyncAt: i.lastSyncAt,
    authFailedAt: i.authFailedAt,
    connectionError: i.connectionError,
    connectionErrorAt: i.connectionErrorAt,
  };
}

export type IcloudStatus = NonNullable<Awaited<ReturnType<typeof getIcloudStatus>>>;

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------

type CallResult<T> = { ok: true; data: T } | { ok: false; error: string };

function connectionMessage(kind: CaldavKind): string {
  if (kind === "auth") {
    return "O Apple ID ou a senha de app foram recusados. Confira se é uma senha de app (e não a senha do seu Apple ID) e se a verificação em duas etapas está ligada.";
  }
  if (kind === "server" || kind === "timeout" || kind === "network") {
    return "Não foi possível falar com o iCloud agora. Tente novamente em instantes.";
  }
  return "O iCloud não respondeu como esperado. Tente novamente em instantes.";
}

export type IcloudDiscovery = { principalUrl: string; calendarHomeUrl: string; calendars: CalDavCalendar[] };

/**
 * As credenciais funcionam? Descobre o endereço do calendário (host de partição)
 * e lista os calendários de eventos. Só depois disso as credenciais são gravadas:
 * descobrir dias depois que a senha estava errada, quando um horário não chegou
 * no iPhone, seria o pior jeito de errar.
 */
export async function verifyIcloudCredentials(appleId: string, appPassword: string): Promise<CallResult<IcloudDiscovery>> {
  try {
    const cred = { appleId, appPassword };
    const principal = await discoverPrincipal(cred);
    if (!principal.ok) return { ok: false, error: connectionMessage(principal.kind) };
    const home = await discoverCalendarHome(cred, principal.data.principalUrl);
    if (!home.ok) return { ok: false, error: connectionMessage(home.kind) };
    const calendars = await listCalendars(cred, home.data.calendarHomeUrl);
    if (!calendars.ok) return { ok: false, error: connectionMessage(calendars.kind) };
    if (!calendars.data.length) return { ok: false, error: "Nenhum calendário de eventos encontrado nesta conta do iCloud." };
    return { ok: true, data: { principalUrl: principal.data.principalUrl, calendarHomeUrl: home.data.calendarHomeUrl, calendars: calendars.data } };
  } catch {
    return { ok: false, error: "Não foi possível falar com o iCloud agora. Tente novamente em instantes." };
  }
}

/** Os calendários da conta já conectada — para o seletor. Nunca lança. */
export async function listIcloudCalendars(tenantId: string): Promise<CallResult<CalDavCalendar[]>> {
  try {
    const integration = await getIntegration(tenantId, { ignoreFeatureFlag: true });
    if (!integration) return { ok: false, error: "Calendário da Apple não está conectado." };
    const res = await listCalendars(credOf(integration), integration.calendarHomeUrl);
    if (!res.ok) {
      if (res.kind === "auth") await recordOutcome(tenantId, { ok: false, op: "read", kind: "auth", status: res.status });
      return { ok: false, error: connectionMessage(res.kind) };
    }
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, error: "Não foi possível falar com o iCloud agora. Tente novamente em instantes." };
  }
}

/** Testa a conexão e anota o resultado (a tela mostra o aviso e o botão limpa quando volta). */
export async function testIcloudConnection(tenantId: string): Promise<CallResult<string>> {
  const calendars = await listIcloudCalendars(tenantId);
  if (!calendars.ok) return calendars;
  await prisma.icloudCalendarIntegration
    .updateMany({ where: { tenantId }, data: { authFailedAt: null, connectionError: null, connectionErrorAt: null } })
    .catch(() => {});
  return { ok: true, data: `Conexão com o iCloud funcionando (${calendars.data.length} ${calendars.data.length === 1 ? "calendário" : "calendários"}).` };
}

/**
 * Grava a conexão com Apple ID e senha cifrados.
 *
 * Único caminho de escrita das credenciais. Reconectar com o **mesmo** Apple ID
 * preserva as escolhas (calendário, leitura); com outro, elas são zeradas — a
 * URL do calendário de uma conta não existe na outra.
 */
export async function saveIcloudCredentials(
  tenantId: string,
  input: { appleId: string; appPassword: string; principalUrl: string; calendarHomeUrl: string },
  defaults: { calendarUrl?: string | null; calendarName?: string | null } = {},
): Promise<void> {
  const existing = await prisma.icloudCalendarIntegration.findUnique({ where: { tenantId } }).catch(() => null);
  const sameAccount = existing ? decryptSecret(existing.appleId) === input.appleId : false;

  const credentials = {
    appleId: encryptSecret(input.appleId),
    appPassword: encryptSecret(input.appPassword),
    principalUrl: input.principalUrl,
    calendarHomeUrl: input.calendarHomeUrl,
    lastError: null, lastErrorAt: null, authFailedAt: null, connectionError: null, connectionErrorAt: null,
  };

  await prisma.icloudCalendarIntegration.upsert({
    where: { tenantId },
    create: { tenantId, ...credentials, calendarUrl: defaults.calendarUrl ?? null, calendarName: defaults.calendarName ?? null },
    update: sameAccount
      ? credentials
      : { ...credentials, calendarUrl: defaults.calendarUrl ?? null, calendarName: defaults.calendarName ?? null, busyCalendarUrls: [] },
  });
  if (!sameAccount) await resetIcloudEventUrls(tenantId);
  clearIcloudAgendaCache(tenantId);
}

/**
 * Apaga a conexão. As credenciais são do cliente: sai tudo. Os eventos já
 * enviados continuam no iPhone; o fechai só esquece o endereço deles, para que
 * uma reconexão (inclusive a outra conta) volte a enviar as consultas futuras.
 */
export async function disconnectIcloud(tenantId: string): Promise<void> {
  await prisma.icloudCalendarIntegration.deleteMany({ where: { tenantId } });
  await resetIcloudEventUrls(tenantId);
  clearIcloudAgendaCache(tenantId);
}

/** Esquece os endereços gravados nas consultas (a varredura reenvia as futuras). */
export async function resetIcloudEventUrls(tenantId: string): Promise<void> {
  await prisma.appointment
    .updateMany({
      where: { tenantId, OR: [{ icloudEventUrl: { not: null } }, { icloudSyncAttempts: { gt: 0 } }] },
      data: { icloudEventUrl: null, icloudSyncAttempts: 0, icloudNextAttemptAt: null },
    })
    .catch(() => {});
}

/**
 * Trocou o calendário que recebe os horários: apaga os eventos futuros do
 * calendário antigo e esquece os endereços, e a varredura envia ao novo.
 * Nunca lança.
 */
export async function moveIcloudEvents(tenantId: string): Promise<void> {
  try {
    const rows = await prisma.appointment.findMany({
      where: { tenantId, status: "scheduled", startsAt: { gt: new Date() }, icloudEventUrl: { not: null } },
      select: { id: true, icloudEventUrl: true },
      take: 200,
    });
    for (const row of rows) await deleteIcloudEvent(tenantId, row.icloudEventUrl, row.id);
    await resetIcloudEventUrls(tenantId);
  } catch (err) {
    console.error("[icloud] mover eventos falhou", err instanceof Error ? err.name : "erro");
  }
}

// ---------------------------------------------------------------------------
// Espelho: criar, atualizar, apagar
// ---------------------------------------------------------------------------

/** O endereço fixo do evento de uma consulta. */
export function eventUrl(calendarUrl: string, appointmentId: string): string {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return `${base}fechai-${encodeURIComponent(appointmentId)}.ics`;
}

export type IcloudSyncResult =
  | { status: "synced"; url: string }
  | { status: "skipped" }
  /** `auth`: senha revogada · `calendar`: calendário sumiu/somente leitura · `transient`: iCloud fora do ar · `rejected`: recusou. */
  | { status: "failed"; reason: "auth" | "calendar" | "transient" | "rejected" };

function failureReason(kind: CaldavKind): "auth" | "calendar" | "transient" | "rejected" {
  if (kind === "auth") return "auth";
  if (kind === "forbidden" || kind === "not_found") return "calendar";
  if (kind === "server" || kind === "timeout" || kind === "network") return "transient";
  return "rejected";
}

/**
 * Envia (ou reenvia) o evento de uma consulta.
 *
 * `If-None-Match: *` não deixa sobrescrever um evento que a pessoa editou no
 * iPhone sem querer. Mas 412 ("já existe") aqui quer dizer que a varredura do
 * worker chegou antes de nós — o evento é do fechai, então um segundo PUT o
 * deixa com os dados atuais. Desligado, sem calendário escolhido ou com a senha
 * revogada: `skipped`, a varredura envia quando voltar.
 */
export async function pushEventToIcloud(
  tenantId: string,
  input: IcloudEventInput,
  opts: { agentId?: string | null } = {},
): Promise<IcloudSyncResult> {
  try {
    const integration = await getIntegration(tenantId);
    if (!integration || !integration.syncEnabled || !integration.calendarUrl || integration.authFailedAt) {
      return { status: "skipped" };
    }
    const cred = credOf(integration);
    const url = eventUrl(integration.calendarUrl, input.appointmentId);
    const ics = buildEvent(await withLocation(tenantId, input, opts.agentId));

    let res: CaldavResponse = await putEvent(cred, url, ics, { onlyIfNew: true });
    if (res.kind === "exists") res = await putEvent(cred, url, ics);

    if (res.kind === "ok") {
      await recordOutcome(tenantId, { ok: true });
      clearIcloudAgendaCache(tenantId);
      return { status: "synced", url };
    }
    console.error(`[icloud] enviar evento falhou tenant=${tenantId} http=${res.status} tipo=${res.kind}`);
    await recordOutcome(tenantId, { ok: false, op: "send", kind: res.kind, status: res.status });
    return { status: "failed", reason: failureReason(res.kind) };
  } catch (err) {
    console.error(`[icloud] enviar evento falhou tenant=${tenantId}`, err instanceof Error ? err.name : "erro");
    return { status: "failed", reason: "transient" };
  }
}

/**
 * Mesmo evento, novo horário (remarcação): PUT no mesmo endereço, sem
 * `If-None-Match`. Se o evento foi apagado no iPhone, o PUT o recria.
 */
export async function updateIcloudEvent(
  tenantId: string,
  url: string | null,
  input: IcloudEventInput,
  opts: { agentId?: string | null } = {},
): Promise<IcloudSyncResult> {
  try {
    const integration = await getIntegration(tenantId);
    if (!integration || !integration.syncEnabled || !integration.calendarUrl || integration.authFailedAt) {
      return { status: "skipped" };
    }
    const target = url ?? eventUrl(integration.calendarUrl, input.appointmentId);
    const res = await putEvent(credOf(integration), target, buildEvent(await withLocation(tenantId, input, opts.agentId)));
    if (res.kind === "ok") {
      await recordOutcome(tenantId, { ok: true });
      clearIcloudAgendaCache(tenantId);
      return { status: "synced", url: target };
    }
    console.error(`[icloud] atualizar evento falhou tenant=${tenantId} http=${res.status} tipo=${res.kind}`);
    await recordOutcome(tenantId, { ok: false, op: "update", kind: res.kind, status: res.status });
    return { status: "failed", reason: failureReason(res.kind) };
  } catch (err) {
    console.error(`[icloud] atualizar evento falhou tenant=${tenantId}`, err instanceof Error ? err.name : "erro");
    return { status: "failed", reason: "transient" };
  }
}

/**
 * Apaga o evento. Ignora a chave de "habilitado": cancelar aqui tem que sumir do
 * iPhone mesmo depois de desabilitar (senão fica consulta fantasma na agenda do
 * cliente). Sem endereço gravado apaga o endereço fixo — um envio que deu certo
 * mas não chegou a ser anotado também fica limpo. 404 conta como removido.
 *
 * `true` = não sobrou nada a remover.
 */
export async function deleteIcloudEvent(tenantId: string, url: string | null, appointmentId: string): Promise<boolean> {
  try {
    const integration = await getIntegration(tenantId, { ignoreFeatureFlag: true });
    if (!integration) return true;
    const target = url ?? (integration.calendarUrl ? eventUrl(integration.calendarUrl, appointmentId) : null);
    if (!target) return true;
    // Só conversa com o iCloud: um endereço adulterado no banco não leva a senha para fora.
    if (!resolveIcloudUrl(target, target)) return false;
    if (integration.authFailedAt) return false;

    const res = await deleteEvent(credOf(integration), target);
    if (res.kind === "ok" || res.kind === "not_found") {
      clearIcloudAgendaCache(tenantId);
      return true;
    }
    console.error(`[icloud] remover evento falhou tenant=${tenantId} http=${res.status} tipo=${res.kind}`);
    await recordOutcome(tenantId, { ok: false, op: "remove", kind: res.kind, status: res.status });
    return false;
  } catch (err) {
    console.error(`[icloud] remover evento falhou tenant=${tenantId}`, err instanceof Error ? err.name : "erro");
    return false;
  }
}

/** Completa o local (`ScheduleConfig.location`) quando quem chamou não o trouxe. */
async function withLocation(tenantId: string, input: IcloudEventInput, agentId?: string | null): Promise<IcloudEventInput> {
  if (input.location !== undefined) return input;
  return { ...input, location: (await scheduleContextFor(tenantId, agentId ?? null)).location };
}

/**
 * Fuso e local da agenda para montar o evento: o agente da consulta, ou o
 * principal da conta (consulta marcada à mão pode não ter agente). Nunca lança.
 */
export async function scheduleContextFor(
  tenantId: string,
  agentId: string | null,
): Promise<{ timeZone: string; location: string }> {
  try {
    const action = agentId
      ? await prisma.tenantAction.findFirst({ where: { tenantId, agentId, key: "schedule_meeting" }, select: { config: true } })
      : null;
    const config = action
      ? action.config
      : (await prisma.agent.findFirst({
          where: { tenantId, archived: false },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: { actions: { where: { key: "schedule_meeting" }, select: { config: true } } },
        }))?.actions[0]?.config;
    const cfg = parseScheduleConfig(config);
    return { timeZone: cfg.timezone, location: cfg.location };
  } catch {
    const cfg = parseScheduleConfig(null);
    return { timeZone: cfg.timezone, location: "" };
  }
}

// ---------------------------------------------------------------------------
// Disponibilidade: o que já está ocupado no iPhone
// ---------------------------------------------------------------------------

export type IcloudBusyBlock = BusyBlock;

/**
 * Tudo que está ocupado no Calendário da Apple num dia local — o calendário que
 * recebe os horários mais os que a pessoa marcou como "considerar ocupado".
 * Uma leitura por calendário e por dia, direto na Apple (sem cache: horário
 * oferecido com base em leitura velha é consulta duplicada).
 *
 * Desligado, não conectado ou leitura desligada (`checkAvailability`) devolve
 * `[]`. **Falha devolve `null`** — nunca transforma disponibilidade
 * desconhecida em agenda vazia (mesma regra do Clinicorp): quem chama não
 * oferece nem confirma horário. Com a senha revogada (`authFailedAt`) devolve
 * `null` sem nem chamar a Apple. `ignoreUid` tira o evento do próprio fechai
 * ao remarcar, senão a consulta bateria em si mesma.
 */
export async function listIcloudBusyBlocks(
  tenantId: string,
  day: string,
  timeZone: string,
  ignoreUid?: string,
): Promise<IcloudBusyBlock[] | null> {
  try {
    let unavailable = false;
    const integration = await getIntegration(tenantId, { onUnavailable: () => { unavailable = true; } });
    if (unavailable) return null;
    if (!integration || !integration.checkAvailability) return [];
    if (integration.authFailedAt) return null;

    const calendars = [...new Set([integration.calendarUrl, ...integration.busyCalendarUrls].filter((u): u is string => Boolean(u)))];
    // Nenhum calendário escolhido ainda: não há o que ler (e a tela já pede a escolha).
    if (!calendars.length) return [];
    const range = localDayRange(day, timeZone);
    if (!range) return null;

    const cred = credOf(integration);
    const results = await Promise.all(calendars.map((url) => queryEvents(cred, url, range.start, range.end)));
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) {
      console.error(`[icloud] ler agenda do dia falhou tenant=${tenantId} http=${failed.status} tipo=${failed.kind}`);
      await recordOutcome(tenantId, { ok: false, op: "read", kind: failed.kind, status: failed.status });
      return null;
    }

    const blocks = parseBusyBlocks(
      results.flatMap((r) => (r.ok ? r.data : [])), day, timeZone, ignoreUid,
    );
    if (!blocks) {
      console.error(`[icloud] interpretar agenda do dia falhou tenant=${tenantId}`);
      await recordOutcome(tenantId, { ok: false, op: "read", kind: "rejected", status: 0 });
    }
    return blocks;
  } catch (err) {
    console.error(`[icloud] listar agenda do dia falhou tenant=${tenantId}`, err instanceof Error ? err.name : "erro");
    return null;
  }
}

/**
 * O horário está ocupado no Calendário da Apple? `false` quando desligado,
 * `null` quando não foi possível conferir. Encostar não é conflito (14:00–15:00
 * e 15:00–16:00 convivem), a mesma regra de `hasConflict`. Consulta que
 * atravessa a meia-noite lê os dois dias.
 */
export async function hasIcloudConflict(
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
  ignoreAppointmentId?: string,
): Promise<boolean | null> {
  try {
    const ignoreUid = ignoreAppointmentId ? eventUid(ignoreAppointmentId) : undefined;
    const first = dayKeyInZone(startsAt, timeZone);
    const last = dayKeyInZone(new Date(Math.max(startsAt.getTime(), endsAt.getTime() - 1)), timeZone);
    const days = first === last ? [first] : [first, last];
    const lists = await Promise.all(days.map((d) => listIcloudBusyBlocks(tenantId, d, timeZone, ignoreUid)));
    if (lists.some((l) => l === null)) return null;
    return lists.flat().some((b) => b !== null && startsAt < b.endsAt && endsAt > b.startsAt);
  } catch (err) {
    console.error(`[icloud] consultar agenda falhou tenant=${tenantId}`, err instanceof Error ? err.name : "erro");
    return null;
  }
}
