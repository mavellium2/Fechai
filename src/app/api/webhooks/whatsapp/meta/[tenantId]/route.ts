import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  readMetaWebhookSecrets,
  verifyMetaWebhookSignature,
  WHATSAPP_PROVIDER_SELECT,
} from "@/modules/whatsapp/meta-config";
import { handleMetaWebhook } from "@/modules/whatsapp/meta-webhook-handler";

function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function metaInstance(tenantId: string) {
  return prisma.whatsappInstance.findFirst({
    where: {
      tenantId,
      provider: "meta",
      tenant: { metaWhatsappEnabled: true },
    },
    select: { status: true, ...WHATSAPP_PROVIDER_SELECT },
  });
}

/** Handshake que a Meta faz ao salvar a Callback URL no painel do app. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  const query = new URL(req.url).searchParams;
  const mode = query.get("hub.mode") ?? "";
  const received = query.get("hub.verify_token") ?? "";
  const challenge = query.get("hub.challenge") ?? "";
  const instance = await metaInstance(tenantId);
  if (!instance) return new Response("Not found", { status: 404 });

  const { verifyToken } = readMetaWebhookSecrets(instance);
  if (
    mode !== "subscribe" ||
    !verifyToken ||
    !sameSecret(received, verifyToken)
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/** Eventos assinados com o App Secret da conta Meta deste tenant. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  const instance = await metaInstance(tenantId);
  if (!instance) {
    return NextResponse.json({
      ignored: "instância desconhecida ou desconectada",
    });
  }

  const rawBody = await req.text();
  const { appSecret } = readMetaWebhookSecrets(instance);
  if (
    !appSecret ||
    !verifyMetaWebhookSignature(
      rawBody,
      req.headers.get("x-hub-signature-256"),
      appSecret,
    )
  ) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  const payload = (() => {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return null;
    }
  })();
  const result = await handleMetaWebhook(tenantId, instance, payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
