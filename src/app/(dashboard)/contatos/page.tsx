import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { UsersRound, UserPlus, MessageSquare } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import { isReadyChannel, listWhatsappChannels } from "@/modules/whatsapp/instances";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ContatoSearch } from "./ContatoSearch";
import { AddContactDialog } from "./AddContactDialog";
import { SendMessageDialog, type ContactRef } from "./SendMessageDialog";
import { EditContactDialog } from "./EditContactDialog";
import { contactProfileData } from "@/modules/crm/contact-profile";

export const metadata: Metadata = { title: "Contatos" };

type StatusTone = "neutral" | "iris" | "signal" | "success" | "warn" | "danger";

const STATUS_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  new: { label: "novo", tone: "neutral" },
  warm: { label: "morno", tone: "iris" },
  hot: { label: "quente", tone: "signal" },
  scheduled: { label: "agendado", tone: "success" },
  lost: { label: "perdido", tone: "neutral" },
};

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { q = "" } = await searchParams;
  const search = q.trim();

  // O contato "Sandbox" aparecia na lista como se fosse cliente — e podia até
  // receber mensagem. Contatos de teste ficam de fora daqui.
  const where: Prisma.LeadWhereInput = { tenantId, isTest: false };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  const [leads, channels, recentConvs] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { conversation: { updatedAt: "desc" } },
      include: {
        conversation: {
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
            agent: { select: { tenantId: true, variableDefinitions: true } },
          },
        },
      },
    }),
    listWhatsappChannels(tenantId),
    // Sugestões: as 3 conversas mais recentes (com número real) para continuar.
    prisma.conversation.findMany({
      where: { tenantId, isTest: false },
      orderBy: { updatedAt: "desc" },
      take: 3,
      include: {
        lead: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  // Qualquer conexão de pé serve para a tela liberar o envio: por qual delas a
  // mensagem sai é decidido por contato, em `sendManualReply`.
  const connected = channels.some(
    (c) => isReadyChannel(c) && getWhatsAppProviderForInstance(c).isConfigured(),
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        eyebrow="contatos"
        title="Contatos"
        hint="Quem já falou com seu agente — e qualquer número que você quiser adicionar para mandar uma mensagem."
        actions={<AddContactDialog />}
      />

      {!connected && (
        <Alert tone="warn">
          WhatsApp não conectado. Conecte na tela{" "}
          <span className="font-mono uppercase">WhatsApp</span> para enviar mensagens.
        </Alert>
      )}

      {recentConvs.length > 0 && (
        <section aria-label="Conversas recentes">
          <h2 className="font-display flex items-center gap-1.5 text-lg font-semibold text-ink panel:text-white">
            Continuar conversa
            <InfoHint label="continuar conversa">
              Os últimos contatos que conversaram com você — mande uma mensagem ou abra a conversa.
            </InfoHint>
          </h2>
          <div className="mt-3 grid gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {recentConvs.map((conv) => {
              const lead = conv.lead;
              const last = conv.messages[0];
              const contact: ContactRef = {
                id: lead.id,
                name: lead.name ?? "",
                phone: lead.phone,
                isSandbox: lead.isTest,
              };
              return (
                <Card key={conv.id} className="flex flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold text-ink panel:text-white">
                      {lead.name || "Sem nome"}
                    </p>
                    <p className="mt-0.5 font-mono text-micro text-neutral panel:text-white/50">
                      {lead.phone}
                    </p>
                  </div>
                  {conv.summary ? (
                    // O resumo ganha do "última mensagem" quando existe: numa
                    // conversa longa, a última mensagem sozinha ("ok, obrigado")
                    // não diz nada sobre o que o cliente quer.
                    <div>
                      <p className="font-mono text-micro uppercase tracking-[0.15em] text-neutral panel:text-white/50">
                        Resumo
                      </p>
                      <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm leading-snug text-neutral panel:text-white/60">
                        {conv.summary}
                      </p>
                    </div>
                  ) : (
                    last && (
                      <p className="line-clamp-2 text-sm leading-snug text-neutral panel:text-white/60">
                        {last.content}
                      </p>
                    )
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <ButtonLink variant="outline" size="sm" href={`/conversas?id=${conv.id}`}>
                      <MessageSquare size={14} aria-hidden />
                      Conversar
                    </ButtonLink>
                    <SendMessageDialog contact={contact} canSend={connected} />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <Card className="flex min-h-0 flex-col p-0">
        <div className="space-y-3 border-b border-ink/10 p-4 panel:border-white/10">
          <ContatoSearch q={search} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {leads.length === 0 ? (
            <EmptyState
              icon={search ? UsersRound : UserPlus}
              title={search ? "Ninguém com esse nome ou número" : "Nenhum contato ainda"}
              description={
                search
                  ? "Ajuste a busca para achar o contato, ou adicione um número novo."
                  : "Quando um cliente falar com seu agente, ele aparece aqui. Você também pode adicionar um número para mandar a primeira mensagem."
              }
              action={search ? undefined : <AddContactDialog label="Adicionar o primeiro contato" />}
              className="py-10"
            />
          ) : (
            <ul className="divide-y divide-ink/5 panel:divide-white/10">
              {leads.map((lead) => {
                const status = STATUS_LABEL[lead.status] ?? { label: lead.status, tone: "neutral" as const };
                const last = lead.conversation?.messages[0];
                const summary = lead.conversation?.summary ?? null;
                const contact: ContactRef = {
                  id: lead.id,
                  name: lead.name ?? "",
                  phone: lead.phone,
                  isSandbox: lead.isTest,
                };
                return (
                  <li
                    key={lead.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control px-2 py-3 transition-colors hover:bg-ink/[0.03] panel:hover:bg-white/5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-display text-sm font-semibold text-ink panel:text-white">
                          {lead.name || "Sem nome"}
                        </p>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="mt-0.5 font-mono text-micro text-neutral panel:text-white/50">
                        {lead.phone}
                        {lead.whatsappName && lead.whatsappName !== lead.name && ` · no WhatsApp: ${lead.whatsappName}`}
                      </p>
                      {summary ? (
                        <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm leading-snug text-neutral panel:text-white/60">
                          {summary}
                        </p>
                      ) : (
                        last && (
                          <p className="mt-1 truncate text-sm text-neutral panel:text-white/60">
                            {last.content}
                          </p>
                        )
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-micro text-neutral panel:text-white/40">
                        {lead.conversation ? relativeTime(lead.conversation.updatedAt) : "—"}
                      </span>
                      <EditContactDialog leadId={lead.id} data={contactProfileData(lead,
                        lead.conversation?.agent?.tenantId === tenantId ? lead.conversation.agent.variableDefinitions : null)} />
                      <SendMessageDialog contact={contact} canSend={connected} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
