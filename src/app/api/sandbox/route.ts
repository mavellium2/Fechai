import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sandboxDraftSchema } from "@/modules/agent-engine/sandbox-draft";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateConversation,
  startFreshTestConversation,
} from "@/modules/agent-engine/conversation";
import { runAgentTurn } from "@/modules/agent-engine/orchestrator";

/**
 * Telefone sintético do chat de teste. Um por agente (`sandbox:<id>`) para
 * testar dois agentes não misturar o histórico dos dois no mesmo contexto.
 * Sem agente escolhido, cai no valor legado — é a linha que as contas antigas
 * já têm no banco.
 */
function sandboxPhone(agentId?: string) {
  return agentId ? `sandbox:${agentId}` : "sandbox";
}

const schema = z.object({
  message: z.string().trim().min(1).max(4000),
  agentId: z.string().trim().min(1).optional(),
  sessionId: z.string().uuid().optional(),
  draft: sandboxDraftSchema.optional(),
  compare: z.boolean().optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(10_000) })).max(10).optional(),
});

/** Garante que o agente é da conta antes de usá-lo (id vem do cliente). */
async function ownedAgentId(tenantId: string, agentId?: string) {
  if (!agentId) return undefined;
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId, archived: false },
    select: { id: true },
  });
  return agent?.id;
}

// Chat de teste no dashboard: roda o mesmo motor sem WhatsApp real.
// O lead/conversa criados aqui nascem com `isTest`, então não entram em
// Contatos nem nos relatórios (antes o teste virava lead de verdade) — mas
// ficam visíveis em Conversas, na aba "Testes".
export async function POST(req: Request) {
  const { tenantId } = await requireTenant();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  }

  const agentId = await ownedAgentId(tenantId, parsed.data.agentId);
  if (parsed.data.agentId && !agentId) return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });
  if (parsed.data.draft) {
    const doc = await prisma.knowledgeDocument.findFirst({ where: { id: parsed.data.draft.documentId, tenantId, agentId }, select: { id: true } });
    if (!agentId || !doc) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  }
  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    parsed.data.compare ? `sandbox:${agentId}:comparison:${randomUUID()}` : parsed.data.sessionId ? `${sandboxPhone(agentId)}:session:${parsed.data.sessionId}` : sandboxPhone(agentId),
    "Chat de teste",
    { isTest: true },
  );

  try {
  const { reply, toolsUsed, status, inspection } = await runAgentTurn({
    tenantId,
    conversationId: conversation.id,
    leadId: lead.id,
    userMessage: parsed.data.message,
    agentId,
    // Teste não é atendimento: o sandbox segue respondendo mesmo com a cota do
    // mês esgotada, para o dono conseguir testar/diagnosticar o agente.
    skipUsageCheck: true,
    // ...e mesmo com a chave geral desligada. Desligar cala o agente para o
    // cliente (WhatsApp, widget); aqui é o dono falando com o próprio agente,
    // justamente para ajustar antes de religar.
    skipEnabledCheck: true,
    // Teste não pode ocupar a agenda real nem espelhar no Clinicorp/Google/iCloud.
    dryRunScheduling: true,
    inspect: true,
    ...(parsed.data.draft ? { sandboxDraft: parsed.data.draft } : {}),
    ...(parsed.data.compare ? { historyOverride: parsed.data.history ?? [] } : {}),
  });

  return NextResponse.json({ reply, toolsUsed, status, inspection });
  } catch (error) {
    console.error("[sandbox] test failed", error);
    return NextResponse.json({ error: "Não foi possível executar o teste. Verifique a configuração de IA e tente novamente." }, { status: 503 });
  }
}

/**
 * Botão "recomeçar" do sandbox: arquiva o teste atual (fica salvo, visível em
 * Conversas) e libera o telefone canônico do sandbox para nascer vazio na
 * próxima mensagem — a IA não recomeça vendo o histórico do teste anterior.
 */
export async function DELETE(req: Request) {
  const { tenantId } = await requireTenant();
  const agentId = await ownedAgentId(
    tenantId,
    new URL(req.url).searchParams.get("agentId") ?? undefined,
  );
  if (new URL(req.url).searchParams.has("agentId") && !agentId) return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });
  const session = new URL(req.url).searchParams.get("sessionId");
  if (session && !z.string().uuid().safeParse(session).success) return NextResponse.json({ error: "Teste inválido." }, { status: 400 });
  await startFreshTestConversation(tenantId, session ? `${sandboxPhone(agentId)}:session:${session}` : sandboxPhone(agentId));
  return NextResponse.json({ ok: true });
}
