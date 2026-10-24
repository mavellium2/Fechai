import { XMLParser } from "fast-xml-parser";

/**
 * CalDAV do iCloud, só HTTP: sem banco, sem regra de negócio, sem log de
 * credencial. Quem decide o que fazer com cada resposta é `icloud.ts`.
 *
 * Nada aqui lança. Toda chamada devolve o código HTTP e uma classificação
 * (`kind`), porque o chamador trata diferente "senha revogada" (para tudo e
 * avisa), "evento já existe" (412, sucesso) e "Apple fora do ar" (tenta depois).
 *
 * **Só falamos com `*.icloud.com`.** O endereço de cada calendário vem de um
 * XML que o servidor devolve; sem esta trava, uma resposta adulterada faria o
 * Apple ID e a senha de app irem em Basic para um host qualquer.
 */

export const ICLOUD_ENTRY_URL = "https://caldav.icloud.com/";
export const CALDAV_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 5;

export type CaldavCredentials = { appleId: string; appPassword: string };

export type CaldavKind =
  | "ok"
  /** 401: senha de app revogada, Apple ID errado ou 2FA desligado. */
  | "auth"
  | "forbidden"
  | "not_found"
  /** 412: `If-None-Match: *` e o recurso já existe. */
  | "exists"
  /** 5xx. */
  | "server"
  | "timeout"
  | "network"
  /** 4xx não previsto, ou redirecionamento para fora do iCloud. */
  | "rejected";

export type CaldavResponse = { kind: CaldavKind; status: number; body: string };

export type CaldavResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; kind: Exclude<CaldavKind, "ok"> };

/** O endereço é do iCloud (https e `*.icloud.com`)? */
export function isIcloudUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "icloud.com" || url.hostname.endsWith(".icloud.com"));
  } catch {
    return false;
  }
}

/** Resolve um `href` do servidor contra a URL de origem e recusa o que não é do iCloud. */
export function resolveIcloudUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    url.port = "";
    return isIcloudUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function authHeader(cred: CaldavCredentials): string {
  return `Basic ${Buffer.from(`${cred.appleId}:${cred.appPassword}`).toString("base64")}`;
}

function classify(status: number): CaldavKind {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 412) return "exists";
  if (status >= 500) return "server";
  return "rejected";
}

type RequestInput = {
  method: "PROPFIND" | "REPORT" | "PUT" | "DELETE";
  url: string;
  cred: CaldavCredentials;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

/** Uma chamada, seguindo o redirecionamento de partição (`pNN-caldav.icloud.com`). */
export async function caldavRequest(input: RequestInput): Promise<CaldavResponse> {
  let url = input.url;
  if (!isIcloudUrl(url)) return { kind: "rejected", status: 0, body: "" };
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(url, {
        method: input.method,
        headers: {
          Authorization: authHeader(input.cred),
          ...(input.body !== undefined ? { "Content-Type": input.method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8" } : {}),
          ...input.headers,
        },
        body: input.body,
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeoutMs ?? CALDAV_TIMEOUT_MS),
        cache: "no-store",
      });

      if ([301, 302, 307, 308].includes(res.status)) {
        const next = res.headers.get("location");
        const target = next ? resolveIcloudUrl(next, url) : null;
        // Redirecionar para fora do iCloud levaria a senha junto: recusa.
        if (!target) return { kind: "rejected", status: res.status, body: "" };
        url = target;
        continue;
      }

      const body = await res.text().catch(() => "");
      return { kind: classify(res.status), status: res.status, body };
    }
    return { kind: "rejected", status: 0, body: "" };
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { kind: timeout ? "timeout" : "network", status: 0, body: "" };
  }
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  // Valores ficam como texto: um displayname "2026" não pode virar número.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["response", "propstat", "comp", "href"].includes(name),
});

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const node = asNode(value);
  if (node && typeof node["#text"] === "string") return node["#text"].trim() || null;
  return null;
}

type DavResponse = { href: string | null; props: Node; status: number };

