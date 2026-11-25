import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { runAgentTurn } from "@/modules/agent-engine/orchestrator";

// Endpoint público chamado pelo widget.js (scripts/widget-template.js) instalado
// no site do cliente — por isso CORS liberado e sem sessão/auth: quem prova
// identidade aqui é o tenantId da URL + o visitorId gerado pelo próprio script.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const bodySchema = z.object({
  visitorId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(2000),
});

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 20;

/**
 * Teto por IP, e por hora. O limite por `visitorId` abaixo continua valendo
 * para a experiência normal, mas sozinho ele não segura nada: o `visitorId` vem
 * no corpo da requisição, então basta gerar um novo a cada envio para zerar o
 * contador. Como cada mensagem processada é uma chamada paga de LLM, isso era
 * um caminho direto para esgotar a cota (e a conta) de qualquer tenant com
 * widget ativo — o tenantId está no widget.js público de cada site cliente.
 *
 * O IP vem do proxy e o visitante não escolhe qual manda.
 */
const IP_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const IP_RATE_LIMIT_MAX = 120;

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "desconhecido"
  );
}

async function isRateLimited(tenantId: string, visitorId: string): Promise<boolean> {
  const key = `widget-rl:${tenantId}:${visitorId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  return count > RATE_LIMIT_MAX;
}

async function isIpRateLimited(tenantId: string, ip: string): Promise<boolean> {
  const key = `widget-rl-ip:${tenantId}:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, IP_RATE_LIMIT_WINDOW_SECONDS);
  return count > IP_RATE_LIMIT_MAX;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400, headers: CORS_HEADERS });
  }
  const { visitorId, message } = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true, widgetEnabled: true },
  });
  if (!tenant || tenant.status !== "active" || !tenant.widgetEnabled) {
    return NextResponse.json({ error: "Atendimento indisponível" }, { status: 404, headers: CORS_HEADERS });
  }

  // Camada que o cliente não contorna trocando de visitorId.
  if (await isIpRateLimited(tenantId, clientIp(request))) {
    return NextResponse.json(
      { error: "Muitas mensagens em pouco tempo. Tente novamente mais tarde." },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  if (await isRateLimited(tenantId, visitorId)) {
    return NextResponse.json(
      { error: "Muitas mensagens em pouco tempo. Aguarde um instante." },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  try {
    // Visitante do site vira um Lead como outro qualquer — só o "telefone" é
    // sintético (não é WhatsApp). Mesmo padrão que o sandbox usa (ver /api/sandbox).
    const { lead, conversation } = await getOrCreateConversation(tenantId, `web:${visitorId}`, undefined, { originChannel: "widget" });
    const { reply, status } = await runAgentTurn({
      tenantId,
      conversationId: conversation.id,
      leadId: lead.id,
      agentId: conversation.agentId ?? undefined,
      userMessage: message,
    });

    // Agente desligado: o visitante não pode ficar olhando para o vazio, então
    // aqui (diferente do WhatsApp) o widget diz que ninguém está atendendo. A
    // mensagem dele já foi registrada e a conversa está marcada para um humano.
    if (status !== "ok" || !reply) {
      return NextResponse.json(
        {
          reply:
            status === "limit_reached"
              ? "Nosso atendimento automático está indisponível no momento. Sua mensagem foi registrada e alguém responde em breve."
              : "Nosso atendimento automático está pausado no momento. Sua mensagem foi registrada e alguém responde em breve.",
        },
        { headers: CORS_HEADERS },
      );
    }

    return NextResponse.json({ reply }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[widget/message]", err);
    return NextResponse.json(
      { error: "Não consegui responder agora." },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
