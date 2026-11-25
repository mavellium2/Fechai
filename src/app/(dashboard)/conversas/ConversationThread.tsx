import Link from "next/link";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { ChatLog } from "@/components/chat/ChatLog";
import { dayLabel, phoneLabel, samePanelDay, timeLabel } from "@/lib/format";
import { LeadPanel, type LeadPanelData } from "./LeadPanel";
import { SendMessageForm } from "./SendMessageForm";
import { DeleteTestConversationButton } from "./DeleteTestConversationButton";
import { AgentPauseButton } from "./AgentPauseButton";
import { AssumeConversationButton } from "./AssumeConversationButton";
import { ConversationTransfer } from "./ConversationTransfer";
import { ConversationToolbar } from "./ConversationsWorkspace";
import { SurveyThreadCard, type ThreadSurvey } from "./SurveyThreadCard";
type ThreadMessage = { id: string; role: string; content: string; createdAt: Date; sentBy: string | null; recoveredAt?: Date | null; audioUrl?: string | null; sentVia?: string | null; sentByUserId?: string | null };
type Member = { id: string; name: string };
export function ConversationThread({ conversation: c, messages, survey = null, backHref, voiceReady = false, assignee = null, team = [] }: { conversation: LeadPanelData; messages: ThreadMessage[]; survey?: ThreadSurvey | null; backHref: string; voiceReady?: boolean; /** Quem atende a conversa (CRM-07). */ assignee?: Member | null; team?: Member[] }) {
  const name = c.lead.name?.trim() || phoneLabel(c.lead.phone);
  const agent = c.agent?.name || "Agente";
  const surveyAfter = survey ? messages.filter(m => m.createdAt <= survey.sentAt).length - 1 : -2;
  // CRM-09: resposta pelo celular da clínica mostra quem foi (ou "não identificado").
  const teamName = (userId: string | null | undefined) => userId ? team.find((member) => member.id === userId)?.name ?? "Pessoa da equipe" : "Não identificado";
  const humanLabel = (m: ThreadMessage) => m.sentVia === "phone" ? `${teamName(m.sentByUserId)} · pelo celular da clínica` : "Você · equipe";
  return <>
    <header className="conversation-thread-header"><Link href={backHref} className="conversation-back tenant-icon-button" aria-label="Voltar para a lista de conversas"><ArrowLeft size={18} /></Link><div className="conversation-title"><h2>{name}</h2><p>{c.isTest ? "Conversa de teste" : "WhatsApp do negócio"} · {c.agent ? `atendida por ${agent}` : "sem agente atribuído"}</p></div><ConversationToolbar /><details className="conversation-options"><summary aria-label="Opções da conversa"><MoreHorizontal size={20} /></summary><div><AgentPauseButton conversationId={c.id} paused={c.agentPaused} agentAvailable={Boolean(c.agent?.enabled && !c.agent.archived)} needsHuman={c.needsHuman} />{c.isTest && <DeleteTestConversationButton conversationId={c.id} />}<details><summary>Dados e ações</summary><LeadPanel conversation={c} /></details></div></details></header>
    {(c.needsHuman || c.agentPaused || assignee) && <div className="conversation-handoff"><div><strong>{assignee ? `Com ${assignee.name}` : c.agentPaused ? `${agent} pausado nesta conversa` : "Aguardando a equipe"}</strong><p>{assignee ? (c.agentPaused ? `${assignee.name} está atendendo. ${agent} fica pausado até alguém reativar o agente.` : `${assignee.name} é a pessoa responsável por esta conversa.`) : c.needsHuman ? "Esta conversa precisa de atendimento humano." : "O atendimento automático está pausado para este contato."}</p></div>{assignee ? <ConversationTransfer conversationId={c.id} assignedUserId={assignee.id} team={team} /> : <AssumeConversationButton id={c.id} paused={c.isTest && c.agentPaused} />}</div>}
    <ChatLog label={`Histórico da conversa com ${name}`} scrollKey={`${c.id}-${messages.length}`} className="conversation-message-log">
      {!messages.length && <p className="conversation-date">Nenhuma mensagem nesta conversa.</p>}
      {survey && surveyAfter === -1 && <SurveyThreadCard survey={survey} />}
      {messages.map((m, i) => { const previous = messages[i - 1]; const newDay = !previous || !samePanelDay(previous.createdAt, m.createdAt); const incoming = m.role === "user"; return <div key={m.id}>
        {newDay && <p className="conversation-date">{dayLabel(m.createdAt)}</p>}
        <article className={`conversation-message ${incoming ? "conversation-incoming" : "conversation-outgoing"}`} data-message-content tabIndex={-1} aria-label={`${incoming ? name : m.sentBy === "human" ? humanLabel(m) : agent}, ${timeLabel(m.createdAt)}`}><small>{incoming ? name : m.sentBy === "human" ? humanLabel(m) : m.sentBy === "history" ? "WhatsApp" : `${agent} · agente`}</small>{m.audioUrl && <audio controls preload="none" src={m.audioUrl}><a href={m.audioUrl}>Baixar áudio</a></audio>}<p>{m.content}</p><footer><time dateTime={m.createdAt.toISOString()}>{timeLabel(m.createdAt)}</time>{m.recoveredAt && <span> · recuperada</span>}</footer></article>
        {survey && surveyAfter === i && <SurveyThreadCard survey={survey} />}
      </div>; })}
    </ChatLog>
    <div className="conversation-reply"><SendMessageForm key={c.id} conversationId={c.id} isTest={c.isTest} agentPaused={c.agentPaused} voiceReady={voiceReady} />{!c.isTest && <p>Ao enviar, você assume esta conversa e o agente continua pausado para este contato.</p>}</div>
  </>;
}