/** As `response` de um 207 Multi-Status, com as props das propstat 2xx fundidas. */
export function parseMultistatus(xml: string): DavResponse[] | null {
  let doc: Node | null;
  try {
    doc = asNode(parser.parse(xml));
  } catch {
    return null;
  }
  // `<multistatus/>` sem filhos (calendário vazio) o parser devolve como "".
  if (doc && doc.multistatus === "") return [];
  const multistatus = asNode(doc?.multistatus);
  if (!multistatus) return null;
  const responses = (multistatus.response as unknown[] | undefined) ?? [];
  return responses.map((raw) => {
    const r = asNode(raw) ?? {};
    const hrefs = (r.href as unknown[] | undefined) ?? [];
    const merged: Node = {};
    let status = 404;
    for (const ps of (r.propstat as unknown[] | undefined) ?? []) {
      const p = asNode(ps);
      const st = typeof p?.status === "string" ? Number(/\s(\d{3})\s/.exec(p.status)?.[1] ?? 0) : 0;
      if (st >= 200 && st < 300) {
        Object.assign(merged, asNode(p?.prop) ?? {});
        status = st;
      }
    }
    // Resposta sem propstat (ex.: 404 de um recurso) traz `status` direto.
    if (!((r.propstat as unknown[] | undefined) ?? []).length && typeof r.status === "string") {
      status = Number(/\s(\d{3})\s/.exec(r.status)?.[1] ?? 0);
    }
    return { href: text(hrefs[0]), props: merged, status };
  });
}

const NS_DAV = 'xmlns:d="DAV:"';
const NS_CALDAV = 'xmlns:c="urn:ietf:params:xml:ns:caldav"';
const NS_CS = 'xmlns:cs="http://calendarserver.org/ns/"';
const NS_APPLE = 'xmlns:ic="http://apple.com/ns/ical/"';
const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';

function fail<T>(res: CaldavResponse): CaldavResult<T> {
  return { ok: false, status: res.status, kind: res.kind === "ok" ? "rejected" : res.kind };
}

// ---------------------------------------------------------------------------
// Descoberta
// ---------------------------------------------------------------------------

/** `current-user-principal`: ponto de partida de toda a descoberta. */
export async function discoverPrincipal(cred: CaldavCredentials): Promise<CaldavResult<{ principalUrl: string }>> {
  const res = await caldavRequest({
    method: "PROPFIND", url: ICLOUD_ENTRY_URL, cred, headers: { Depth: "0" },
    body: `${XML_HEAD}<d:propfind ${NS_DAV}><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
  });
  if (res.kind !== "ok") return fail(res);
  const rows = parseMultistatus(res.body);
  const principal = asNode(rows?.[0]?.props["current-user-principal"]);
  const href = text(((principal?.href as unknown[] | undefined) ?? [])[0]);
  const principalUrl = href ? resolveIcloudUrl(href, ICLOUD_ENTRY_URL) : null;
  if (!principalUrl) return { ok: false, status: res.status, kind: "rejected" };
  return { ok: true, status: res.status, data: { principalUrl } };
}

/** `calendar-home-set`: onde ficam os calendários (host de partição). */
export async function discoverCalendarHome(
  cred: CaldavCredentials,
  principalUrl: string,
): Promise<CaldavResult<{ calendarHomeUrl: string }>> {
  const res = await caldavRequest({
    method: "PROPFIND", url: principalUrl, cred, headers: { Depth: "0" },
    body: `${XML_HEAD}<d:propfind ${NS_DAV} ${NS_CALDAV}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
  });
  if (res.kind !== "ok") return fail(res);
  const rows = parseMultistatus(res.body);
  const home = asNode(rows?.[0]?.props["calendar-home-set"]);
  const href = text(((home?.href as unknown[] | undefined) ?? [])[0]);
  const calendarHomeUrl = href ? resolveIcloudUrl(href, principalUrl) : null;
  if (!calendarHomeUrl) return { ok: false, status: res.status, kind: "rejected" };
  return { ok: true, status: res.status, data: { calendarHomeUrl: calendarHomeUrl.endsWith("/") ? calendarHomeUrl : `${calendarHomeUrl}/` } };
}

export type CalDavCalendar = { url: string; name: string; color: string | null };

