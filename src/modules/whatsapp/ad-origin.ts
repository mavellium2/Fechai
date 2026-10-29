/**
 * De qual anúncio o contato veio (Click-to-WhatsApp). Puro: nunca lança, e o que
 * não parece anúncio devolve `null` — nunca um palpite.
 *
 * Fontes, conferidas em produção (Evolution, 29/10/2026):
 * - **Evolution:** `contextInfo.externalAdReply` da mensagem do próprio lead.
 *   `sourceId` é o id do anúncio, `sourceType` vale `ad`, e `greetingMessageBody`
 *   traz a saudação automática do WhatsApp Business com o código da campanha
 *   (`Oi! Como podemos ajudar? [AD37 - Prótese Protocolo]`). A saudação não
 *   chega como mensagem separada: o código vem DENTRO da mensagem do lead.
 * - **Meta:** o objeto `referral` da mensagem (`source_id`, `source_type`,
 *   `headline`, `source_url`). Não traz a saudação, então o código só existe se
 *   o gestor o escreveu no título.
 *
 * `ctwaClid` (identificador do clique) é ignorado de propósito: o relatório não
 * precisa dele e ele identifica a pessoa na Meta.
 */

export type AdOrigin = {
  /** Id do anúncio na Meta — a chave estável. */
  sourceId: string | null;
  /** Código da campanha ("AD27"), do texto escrito pelo gestor de tráfego. */
  code: string | null;
  /** Nome depois do código ("Alinhadores Invisíveis"). */
  name: string | null;
  sourceUrl: string | null;
  platform: "facebook" | "instagram" | null;
};

const CODE_RE = /\[\s*(AD\s?\d{1,4})\s*(?:[-–—:]\s*([^\]]{1,120}))?\]/i;

/** "[AD27 - Alinhadores Invisíveis]" → { code: "AD27", name: "Alinhadores Invisíveis" }. */
export function parseAdCode(text: unknown): { code: string; name: string | null } | null {
  if (typeof text !== "string") return null;
  const match = CODE_RE.exec(text);
  if (!match) return null;
  const name = match[2]?.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  return { code: match[1].replace(/\s+/g, "").toUpperCase(), name };
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const string = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function cleanSourceId(value: unknown): string | null {
  const id = typeof value === "number" ? String(value) : string(value);
  return id && /^\d{5,30}$/.test(id) ? id : null;
}

function cleanUrl(value: unknown): string | null {
  const url = string(value);
  return url && /^https?:\/\//i.test(url) ? url.slice(0, 300) : null;
}

function cleanPlatform(...values: unknown[]): AdOrigin["platform"] {
  for (const value of values) {
    const v = string(value)?.toLowerCase();
    if (v === "facebook" || v === "instagram") return v;
  }
  return null;
}

/** Junta o que se sabe; sem id e sem código não há o que relatar. */
function build(input: { sourceId: unknown; texts: unknown[]; url: unknown; platform: AdOrigin["platform"] }): AdOrigin | null {
  const sourceId = cleanSourceId(input.sourceId);
  const parsed = input.texts.map(parseAdCode).find(Boolean) ?? null;
  if (!sourceId && !parsed) return null;
  return {
    sourceId,
    code: parsed?.code ?? null,
    name: parsed?.name ?? null,
    sourceUrl: cleanUrl(input.url),
    platform: input.platform,
  };
}

/** Chaves que nunca valem a pena percorrer (miniaturas em base64 pesam e não dizem nada). */
const SKIP_KEY = /thumbnail|base64/i;

/** Acha o primeiro `externalAdReply` e o objeto que o contém (`contextInfo`). */
function findAdReply(node: unknown, depth = 0): { reply: Record<string, unknown>; context: Record<string, unknown> } | null {
  const current = object(node);
  if (!current || depth > 6) return null;
  const direct = object(current.externalAdReply);
  if (direct) return { reply: direct, context: current };
  for (const [key, value] of Object.entries(current)) {
    if (SKIP_KEY.test(key)) continue;
    const inner = findAdReply(value, depth + 1);
    if (inner) return inner;
  }
  return null;
}

/**
 * Anúncio de uma mensagem da Evolution (webhook `messages.upsert` ou registro de
 * `/chat/findMessages` — a forma é a mesma). Só vale como anúncio quando a
 * própria Meta o marca (`sourceType: "ad"` ou a origem `ctwa_ad`/`FB_Ads`):
 * `externalAdReply` também aparece em pré-visualização de link, e isso não é
 * anúncio.
 */
export function extractEvolutionAdOrigin(data: unknown): AdOrigin | null {
  const found = findAdReply(data);
  if (!found) return null;
  const { reply, context } = found;
  const isAd =
    string(reply.sourceType)?.toLowerCase() === "ad" ||
    string(context.entryPointConversionSource)?.toLowerCase() === "ctwa_ad" ||
    string(context.conversionSource)?.toLowerCase() === "fb_ads";
  if (!isAd) return null;
  return build({
    sourceId: reply.sourceId,
    texts: [reply.greetingMessageBody, reply.title, reply.body],
    url: reply.sourceUrl,
    platform: cleanPlatform(reply.sourceApp, context.entryPointConversionApp),
  });
}

/** Anúncio do objeto `referral` da Meta. `source_type: "post"` (publicação) não é anúncio. */
export function extractMetaAdOrigin(referral: unknown): AdOrigin | null {
  const r = object(referral);
  if (!r) return null;
  const type = string(r.source_type)?.toLowerCase();
  if (type && type !== "ad") return null;
  return build({
    sourceId: r.source_id,
    texts: [r.headline, r.body],
    url: r.source_url,
    platform: null,
  });
}
