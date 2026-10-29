import type { IncomingMessage } from "./provider";
import { extractMetaAdOrigin } from "./ad-origin";

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? v : "");
function timestamp(v: unknown): Date | undefined {
  const seconds = Number(v);
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) && seconds > 0 ? date : undefined;
}
function values(payload: unknown, field = "messages") {
  const p = object(payload);
  if (p.object !== "whatsapp_business_account") return [];
  return array(p.entry)
    .flatMap((e) => array(object(e).changes))
    .map(object)
    .filter((c) => c.field === field)
    .map((c) => object(c.value));
}

/** Cada mudança tem seu remetente e seus contatos; não misturar tenants do lote. */
export function parseMetaMessages(payload: unknown): IncomingMessage[] {
  return [...liveMessages(payload), ...parseMetaAppEchoes(payload)];
}

function liveMessages(payload: unknown): IncomingMessage[] {
  return values(payload).flatMap((value) => {
    const instanceExternalId = text(object(value.metadata).phone_number_id);
    return array(value.messages).flatMap((raw) => {
      const m = object(raw),
        fromPhone = text(m.from),
        messageKeyId = text(m.id);
      const hasAudio = m.type === "audio" && Boolean(text(object(m.audio).id));
      const isReaction = m.type === "reaction";
      // Resposta a lista/botão: o título vira o texto (o resto do fluxo o trata
      // como mensagem comum) e o id da opção segue à parte.
      const choice = m.type === "interactive" ? interactiveChoice(m.interactive) : null;
      const content = isReaction
        ? text(object(m.reaction).emoji)
        : choice?.title ?? text(object(m.text).body);
      if (
        !instanceExternalId ||
        !fromPhone ||
        !messageKeyId ||
        (!content && !hasAudio)
      )
        return [];
      const contact = array(value.contacts)
        .map(object)
        .find((c) => c.wa_id === fromPhone);
      const adOrigin = extractMetaAdOrigin(m.referral);
      return [
        {
          ...(adOrigin ? { adOrigin } : {}),
          instanceExternalId,
          fromPhone,
          messageKeyId,
          fromName: text(object(contact?.profile).name) || undefined,
          text: content,
          hasAudio,
          isReaction,
          isGroup: false,
          isFromMe: false,
          mediaId: text(object(m.audio).id) || undefined,
          occurredAt: timestamp(m.timestamp),
          ...(choice?.id ? { replyId: choice.id } : {}),
        },
      ];
    });
  });
}

/** `interactive.list_reply` / `button_reply`: id e título da opção escolhida. */
function interactiveChoice(raw: unknown): { id: string; title: string } | null {
  const i = object(raw);
  const reply = object(i.type === "list_reply" ? i.list_reply : i.type === "button_reply" ? i.button_reply : null);
  const id = text(reply.id),
    title = text(reply.title);
  return id && title ? { id, title } : null;
}

/** Mensagem nova escrita no celular pela equipe; nunca é fala de um lead. */
export function parseMetaAppEchoes(payload: unknown): IncomingMessage[] {
  return values(payload, "smb_message_echoes").flatMap(value => {
    const phone = text(object(value.metadata).phone_number_id);
    return array(value.message_echoes).flatMap(raw => {
      const m = object(raw), to = text(m.to), messageId = text(m.id);
      const hasAudio = m.type === "audio" && Boolean(text(object(m.audio).id));
      const isReaction = m.type === "reaction";
      const content = isReaction ? text(object(m.reaction).emoji) : text(object(m.text).body);
      if (!phone || !to || !messageId || (!content && !hasAudio)) return [];
      return [{ instanceExternalId: phone, fromPhone: to, messageKeyId: messageId,
        text: content, isGroup: false, isFromMe: true, isReaction, hasAudio,
        mediaId: text(object(m.audio).id) || undefined, occurredAt: timestamp(m.timestamp) }];
    });
  });
}

export type MetaDeliveryReceipt = {
  messageId: string;
  phoneNumberId: string;
  recipientPhone: string;
  status: "sent" | "delivered" | "read" | "failed";
  occurredAt: Date;
  error: string | null;
};
export function parseMetaStatuses(payload: unknown): MetaDeliveryReceipt[] {
  return values(payload).flatMap((value) =>
    array(value.statuses).flatMap((raw) => {
      const s = object(raw),
        status = text(s.status),
        occurredAt = timestamp(s.timestamp);
      const messageId = text(s.id),
        recipientPhone = text(s.recipient_id);
      const phoneNumberId = text(object(value.metadata).phone_number_id);
      if (
        !messageId ||
        !recipientPhone ||
        !phoneNumberId ||
        !occurredAt ||
        !["sent", "delivered", "read", "failed"].includes(status)
      )
        return [];
      const code = object(array(s.errors)[0]).code;
      return [
        {
          messageId,
          phoneNumberId,
          recipientPhone,
          status: status as MetaDeliveryReceipt["status"],
          occurredAt,
          error:
            status === "failed"
              ? `Falha de entrega informada pela Meta${typeof code === "number" ? ` (código ${code})` : ""}.`
              : null,
        },
      ];
    }),
  );
}
