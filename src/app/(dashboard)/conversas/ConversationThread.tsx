import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatLog } from "@/components/chat/ChatLog";
import { dayLabel, phoneLabel, relativeTime, samePanelDay, timeLabel } from "@/lib/format";
import { leadStatusLabel } from "./leadStatus";
import { ConversationSummary } from "./ConversationSummary";
import { LeadPanel, type LeadPanelData } from "./LeadPanel";
import { SendMessageForm } from "./SendMessageForm";
import { DeleteTestConversationButton } from "./DeleteTestConversationButton";
import { AgentPauseButton } from "./AgentPauseButton";
import { ConversationVariables } from "./ConversationVariables";
import { SurveyThreadCard, type ThreadSurvey } from "./SurveyThreadCard";

type ThreadMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  sentBy: string | null;
  /** Mensagem enviada ou recebida como voz: o player entra junto do texto. */
  audioUrl?: string | null;
};

/**
 * Histórico da conversa: cabeçalho fixo + mensagens com scroll próprio.
 *
 * O cabeçalho ficava dentro do fluxo da página: numa conversa longa, rolar até
 * o fim tirava da tela justamente a informação de com quem se está falando.
 * Aqui ele é irmão da área rolável, então nunca sai de vista.
 */
export function ConversationThread({
  conversation,
  messages,
  survey = null,
  backHref,
  voiceReady = false,
}: {
  conversation: LeadPanelData;
  messages: ThreadMessage[];
  /** Pesquisa de satisfação que o contato recebeu: aparece na linha do tempo, não como mensagem. */
  survey?: ThreadSurvey | null;
  /** Volta para a lista no celular, onde só um painel aparece por vez. */
  backHref: string;
  /** O agente desta conversa tem voz gravada — habilita os botões de voz. */
  voiceReady?: boolean;
}) {
  const status = leadStatusLabel(conversation.lead.status);
  const name = conversation.lead.name?.trim() || phoneLabel(conversation.lead.phone);

  // Quem escreveu cada mensagem: o lead ("user"), a IA ("assistant" de
  // "agent") ou o dono da conta respondendo à mão ("assistant" de "human").
  // Posição da pesquisa na linha do tempo: depois da última mensagem anterior ao envio.
  const surveyAfter = survey ? messages.filter((m) => m.createdAt <= survey.sentAt).length - 1 : -2;

  function senderLabel(m: ThreadMessage) {
    if (m.role === "user") return name;
    return m.sentBy === "human" ? "você" : "agente";
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
        <Link
          href={backHref}
          aria-label="Voltar para a lista de conversas"
          className="-ml-1 rounded-control p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris lg:hidden"
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>

        <div className="min-w-0 flex-1">
          <h2 className="font-display truncate text-base font-semibold text-white">{name}</h2>
          <p className="truncate font-mono text-micro text-white/50">
            {phoneLabel(conversation.lead.phone)} · {relativeTime(conversation.updatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {conversation.isTest ? (
            <Badge tone="neutral">teste</Badge>
          ) : (
            <Badge tone={status.tone}>{status.label}</Badge>
          )}
          {conversation.needsHuman && <Badge tone="danger">precisa de você</Badge>}
          {conversation.isTest && (
            <DeleteTestConversationButton conversationId={conversation.id} />
          )}
        </div>
      </header>

      <div className="border-b border-white/10 px-4 py-2">
        <AgentPauseButton
          conversationId={conversation.id}
          paused={conversation.agentPaused}
          agentAvailable={Boolean(conversation.agent?.enabled && !conversation.agent.archived)}
          needsHuman={conversation.needsHuman}
        />
        <div className="mt-2 xl:hidden">
          <ConversationVariables definitions={conversation.variableDefinitions} values={conversation.variables} />
        </div>
      </div>

      {/* O resumo acima do histórico, em xl+, onde a coluna do cliente já
          existe: é o mesmo bloco, mas aqui é a primeira coisa lida antes de
          entrar nas mensagens. Abaixo de xl seria duplicata do <details>
          seguinte, então some.

          Recolhível e FECHADO por padrão: aberto, o bloco comia um terço da
          altura do histórico — a área que de fato importa nesta coluna. O
          resumo completo continua sempre visível na coluna do cliente; aqui
          ele é atalho, não a via principal. */}
      {conversation.summary && (
        <details className="hidden border-b border-ink/10 panel:border-white/10 xl:block">
          <summary className="cursor-pointer px-4 py-2 font-mono text-micro uppercase tracking-[0.15em] text-neutral transition-colors hover:text-ink panel:text-white/50 panel:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
            Resumo da conversa
          </summary>
          <div className="px-4 pb-3">
            <ConversationSummary
              conversationId={conversation.id}
              state={{
                summary: conversation.summary,
                summaryAt: conversation.summaryAt,
                summaryMsgCount: conversation.summaryMsgCount,
                messageCount: conversation.messageCount,
              }}
            />
          </div>
        </details>
      )}

      {/* Abaixo de xl não há terceira coluna: o contexto do lead vira um bloco
          que a pessoa abre quando precisa, em vez de sumir da tela. */}
      <details className="border-b border-white/10 xl:hidden">
        <summary className="cursor-pointer px-4 py-2 font-mono text-micro uppercase tracking-[0.15em] text-white/50 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
          Dados do cliente e ações
        </summary>
        <div className="px-4 pb-4">
          <LeadPanel conversation={conversation} />
        </div>
      </details>

      <ChatLog
        label={`Histórico da conversa com ${name}`}
        scrollKey={conversation.id}
        className="flex-1 space-y-0 p-4"
      >
        {survey && surveyAfter === -1 && <SurveyThreadCard survey={survey} />}
        {messages.map((m, i) => {
          const previous = messages[i - 1];
          const newDay =
            !previous || !samePanelDay(previous.createdAt, m.createdAt);
          // Mensagens seguidas do mesmo lado ficam coladas: numa conversa de 40
          // mensagens, o espaçamento uniforme vira ruído e esconde os turnos.
          const sameSpeaker = previous?.role === m.role && !newDay;

          return (
            <div key={m.id}>
              {newDay && (
                <p className="my-4 text-center font-mono text-micro uppercase tracking-[0.15em] text-white/35">
                  {dayLabel(m.createdAt)}
                </p>
              )}
              <div className={sameSpeaker ? "mt-1" : newDay ? "" : "mt-4"}>
                <ChatBubble
                  role={m.role === "user" ? "user" : "assistant"}
                  footer={`${senderLabel(m)}${m.audioUrl ? " · áudio" : ""} · ${timeLabel(m.createdAt)}`}
                >
                  {/* Áudio + texto na MESMA bolha: o texto é o que a mensagem
                      diz (ditado ou falado), o player é como ela chegou. Separar
                      em duas bolhas sugeriria duas mensagens. */}
                  {m.audioUrl && (
                    <audio
                      controls
                      preload="none"
                      src={m.audioUrl}
                      className="mb-1 h-9 w-full min-w-[220px]"
                    >
                      <a href={m.audioUrl}>Baixar áudio</a>
                    </audio>
                  )}
                  {m.content}
                </ChatBubble>
              </div>
              {survey && surveyAfter === i && <SurveyThreadCard survey={survey} />}
            </div>
          );
        })}
      </ChatLog>

      {conversation.needsHuman && (
        <div className="border-t border-white/10 bg-warn/5 px-4 py-3">
          {conversation.agentPaused ? (
            <p className="text-sm text-white/80">
              O agente está pausado nesta conversa (por reação do atendente ou resposta manual) — por isso ele não
              respondeu. Ative-o acima para ele voltar a atender, ou responda você mesmo.
            </p>
          ) : (
            <p className="text-sm text-white/80">
              O agente pediu ajuda nesta conversa. Responda abaixo ou marque como resolvida quando
              terminar — as ações estão no painel do cliente.
            </p>
          )}
        </div>
      )}

      <SendMessageForm
        key={conversation.id}
        conversationId={conversation.id}
        isTest={conversation.isTest}
        agentPaused={conversation.agentPaused}
        voiceReady={voiceReady}
      />
    </>
  );
}
