import Link from "next/link";
import { MessagesSquare, Inbox } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ConversationList } from "./ConversationList";
import { ConversationSearch } from "./ConversationSearch";
import { ConversationFilters } from "./ConversationFilters";
import { isFishAudioConfigured } from "@/modules/voice/fish";
import { ConversationThread } from "./ConversationThread";
import { LeadPanel } from "./LeadPanel";
import { ConversationVariables } from "./ConversationVariables";
import { SandboxDialog } from "./SandboxDialog";
import { parseConversationVariables, parseVariableDefinitions, withContactDefaults } from "@/modules/agent-engine/variables";

/** Tamanho do lote. "Carregar mais" soma outro. */
const PAGE_SIZE = 30;

export default async function ConversasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; id?: string; q?: string; take?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { status = "all", id, q = "", take: takeParam } = await searchParams;

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
  if (Object.keys(leadWhere).length > 0) where.lead = leadWhere;

  const [conversations, matching, totalAll, needsHumanCount, testCount, selected] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      // +1 revela se ainda há próxima página sem uma segunda contagem
      take: take + 1,
      include: {
        lead: true,
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
  ]);

  const hasMore = conversations.length > take;
  const page = hasMore ? conversations.slice(0, take) : conversations;

  const params = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ status });
    if (search) p.set("q", search);
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

  return (
    // `flex-1 min-h-0`: a casca (PanelShell) já fixa a altura da viewport; aqui a
    // página passa a ocupá-la para que cada painel role sozinho, como em qualquer
    // caixa de entrada. Antes a página inteira rolava e o cabeçalho da conversa
    // saía de vista.
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        eyebrow="conversas"
        title="Conversas"
        description="Veja o que seu agente andou respondendo — e onde ele precisa da sua ajuda."
        actions={<SandboxDialog />}
      />

      {/* `grid-rows-[minmax(0,1fr)]`: sem `grid-template-rows`, a única linha
          implícita é `auto` — em vez de esticar pra ocupar a altura que o
          `flex-1` reservou, ela pode ficar do tamanho do conteúdo (mesmo
          "trap" do `min-height:auto`, só que na trilha do grid, não no item).
          Declarando a linha como `minmax(0, 1fr)` ela vira exatamente a altura
          disponível, com piso 0 — os Cards (cada um já com `min-h-0`) então
          recebem uma altura real pra rolar dentro. */}
      <div className="grid min-h-[30rem] flex-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_17rem]">
        <Card className={`flex min-h-0 flex-col p-0 ${id ? "hidden lg:flex" : "flex"}`}>
          <h2 className="sr-only">Lista de conversas</h2>

          <div className="space-y-3 border-b border-white/10 p-4">
            <ConversationSearch status={status} q={search} />
            <ConversationFilters
              status={status}
              search={search}
              counts={{ all: totalAll, needsHuman: needsHumanCount, test: testCount }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {page.length === 0 ? (
              <EmptyState
                icon={MessagesSquare}
                title={
                  emptyAccount
                    ? "Nenhuma conversa ainda"
                    : search
                      ? "Ninguém com esse nome ou número"
                      : "Nada com este filtro"
                }
                description={
                  emptyAccount
                    ? "Quando um cliente falar com seu agente, a conversa aparece aqui. Quer ver como funciona antes? Faça um teste."
                    : "Ajuste a busca ou veja a lista inteira."
                }
                action={
                  emptyAccount ? (
                    <SandboxDialog label="Fazer um teste" />
                  ) : (
                    <Link
                      href="/conversas?status=all"
                      className="rounded-control px-3 py-1 font-mono text-micro uppercase tracking-wide text-iris underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                    >
                      Ver todas
                    </Link>
                  )
                }
                className="py-10"
              />
            ) : (
              <ConversationList
                items={page.map((c) => ({
                  id: c.id,
                  needsHuman: c.needsHuman,
                  agentPaused: c.agentPaused,
                  isTest: c.isTest,
                  updatedAt: c.updatedAt,
                  lead: c.lead,
                  preview: c.messages[0]?.content ?? null,
                }))}
                selectedId={id}
                hrefFor={(cid) => params({ id: cid })}
                moreHref={hasMore ? params({ take: String(take + PAGE_SIZE) }) : null}
              />
            )}
          </div>

          {matching > 0 && (
            <p className="border-t border-white/10 px-4 py-2 font-mono text-micro uppercase tracking-wide text-white/40">
              {page.length} de {matching}
            </p>
          )}
        </Card>

        <Card className={`flex min-h-0 flex-col overflow-hidden p-0 ${id ? "flex" : "hidden lg:flex"}`}>
          {detail ? (
            <ConversationThread
              conversation={detail.data}
              messages={detail.messages}
              survey={detail.survey}
              backHref={params({ id: undefined })}
              voiceReady={voiceReady}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={Inbox}
                title={id ? "Conversa não encontrada" : "Escolha uma conversa"}
                description={
                  id
                    ? "Ela pode ter sido removida junto com o lead. Escolha outra na lista."
                    : "Toque em uma conversa da lista para ler tudo o que foi dito e ver o que fazer a seguir."
                }
              />
            </div>
          )}
        </Card>

        <Card className="hidden min-h-0 flex-col overflow-hidden p-0 xl:flex">
          <h2 className="sr-only">Dados do cliente</h2>
          {detail ? (
            <>
              <div className="shrink-0 border-b border-white/10 p-4">
                <ConversationVariables definitions={detail.data.variableDefinitions} values={detail.data.variables} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <LeadPanel conversation={detail.data} />
              </div>
            </>
          ) : (
            <p className="p-4 text-sm leading-relaxed text-white/50">
              Ao abrir uma conversa, aparecem aqui os dados do cliente, o histórico de atendimento
              e as ações disponíveis.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
