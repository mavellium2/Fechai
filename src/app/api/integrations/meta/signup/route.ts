import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import {
  requireSignupConfig,
  SignupError,
} from "@/modules/whatsapp/embedded-signup-graph";
import {
  startEmbeddedSignup,
  authorizeEmbeddedSignup,
  finishEmbeddedSignup,
} from "@/modules/whatsapp/embedded-signup";

export const runtime = "nodejs";
const attemptId = z.string().regex(/^[\w-]{43}$/);
const assetId = z.string().regex(/^\d{5,30}$/);
const inputSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("start") }),
  z.object({
    step: z.literal("authorize"),
    attemptId,
    code: z.string().min(10).max(8192),
  }),
  z.object({
    step: z.literal("finish"),
    attemptId,
    wabaId: assetId,
    phoneNumberId: assetId.optional(),
  }),
]);
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    const config = requireSignupConfig();
    // Não confiar em Host/X-Forwarded-Host para autorizar mutações com cookie.
    if (
      req.headers.get("origin") !== config.origin ||
      !req.headers.get("content-type")?.startsWith("application/json")
    )
      return reply({ error: "Origem da solicitação inválida." }, 403);
    const { session, tenantId } = await requireTenant();
    const [tenant, user] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { status: true, metaWhatsappEnabled: true },
      }),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { usesProduct: true, tenantId: true },
      }),
    ]);
    if (
      !user?.usesProduct ||
      user.tenantId !== tenantId ||
      !tenant?.metaWhatsappEnabled ||
      tenant.status !== "active"
    )
      return reply(
        { error: "A conexão oficial não está liberada para esta conta." },
        403,
      );
    const limited = await rateLimit(
      "meta-signup",
      `${tenantId}:${session.user.id}`,
      40,
      900,
    );
    if (!limited.allowed)
      return reply(
        { error: "Aguarde alguns minutos antes de tentar novamente." },
        429,
      );
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 16_384)
      return reply({ error: "Solicitação inválida." }, 413);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return reply({ error: "Solicitação inválida." }, 422);
    }
    const parsed = inputSchema.safeParse(json);
    if (!parsed.success)
      return reply(
        { error: "A autorização está incompleta. Recomece a conexão." },
        422,
      );
    const input = parsed.data,
      actor = { tenantId, userId: session.user.id };
    if (input.step === "start")
      return reply({ ok: true, ...(await startEmbeddedSignup(actor)) });
    if (input.step === "authorize")
      await authorizeEmbeddedSignup(actor, input.attemptId, input.code);
    else {
      await finishEmbeddedSignup(actor, input.attemptId, input);
      revalidatePath("/integracoes");
      revalidatePath("/inicio");
    }
    return reply({
      ok: true,
      ...(input.step === "finish"
        ? {
            message:
              "WhatsApp conectado à API oficial. O aplicativo no celular continua disponível.",
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof SignupError)
      return reply({ error: error.message }, error.status);
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT"))
      return reply({ error: "Sua sessão expirou. Entre novamente." }, 401);
    // Nunca registrar token, código OAuth, URL da troca ou resposta da Graph API.
    console.error("[meta-signup] falha ao concluir solicitação");
    return reply(
      { error: "Não foi possível concluir a conexão. Tente novamente." },
      500,
    );
  }
}
