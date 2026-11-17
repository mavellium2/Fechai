import { broadcastMetaErrorCode } from "./meta-failure";

type Attempt = {
  status: string;
  isTest: boolean;
  sentAt: Date | null;
  whatsappMessageId: string | null;
  attemptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  repliedAt: Date | null;
  deliveryStatus: string | null;
  deliveryFailedAt: Date | null;
  error: string | null;
  deliveryError: string | null;
};

// Bloqueio/opt-out da Meta, ou falha que exige mudar o destinatário ou mensagem.
const DO_NOT_REPEAT = new Set([130403, 130472, 131021, 131050, 132000, 132012, 132016]);

/** Só uma falha confirmada pode ser selecionada para um novo disparo manual. */
export function canRepeatBroadcastAttempt(r: Attempt, now = new Date()): boolean {
  if (r.isTest || r.repliedAt || r.deliveredAt || r.readAt ||
      r.deliveryStatus === "delivered" || r.deliveryStatus === "read") return false;
  const delivery = r.status === "sent" && r.deliveryStatus === "failed" && Boolean(r.whatsappMessageId);
  const rejected = r.status === "failed" && !r.sentAt && !r.whatsappMessageId;
  if (!delivery && !rejected) return false;
  const error = delivery ? r.deliveryError : r.error;
  const code = broadcastMetaErrorCode(error);
  if (code !== null && DO_NOT_REPEAT.has(code)) return false;
  if (error?.startsWith("Falta o arquivo do topo")) return false;
  if (code === 131049) {
    const failedAt = delivery ? r.deliveryFailedAt : r.attemptedAt;
    return Boolean(failedAt && now.getTime() - failedAt.getTime() >= 24 * 60 * 60_000);
  }
  return true;
}
