import type { ReactNode } from "react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { dateTimeLabel, phoneLabel } from "@/lib/format";
import { reasonLabel } from "@/modules/agent-engine/disqualify";
import { parseConversationVariables, parseVariableDefinitions } from "@/modules/agent-engine/variables";
import { LOSS_CATEGORIES, lossLabel } from "@/modules/lead-insights/categories";
import { crmBoardHref, type CrmSearchParams } from "@/modules/crm/board-filters";
import { crmOriginLabel } from "@/modules/crm/lead-origin";
import type { getCrmLeadDetail } from "@/modules/crm/lead-detail";
import { crmReplyPaused } from "@/modules/crm/whatsapp-reply";
import { unidentifiedPhoneReply } from "@/modules/crm/phone-reply";
import { crmDurationLabel } from "@/modules/crm/sla";
import { ConversationSummary } from "../conversas/ConversationSummary";
import { ConversationVariables } from "../conversas/ConversationVariables";
import { SendMessageForm } from "../conversas/SendMessageForm";
import { CrmLeadDrawer } from "./CrmLeadDrawer";
import { CrmAssumeLead, CrmCompleteTask, CrmHandoffControls, CrmItWasMe, CrmLeadTags, CrmTaskForm } from "./CrmLeadForms";
import { sendCrmReply } from "./reply-actions";

type Lead = Awaited<ReturnType<typeof getCrmLeadDetail>>;
const sourceNames = { ai: "Agente", system: "Sistema", user: "Equipe", group: "Grupo" };
const viaNames: Record<string, string> = { panel: "pelo painel", group: "pelo grupo", phone: "pelo celular da clínica", auto: "automaticamente, sem resposta da equipe" };
const triggerNames: Record<string, string> = { agent: "pelo agente", reaction: "por reação no celular da clínica", unanswered: "por pergunta sem resposta", campaign: "pela regra da campanha" };

/** Uma linha da trilha (CRM-11) em texto: quem, por onde e quanto tempo. Sem telefone nem conversa. */
function trailEntry(event: Lead["trail"][number], names: Map<string, string>): { source: null; title: string; details: string | null } {
  const meta = event.meta && typeof event.meta === "object" && !Array.isArray(event.meta) ? event.meta as Record<string, unknown> : {};
  const text = (key: string) => (typeof meta[key] === "string" ? meta[key] as string : null);
  const num = (key: string) => (typeof meta[key] === "number" ? meta[key] as number : null);
  const person = (id: string | null | undefined) => (id ? names.get(id) ?? "pessoa da equipe" : null);
  const actor = person(event.actorId)
    ?? (event.actorRole === "GROUP" ? `número não vinculado${text("actorPhone") ? ` (${text("actorPhone")})` : ""}`
      : event.actorRole === "PHONE" ? "alguém pelo celular da clínica" : "Fechai");
  const wait = num("waitSeconds");
  const line = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;
  switch (event.event) {
    case "handoff.requested":
      return { source: null, title: "Transferido para a equipe", details: triggerNames[text("trigger") ?? ""] ?? null };
    case "handoff.assumed":
      return { source: null, title: `Assumido por ${actor}`, details: line(
        viaNames[text("via") ?? ""] ?? null,
        text("action") === "identify" ? "disse quem respondeu pelo celular" : null,
        wait === null ? null : `após ${crmDurationLabel(Math.floor(wait / 60))} de espera`) };
    case "handoff.transferred":
      return { source: null, title: `Transferido para ${person(text("toUserId")) ?? "outra pessoa da equipe"}`, details: `por ${actor}` };
    case "handoff.returned_to_ai":
      return { source: null, title: "Devolvido para a IA", details: text("via") === "auto" ? viaNames.auto : line(`por ${actor}`, viaNames[text("via") ?? ""] ?? null) };
    case "handoff.sla_alerted":
      return { source: null, title: text("level") === "escalated" ? "Escalonado aos donos" : "Alerta de prazo no grupo",
        details: num("waitedMinutes") === null ? null : `aguardando há ${crmDurationLabel(num("waitedMinutes") ?? 0)}` };
    case "crm.tag_changed":
      return { source: null, title: `${text("action") === "remove" ? "Etiqueta removida" : "Etiqueta aplicada"}: ${text("tag") ?? ""}`, details: `por ${actor}` };
    case "crm.task_changed":
      return { source: null, title: text("action") === "complete" ? "Tarefa concluída" : "Tarefa criada", details: `por ${actor}` };
    default:
      return { source: null, title: "Atualização no atendimento", details: null };
  }
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="min-w-0 space-y-3 p-4">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((+to - +from) / 60_000));

