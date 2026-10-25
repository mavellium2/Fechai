import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { dateTimeLabel, phoneLabel, relativeTime, waLink } from "@/lib/format";
import { leadStatusLabel } from "./leadStatus";
import { ConversationSummary } from "./ConversationSummary";
import { ResolveButton } from "./ResolveButton";
import type { ConversationVariables as Values, VariableDefinition } from "@/modules/agent-engine/variables";

export type LeadPanelData = {
  id: string;
  needsHuman: boolean;
  isTest: boolean;
  agentPaused: boolean;
  followUpSentAt: Date | null;
  updatedAt: Date;
  agent: { name: string; enabled: boolean; archived: boolean } | null;
  lead: { name: string | null; phone: string; status: string; createdAt: Date };
  messageCount: number;
  summary: string | null;
  summaryAt: Date | null;
  summaryMsgCount: number | null;
  variableDefinitions: VariableDefinition[];
  variables: Values;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/5 py-3 first:border-t-0 first:pt-0">
      <dt className="font-mono text-micro uppercase tracking-[0.15em] text-white/50">{label}</dt>
      <dd className="mt-1 text-sm text-white/85">{children}</dd>
    </div>
  );
}

/**
 * Contexto do lead + o que fazer a seguir.
 *
 * Antes, abrir uma conversa mostrava só o nome e o telefone: não dava para saber
 * desde quando o cliente fala com o agente, qual agente atendeu, se já houve
 * follow-up — nem havia ação nenhuma disponível. Esta coluna é o fim do "beco
 * sem saída" do handoff.
 */
export function LeadPanel({ conversation }: { conversation: LeadPanelData }) {
  const status = leadStatusLabel(conversation.lead.status);
  const wa = waLink(conversation.lead.phone);
  const agentAvailable = Boolean(conversation.agent?.enabled && !conversation.agent.archived);

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/50">Situação</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {conversation.isTest ? (
            <Badge tone="neutral">teste</Badge>
          ) : (
            <Badge tone={status.tone}>{status.label}</Badge>
          )}
          {conversation.needsHuman && <Badge tone="danger">precisa de você</Badge>}
        </div>
      </div>

      {/* Antes das linhas de dados por escolha: quem abre uma conversa quer
          primeiro saber o que rolou nela, e só depois telefone e datas. */}
      <ConversationSummary
        conversationId={conversation.id}
        state={{
          summary: conversation.summary,
          summaryAt: conversation.summaryAt,
          summaryMsgCount: conversation.summaryMsgCount,
          messageCount: conversation.messageCount,
        }}
      />

      <dl>
        <Row label="Telefone">
          <span className="font-mono">{phoneLabel(conversation.lead.phone)}</span>
        </Row>
        <Row label="Primeiro contato">
          <time dateTime={conversation.lead.createdAt.toISOString()}>
            {dateTimeLabel(conversation.lead.createdAt)}
          </time>
        </Row>
        <Row label="Última mensagem">
          <time dateTime={conversation.updatedAt.toISOString()}>
            {relativeTime(conversation.updatedAt)}
          </time>
        </Row>
        <Row label="Mensagens trocadas">
          <span className="tabular-nums">{conversation.messageCount}</span>
        </Row>
        <Row label="Atendido por">{conversation.agent?.name ?? "Sem agente atribuído"}</Row>
        {conversation.followUpSentAt && (
          <Row label="Follow-up">
            <time dateTime={conversation.followUpSentAt.toISOString()}>
              enviado {relativeTime(conversation.followUpSentAt)}
            </time>
          </Row>
        )}
      </dl>

      {!agentAvailable && (
        <p className="text-xs leading-relaxed text-amber-200">
          Esta conversa está sem agente ativo. Reative o atendimento para atribuí-la ao agente ativo padrão.
        </p>
      )}

      <div className="space-y-2">
        <ResolveButton
          conversationId={conversation.id}
          needsHuman={conversation.needsHuman}
          agentPaused={conversation.agentPaused}
          agentAvailable={agentAvailable}
        />
        {wa ? (
          <ButtonLink
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm"
            className="w-full"
          >
            Responder no WhatsApp
            <ExternalLink size={14} aria-hidden />
            <span className="sr-only">(abre em nova aba)</span>
          </ButtonLink>
        ) : (
          // O lead de teste (sandbox ou simulação do MCP) tem telefone sintético:
          // não há número para abrir. Dizer isso é melhor do que oferecer um link quebrado.
          <p className="text-xs leading-relaxed text-white/50">
            Esta é a conversa de teste do sandbox — não há número de WhatsApp para responder.
          </p>
        )}
      </div>
    </div>
  );
}
