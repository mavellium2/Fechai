import Link from "next/link";
import { MessagesSquare, Inbox } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ConversationsWorkspace } from "./ConversationsWorkspace";
import { ContactPanel } from "./ContactPanel";
import { EmptyState } from "@/components/ui/empty-state";

import { ConversationList } from "./ConversationList";
import { ConversationSearch } from "./ConversationSearch";
import { ConversationFilters } from "./ConversationFilters";
import { isFishAudioConfigured } from "@/modules/voice/fish";
import { ConversationThread } from "./ConversationThread";


import { SandboxDialog } from "./SandboxDialog";
import { parseConversationVariables, parseVariableDefinitions, withContactDefaults } from "@/modules/agent-engine/variables";

/** Tamanho do lote. "Carregar mais" soma outro. */
const PAGE_SIZE = 30;

export default async function ConversasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; id?: string; q?: string; agent?: string; take?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { status = "all", id, q = "", agent: agentId = "", take: takeParam } = await searchParams;

  const search = q.trim();
  // Teto no `take`: a URL é editável, e um `take=100000` viraria uma consulta
  // aberta ao banco.
  const take = Math.min(Math.max(Number(takeParam) || PAGE_SIZE, PAGE_SIZE), 300);

  // A aba "Testes" é o único lugar da tela que quer `isTest: true` — todo o
  // resto (inclusive "Todos") continua mostrando só conversas de clientes de
  // verdade, senão o chat de teste disputaria espaço com atendimento real.
  const isTestTab = status === "test";

  const leadWhere: Prisma.LeadWhereInput = {};
  if (!isTestTab && status !== "all" && status !== "needs_human") leadWhere.status = status;
  if (search) {
    leadWhere.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  const where: Prisma.ConversationWhereInput = { tenantId, isTest: isTestTab };
  if (status === "needs_human") where.needsHuman = true;
  if (agentId) where.agentId = agentId;
  if (Object.keys(leadWhere).length > 0) where.lead = leadWhere;

  const [conversations, matching, totalAll, needsHumanCount, testCount, selected, agents] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      // +1 revela se ainda há próxima página sem uma segunda contagem
      take: take + 1,
      include: {
        lead: true,
        agent: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.conversation.count({ where }),
    prisma.conversation.count({ where: { tenantId, isTest: false } }),
    prisma.conversation.count({ where: { tenantId, isTest: false, needsHuman: true } }),
    prisma.conversation.count({ where: { tenantId, isTest: true } }),
    id
      ? prisma.conversation.findFirst({
          where: { id, tenantId },
          include: {
            lead: true,
            // `voiceId` vem junto do nome (mesma query) para o composer saber se
            // pode oferecer os botões de voz — ver `voiceReady` abaixo.
            agent: { select: { name: true, enabled: true, archived: true, voiceId: true, variableDefinitions: true } },
            messages: { orderBy: { createdAt: "asc" } },
            // A pesquisa de satisfação não é mensagem: vira um cartão na linha do tempo.
            satisfactionSurveys: {
              where: { status: { in: ["sending", "awaiting_rating", "awaiting_comment", "completed", "no_reply", "unknown"] } },
              orderBy: { sentAt: "desc" },
              take: 1,
              select: { status: true, sentAt: true, rating: true, comment: true, commentAudioUrl: true, isTest: true },
            },
            _count: { select: { messages: true } },
          },
        })
      : null,
    prisma.agent.findMany({ where: { tenantId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const hasMore = conversations.length > take;
  const page = hasMore ? conversations.slice(0, take) : conversations;

  const params = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ status });
    if (search) p.set("q", search);
    if (agentId) p.set("agent", agentId);
    if (take !== PAGE_SIZE) p.set("take", String(take));
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) p.delete(k);
      else p.set(k, v);
    }
    return `/conversas?${p}`;
  };

  const emptyAccount = totalAll === 0;

  /**
   * O composer só oferece voz se ela existir de verdade: instalação com chave da
   * Fish Audio E o agente desta conversa com voz gravada.
   *
   * Conversa sem `agentId` (as antigas, e as que nasceram antes de haver mais de
   * um agente) cai no principal da conta — a mesma regra que `resolveAgent` usa
   * no envio, para a tela não prometer o que a action vai recusar.
   */
  let voiceReady = false;
  const fallbackAgent = selected && !selected.agent
    ? await prisma.agent.findFirst({
        where: { tenantId, archived: false },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { variableDefinitions: true, voiceId: true },
      })
    : null;
  if (selected && isFishAudioConfigured()) {
    if (selected.agent) {
      voiceReady = Boolean(selected.agent.voiceId);
    } else {
      voiceReady = Boolean(fallbackAgent?.voiceId);
    }
  }

  const detail = selected
    ? {
        data: {
          id: selected.id,
          needsHuman: selected.needsHuman,
          isTest: selected.isTest,
          agentPaused: selected.agentPaused,
          followUpSentAt: selected.followUpSentAt,
          updatedAt: selected.updatedAt,
          agent: selected.agent,
          lead: selected.lead,
          messageCount: selected._count.messages,
          summary: selected.summary,
          summaryAt: selected.summaryAt,
          summaryMsgCount: selected.summaryMsgCount,
          variableDefinitions: parseVariableDefinitions(selected.agent?.variableDefinitions ?? fallbackAgent?.variableDefinitions),
          variables: withContactDefaults(parseConversationVariables(selected.variables), selected.lead),
        },
        messages: selected.messages,
        survey: selected.satisfactionSurveys[0] ?? null,
      }
    : null;

  const appointment = selected && !selected.isTest ? await prisma.appointment.findFirst({ where: { tenantId, leadId: selected.leadId, status: "scheduled", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, select: { title: true, startsAt: true } }) : null;
  return <ConversationsWorkspace selected={Boolean(id)} sidebar={<>
    <header className="conversation-list-heading"><h1>Conversas</h1><SandboxDialog /></header>
    <div className="conversation-list-controls"><ConversationSearch status={status} q={search} agentId={agentId} /><ConversationFilters status={status} search={search} agentId={agentId} agents={agents} counts={{ all: totalAll, needsHuman: needsHumanCount, test: testCount }} /></div>
    <div className="conversation-list-scroll">{page.length ? <ConversationList items={page.map(c => ({ id: c.id, needsHuman: c.needsHuman, agentPaused: c.agentPaused, isTest: c.isTest, updatedAt: c.updatedAt, lead: c.lead, agentName: c.agent?.name, preview: c.messages[0]?.content ?? null }))} selectedId={id} hrefFor={cid => params({ id: cid })} moreHref={hasMore ? params({ take: String(take + PAGE_SIZE) }) : null} /> : <EmptyState icon={MessagesSquare} title={emptyAccount ? "Nenhuma conversa ainda" : "Nenhuma conversa com este filtro"} description={emptyAccount ? "Quando um contato escrever, a conversa aparecerá aqui." : "Ajuste a busca ou veja todas as conversas."} action={<Link href="/conversas?status=all">Ver todas</Link>} />}</div>
    <footer className="conversation-list-footer">{status === "needs_human" ? `${matching} conversas aguardando a equipe` : `${Math.min(page.length, matching)} de ${matching} conversas`}</footer>
  </>} thread={detail ? <ConversationThread conversation={detail.data} messages={detail.messages} survey={detail.survey} backHref={params({ id: undefined })} voiceReady={voiceReady} /> : <div className="conversation-empty"><EmptyState icon={Inbox} title={id ? "Conversa não encontrada" : "Escolha uma conversa"} description="Selecione um contato na lista para ler o histórico e continuar o atendimento." /></div>} contact={detail ? <ContactPanel conversation={detail.data} appointment={appointment} /> : <p className="agent-help">Ao abrir uma conversa, os dados do contato aparecem aqui.</p>} />;
}