/** Calendários de eventos da conta (os de lembretes/tarefas ficam de fora). */
export async function listCalendars(
  cred: CaldavCredentials,
  calendarHomeUrl: string,
): Promise<CaldavResult<CalDavCalendar[]>> {
  const res = await caldavRequest({
    method: "PROPFIND", url: calendarHomeUrl, cred, headers: { Depth: "1" },
    body:
      `${XML_HEAD}<d:propfind ${NS_DAV} ${NS_CALDAV} ${NS_APPLE}><d:prop>` +
      "<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><ic:calendar-color/>" +
      "</d:prop></d:propfind>",
  });
  if (res.kind !== "ok") return fail(res);
  const rows = parseMultistatus(res.body);
  if (!rows) return { ok: false, status: res.status, kind: "rejected" };

  const calendars: CalDavCalendar[] = [];
  for (const row of rows) {
    const type = asNode(row.props.resourcetype);
    if (!type || !("calendar" in type)) continue;
    const comps = asNode(row.props["supported-calendar-component-set"]);
    const names = ((comps?.comp as unknown[] | undefined) ?? []).map((c) => asNode(c)?.["@_name"]);
    // Calendário só de lembretes (VTODO) não recebe consulta.
    if (comps && !names.includes("VEVENT")) continue;
    const url = row.href ? resolveIcloudUrl(row.href, calendarHomeUrl) : null;
    if (!url) continue;
    const color = text(row.props["calendar-color"]);
    calendars.push({
      url: url.endsWith("/") ? url : `${url}/`,
      name: text(row.props.displayname) ?? "Calendário",
      color: color && /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : null,
    });
  }
  return { ok: true, status: res.status, data: calendars };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** `20260801T000000Z`, o formato do `time-range`. */
export function caldavStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Os `.ics` do calendário que tocam o intervalo (a expansão de recorrência é nossa). */
export async function queryEvents(
  cred: CaldavCredentials,
  calendarUrl: string,
  start: Date,
  end: Date,
): Promise<CaldavResult<string[]>> {
  const res = await caldavRequest({
    method: "REPORT", url: calendarUrl, cred, headers: { Depth: "1" },
    body:
      `${XML_HEAD}<c:calendar-query ${NS_DAV} ${NS_CALDAV}><d:prop><d:getetag/><c:calendar-data/></d:prop>` +
      `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
      `<c:time-range start="${caldavStamp(start)}" end="${caldavStamp(end)}"/>` +
      "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>",
  });
  if (res.kind !== "ok") return fail(res);
  const rows = parseMultistatus(res.body);
  // Resposta que não é um Multi-Status não comprova que a agenda está livre.
  if (!rows) return { ok: false, status: res.status, kind: "rejected" };
  const ics: string[] = [];
  for (const row of rows) {
    const data = text(row.props["calendar-data"]);
    if (data) ics.push(data);
  }
  return { ok: true, status: res.status, data: ics };
}

/** `getctag`: muda quando qualquer evento do calendário muda. Null se o servidor não informa. */
export async function getCtag(cred: CaldavCredentials, calendarUrl: string): Promise<CaldavResult<string | null>> {
  const res = await caldavRequest({
    method: "PROPFIND", url: calendarUrl, cred, headers: { Depth: "0" },
    body: `${XML_HEAD}<d:propfind ${NS_DAV} ${NS_CS}><d:prop><cs:getctag/></d:prop></d:propfind>`,
  });
  if (res.kind !== "ok") return fail(res);
  const rows = parseMultistatus(res.body);
  if (!rows) return { ok: false, status: res.status, kind: "rejected" };
  return { ok: true, status: res.status, data: text(rows[0]?.props.getctag) };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Grava o evento no endereço. `onlyIfNew` manda `If-None-Match: *` (412 = já existe). */
export function putEvent(
  cred: CaldavCredentials,
  url: string,
  ics: string,
  { onlyIfNew = false }: { onlyIfNew?: boolean } = {},
): Promise<CaldavResponse> {
  return caldavRequest({
    method: "PUT", url, cred, body: ics,
    headers: onlyIfNew ? { "If-None-Match": "*" } : {},
  });
}

export function deleteEvent(cred: CaldavCredentials, url: string): Promise<CaldavResponse> {
  return caldavRequest({ method: "DELETE", url, cred });
}
