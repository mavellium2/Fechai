import { EvolutionProvider } from "./evolution";
import { UNTRANSCRIBED_AUDIO } from "@/modules/voice/received-audio";
export { contactPhoneAliases as historyPhoneAliases } from "./contact-phone";

export const HISTORY_PAGE_SIZE = 100;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export type HistoryPage = { records: unknown[]; total: number; pages: number };
export type HistoryMessage = {
  sourceId: string; id: string; phone: string; name?: string; text: string;
  fromMe: boolean; at: Date; audioSeconds?: number; mediaWithoutFile: boolean;
};
export type HistoryReadResult = { message: HistoryMessage } | {
  skipped: "invalid" | "outsideWindow" | "unresolvedPhone" | "ignored" | "unsupported";
};

export async function readEvolutionHistoryPage(externalId: string, since: Date, until: Date, page: number): Promise<HistoryPage> {
  const base = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) throw new Error("O histórico do WhatsApp está indisponível neste ambiente.");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/findMessages/${encodeURIComponent(externalId)}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ where: { messageTimestamp: { gte: since.toISOString(), lte: until.toISOString() } }, page, offset: HISTORY_PAGE_SIZE }),
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível consultar o histórico do WhatsApp. Tente novamente.");
  const data = object(object(await response.json())?.messages);
  if (!data || !Array.isArray(data.records) || data.records.length > HISTORY_PAGE_SIZE ||
    !Number.isSafeInteger(data.total) || Number(data.total) < 0 ||
    !Number.isSafeInteger(data.pages) || Number(data.pages) < 0 ||
    (data.currentPage !== undefined && data.currentPage !== page) ||
    Number(data.pages) !== Math.ceil(Number(data.total) / HISTORY_PAGE_SIZE)) {
    throw new Error("A origem devolveu um histórico incompleto. A recuperação foi interrompida.");
  }
  return { records: data.records, total: Number(data.total), pages: Number(data.pages) };
}
export function readHistoryMessage(raw: unknown, externalId: string, since: Date, until: Date): HistoryReadResult {
  const row = object(raw);
  const key = object(row?.key);
  if (!row || typeof row.id !== "string" || !row.id || !key || typeof key.id !== "string" || !key.id || typeof key.fromMe !== "boolean") return { skipped: "invalid" };
  const timestamp = typeof row.messageTimestamp === "number" ||
    (typeof row.messageTimestamp === "string" && /^\d+$/.test(row.messageTimestamp)) ? Number(row.messageTimestamp) : NaN;
  const at = new Date(timestamp * 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || Number.isNaN(at.getTime())) return { skipped: "invalid" };
  if (at < since || at > until) return { skipped: "outsideWindow" };
  const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return { skipped: "ignored" };
  const provider = new EvolutionProvider();
  let incoming = provider.parseWebhook({ instance: externalId, data: row });
  let content = object(row.message);
  for (let depth = 0; object(content?.ephemeralMessage) && depth < 5; depth++) content = object(object(content?.ephemeralMessage)?.message);
  if (incoming?.isReaction || content?.protocolMessage || content?.reactionMessage) return { skipped: "ignored" };
  let mediaWithoutFile = Boolean(incoming?.hasAudio);
  if (!incoming) {
    const attachments = [
      ["imageMessage", "Imagem"], ["videoMessage", "Vídeo"], ["documentMessage", "Documento"],
      ["stickerMessage", "Figurinha"], ["contactMessage", "Contato compartilhado"], ["locationMessage", "Localização"],
    ];
    const attachment = attachments.find(([kind]) => object(content?.[kind]));
    if (attachment) {
      const media = object(content?.[attachment[0]]);
      const caption = typeof media?.caption === "string" ? media.caption : "";
      incoming = provider.parseWebhook({ instance: externalId, data: { ...row, message: { conversation: `[${attachment[1]}]${caption ? ` ${caption}` : ""}` } } });
      mediaWithoutFile = true;
    }
  }
  if (!incoming) {
    // Se nem um texto sintético resolve o endereço, falta telefone, não conteúdo.
    const address = provider.parseWebhook({ instance: externalId, data: { ...row, message: { conversation: "endereço" } } });
    return { skipped: address ? "unsupported" : "unresolvedPhone" };
  }
  return { message: { sourceId: row.id, id: key.id, phone: incoming.fromPhone, name: incoming.fromName,
    text: incoming.hasAudio ? UNTRANSCRIBED_AUDIO : incoming.text, fromMe: key.fromMe,
    at, audioSeconds: incoming.audioSeconds, mediaWithoutFile } };
}