export function CrmLeadDetail({ lead, params, now }: { lead: Lead; params: CrmSearchParams; now: Date }) {
  const { conversation, insight, history, adOrigin, reply, handoff } = lead;
  const users = lead.users.map(({ id, name, email }) => ({ id, name: name?.trim() || email }));
  const userNames = new Map(users.map(({ id, name }) => [id, name]));
  const manualLoss = lead.stage?.kind === "lost" ? lead.transitions.find((event) => event.toStage?.kind === "lost") : undefined;
  const loss = manualLoss?.lossReasonLabel ?? LOSS_CATEGORIES.find(({ key }) => key === manualLoss?.reason)?.label;
  const origin = crmOriginLabel(lead.originChannel, Boolean(adOrigin));
  const adName = [adOrigin?.code, adOrigin?.name].filter(Boolean).join(" · ");
  // Assumido no grupo por número não vinculado (CRM-08): só o final do número.
  const unlinkedPhone = conversation?.agentPaused ? conversation.handoffNotices[0]?.assumedByPhone?.replace(/\D/g, "") : undefined;
  // CRM-09: a última resposta da equipe saiu do celular da clínica sem autor.
  const phoneUnknown = conversation ? unidentifiedPhoneReply(conversation, lead.lastHumanReply) : false;
  const assignee = conversation?.assignedUserId
    ? userNames.get(conversation.assignedUserId) ?? "Pessoa da equipe"
    : unlinkedPhone
      ? `Humano não identificado (final ${unlinkedPhone.slice(-4)})`
      : phoneUnknown
        ? "Humano não identificado (respondeu pelo celular da clínica)"
        : "Sem responsável";
  const author = (message: { sentBy: string | null; sentVia: string | null; sentByUserId: string | null }) =>
    message.sentVia === "phone"
      ? `${message.sentByUserId ? userNames.get(message.sentByUserId) ?? "Pessoa da equipe" : "Não identificado"} · pelo celular da clínica`
      : "Equipe";
  // Linha do tempo (CRM-11): histórico de etapas + trilha do CRM e do transbordo.
  // Transbordos de antes da trilha (só `ReportEvent`) continuam aparecendo.
  const trailStart = lead.trail.length ? Math.min(...lead.trail.map(({ createdAt }) => +createdAt)) : Infinity;
  const timeline = [
    ...lead.transitions.map((event) => ({
      id: event.id, at: event.createdAt, source: sourceNames[event.source],
      title: [event.fromStage?.name, event.toStage?.name ?? "Etapa indisponível"].filter(Boolean).join(" → "),
      details: event.lossReasonLabel ?? (event.reason === "handoff" ? "Encaminhamento à equipe" : null),
    })),
    ...(conversation?.reportEvents ?? []).filter((event) => +event.createdAt < trailStart).map((event) => ({
      id: event.id, at: event.createdAt, source: null, title: "Atendimento encaminhado à equipe", details: null,
    })),
    ...lead.trail.map((event) => ({ id: event.id, at: event.createdAt, ...trailEntry(event, userNames) })),
  ].sort((a, b) => +b.at - +a.at || b.id.localeCompare(a.id)).slice(0, 20);
  return (
    <CrmLeadDrawer title={lead.name?.trim() || "Contato sem nome"} back={crmBoardHref(params, { lead: null, antes: null })}>
      <DetailSection title="Dados do contato">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            ["Telefone", phoneLabel(lead.phone)],
            ["Etapa", lead.stage?.name ?? "Etapa indisponível"],
            ["Cidade informada", insight?.city ?? "Não informada"],
            ["Procedimento informado", insight?.procedure ?? "Não informado"],
            ["Origem", origin === "Anúncio" && adName ? `${origin} · ${adName}` : origin],
            ...(origin !== "Anúncio" && adName ? [["Anúncio associado", adName]] : []),
            ...(lead.broadcast ? [["Resposta ao disparo", `${lead.broadcast.name} · ${dateTimeLabel(lead.broadcast.repliedAt)}`]] : []),
            ["Entrada do lead", dateTimeLabel(lead.createdAt)],
            ["Última atividade", dateTimeLabel(conversation?.messages[0]?.createdAt ?? lead.createdAt)],
            ["Responsável", assignee],
            ...(conversation?.assignedUserId && conversation.assignedAt ? [["Assumiu em", dateTimeLabel(conversation.assignedAt)]] : []),
            // Prazo do transbordo (CRM-10): a espera em curso, ou quanto levou para assumir e responder.
            ...(handoff?.status === "waiting"
              ? [["Aguardando a equipe", `Há ${crmDurationLabel(minutesBetween(handoff.createdAt, now))}${handoff.escalatedAt ? " · escalonado" : ""}`]]
              : handoff?.assumedAt ? [["Tempo até assumir", crmDurationLabel(minutesBetween(handoff.createdAt, handoff.assumedAt))]] : []),
            ...(handoff?.firstReplyAt ? [["1ª resposta humana", `${crmDurationLabel(minutesBetween(handoff.createdAt, handoff.firstReplyAt))} depois do transbordo`]] : []),
            ...(loss ? [["Motivo registrado pela equipe", loss]] : []),
            ...(manualLoss?.lossReasonNote ? [["Justificativa da perda", manualLoss.lossReasonNote]] : []),
            ...(insight?.lossReasonKey ? [["Motivo informado pelo contato",
              [lossLabel(insight.lossReasonKey), insight.lossReasonText].filter(Boolean).join(" · ")]] : []),
            ...(lead.disqualifiedReason ? [["Motivo da desqualificação", reasonLabel(lead.disqualifiedReason)]] : []),
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-neutral panel:text-white/55">{label}</dt>
              <dd className="mt-0.5 whitespace-pre-line [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        {conversation && !conversation.assignedUserId && (phoneUnknown
          ? <CrmItWasMe leadId={lead.id} conversationId={conversation.id} />
          : <CrmAssumeLead leadId={lead.id} conversationId={conversation.id} />)}
        {conversation && (conversation.assignedUserId || conversation.agentPaused || conversation.needsHuman) && (
          <CrmHandoffControls leadId={lead.id} conversationId={conversation.id} assignedUserId={conversation.assignedUserId}
            canReturn users={users} />
        )}
        {conversation && <ConversationVariables definitions={parseVariableDefinitions(lead.variableDefinitions)} values={parseConversationVariables(conversation.variables)} />}
      </DetailSection>

      <DetailSection title="Etiquetas">
        <CrmLeadTags leadId={lead.id} tags={lead.tags} attached={lead.leadTags.map(({ tagId }) => tagId)} />
      </DetailSection>

      <DetailSection title="Tarefas">
        {lead.tasks.length === 0 ? <p className="text-sm text-neutral panel:text-white/55">Nenhuma tarefa para este lead.</p> : (
          <ul className="divide-y divide-ink/10 panel:divide-white/10">
            {lead.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-medium">{task.text}</p>
                  <p className="text-neutral panel:text-white/55">
                    <time dateTime={task.dueAt.toISOString()}>{dateTimeLabel(task.dueAt)}</time>
                    {task.assignedUserId && userNames.has(task.assignedUserId) && ` · ${userNames.get(task.assignedUserId)}`}
                  </p>
                  {task.completedAt ? <p>Concluída em {dateTimeLabel(task.completedAt)}</p> :
                    task.dueAt < now && <p className="text-danger">Prazo vencido</p>}
                </div>
                {!task.completedAt && <CrmCompleteTask leadId={lead.id} taskId={task.id} label={task.text} />}
              </li>
            ))}
          </ul>
        )}
        <CrmTaskForm leadId={lead.id} users={users} />
      </DetailSection>

      <DetailSection title="Conversa">
        {conversation && history ? (
          <>
            <ConversationSummary conversationId={conversation.id} state={{ summary: conversation.summary, summaryAt: conversation.summaryAt,
              summaryMsgCount: conversation.summaryMsgCount, messageCount: conversation._count.messages }} />
            {(history.before || params.antes) && <nav className="flex flex-wrap gap-2" aria-label="Páginas da conversa">
              {history.before && <ButtonLink size="sm" variant="outline" prefetch={false} href={crmBoardHref(params, { antes: history.before })}>Mensagens anteriores</ButtonLink>}
              {params.antes && <ButtonLink size="sm" variant="ghost" prefetch={false} href={crmBoardHref(params, { antes: null })}>Mensagens recentes</ButtonLink>}
            </nav>}
            {history.messages.length === 0 ? <p className="text-sm text-neutral panel:text-white/55">Nenhuma mensagem registrada.</p> :
              <ul className="space-y-3" aria-label="Histórico da conversa">
                {history.messages.map((message) => (
                  <li key={message.id} className="min-w-0 [overflow-wrap:anywhere]">
                    <ChatBubble role={message.role === "user" ? "user" : "assistant"} footer={
                      <>{message.role === "user" ? "Contato" : message.sentBy === "human" ? author(message) : message.sentBy === "agent" ? "Agente" : "Resposta"} · <time dateTime={message.createdAt.toISOString()}>{dateTimeLabel(message.createdAt)}</time></>
                    }>
                      {message.audioUrl && <audio className="mb-2 h-8 max-w-full" aria-label="Áudio da mensagem" controls preload="none" src={message.audioUrl} />}
                      {message.content}
                    </ChatBubble>
                  </li>
                ))}
              </ul>}
            {!params.antes && reply?.status === "ready" && (
              <SendMessageForm conversationId={conversation.id} textReplyAction={sendCrmReply.bind(null, lead.id)} />
            )}
            {!params.antes && reply && reply.status !== "ready" && (
              <div className="space-y-2 border-t border-ink/10 pt-3 text-sm text-neutral panel:border-white/10 panel:text-white/65">
                <p>{crmReplyPaused[reply.status]}</p>
                {reply.templates && (reply.status === "no_inbound" || reply.status === "window_closed") && (
                  <ButtonLink href="/disparos" variant="outline" size="sm">Usar modelo aprovado em Disparos</ButtonLink>
                )}
              </div>
            )}
          </>
        ) : <p className="text-sm text-neutral panel:text-white/55">Nenhuma conversa vinculada.</p>}
      </DetailSection>

      <DetailSection title="Linha do tempo">
        {timeline.length === 0 ? <p className="text-sm text-neutral panel:text-white/55">Nenhum evento registrado.</p> :
          <ol className="space-y-2 text-sm">
            {timeline.map((event) => (
              <li key={event.id} className="break-words">
                <p className="font-medium">{event.title}</p>
                {event.details && <p className="text-neutral panel:text-white/55">{event.details}</p>}
                <p className="text-neutral panel:text-white/55">{event.source && `${event.source} · `}<time dateTime={event.at.toISOString()}>{dateTimeLabel(event.at)}</time></p>
              </li>
            ))}
          </ol>}
      </DetailSection>
    </CrmLeadDrawer>
  );
}
