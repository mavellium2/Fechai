import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  readMetaWebhookSecrets,
  verifyMetaWebhookSignature,
  WHATSAPP_PROVIDER_SELECT,
} from "@/modules/whatsapp/meta-config";
import { handleMetaWebhook } from "@/modules/whatsapp/meta-webhook-handler";
import {
  isRepeatedCoexistenceRemoval,
  markCoexistenceRemoved,
} from "@/modules/whatsapp/coexistence-sync";

export const runtime = "nodejs";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function secrets() {
  return {
    appSecret: process.env.META_APP_SECRET?.trim(),
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN?.trim(),
  };
}
export async function GET(req: Request) {
  const expected = secrets().verifyToken,
    q = new URL(req.url).searchParams;
  const received = q.get("hub.verify_token") ?? "";
  if (
    !expected ||
    q.get("hub.mode") !== "subscribe" ||
    Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
    !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  )
    return new Response("Forbidden", { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

/** Callback do app parceiro: roteia pelo par WABA + Phone Number ID, nunca pelo browser. */
export async function POST(req: Request) {
  const raw = await req.text(),
    secret = secrets().appSecret;
  if (
    !secret ||
    !verifyMetaWebhookSignature(
      raw,
      req.headers.get("x-hub-signature-256"),
      secret,
    )
  )
    return Response.json({ error: "assinatura inválida" }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = object(JSON.parse(raw));
  } catch {
    return Response.json({ error: "evento inválido" }, { status: 400 });
  }
  if (payload.object !== "whatsapp_business_account")
    return Response.json({ ok: true });
  let failed = false;
  for (const rawEntry of array(payload.entry)) {
    const entry = object(rawEntry),
      wabaId = typeof entry.id === "string" ? entry.id : "";
    if (!/^\d{5,30}$/.test(wabaId)) continue;
    const rows = await prisma.whatsappInstance.findMany({
      where: {
        provider: "meta",
        metaBusinessAccountId: wabaId,
        tenant: { metaWhatsappEnabled: true, status: "active" },
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        metaDisplayPhone: true,
        metaCoexistenceSync: true,
        ...WHATSAPP_PROVIDER_SELECT,
      },
    });
    for (const instance of rows) {
      // Não usar credenciais de um app diferente para um evento deste app parceiro.
      if (readMetaWebhookSecrets(instance).appSecret !== secret) continue;
      const changes = array(entry.changes).map(object);
      const disconnected =
        !isRepeatedCoexistenceRemoval(
          instance.metaCoexistenceSync,
          entry.time,
        ) &&
        changes.some((change) => {
          if (change.field !== "account_update") return false;
          const value = object(change.value);
          if (
            !["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED"].includes(
              String(value.event),
            )
          )
            return false;
          const phone =
            typeof value.phone_number === "string"
              ? value.phone_number.replace(/\D/g, "")
              : "";
          return (
            !phone || phone === instance.metaDisplayPhone?.replace(/\D/g, "")
          );
        });
      try {
        if (disconnected) {
          const removedSync = markCoexistenceRemoved(
            instance.metaCoexistenceSync,
            entry.time,
          );
          await prisma.whatsappInstance.update({
            where: { id: instance.id },
            data: {
              status: "disconnected",
              ...(removedSync
                ? {
                    metaCoexistenceSync:
                      removedSync as unknown as Prisma.InputJsonValue,
                  }
                : {}),
            },
          });
          instance.status = "disconnected";
        }
        // History e contatos são reconhecidos, sem importar nem acionar o agente.
        const scoped = changes.filter(
          (c) =>
            ["messages", "smb_message_echoes"].includes(String(c.field)) &&
            object(object(c.value).metadata).phone_number_id ===
              instance.metaPhoneNumberId,
        );
        const result = await handleMetaWebhook(instance.tenantId, instance, {
          object: payload.object,
          entry: [{ id: wabaId, changes: scoped }],
        });
        if (!result.ok) failed = true;
      } catch {
        failed = true;
      }
    }
  }
  return Response.json({ ok: !failed }, { status: failed ? 500 : 200 });
}
