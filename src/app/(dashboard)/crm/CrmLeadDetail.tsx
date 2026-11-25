import type { CSSProperties, ReactNode } from "react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { dateTimeLabel, phoneLabel } from "@/lib/format";
import { reasonLabel } from "@/modules/agent-engine/disqualify";
import { LOSS_CATEGORIES, lossLabel } from "@/modules/lead-insights/categories";
import { crmBoardHref, type CrmSearchParams } from "@/modules/crm/board-filters";
import { crmOriginLabel } from "@/modules/crm/lead-origin";
import type { getCrmLeadDetail } from "@/modules/crm/lead-detail";
import { crmReplyPaused } from "@/modules/crm/whatsapp-reply";
import { unidentifiedPhoneReply } from "@/modules/crm/phone-reply";
import { crmDurationLabel } from "@/modules/crm/sla";
import { ConversationSummary } from "../conversas/ConversationSummary";
import { SendMessageForm } from "../conversas/SendMessageForm";
import { CrmLeadDrawer } from "./CrmLeadDrawer";
import { contactProfileData } from "@/modules/crm/contact-profile";
import { CrmAssumeLead, CrmCompleteTask, CrmContactProfile, CrmHandoffControls, CrmItWasMe, CrmLeadTags, CrmTaskForm } from "./CrmLeadForms";
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
    case "crm.contact_edited": {
      const fields = (text("fields") ?? "").split(",").filter(Boolean).map((key) => `{{${key}}}`).join(", ");
      return { source: null, title: "Dados do contato editados", details: line(fields || null, `por ${actor}`, text("via") === "contatos" ? "em Contatos" : null) };
    }
    default:
      return { source: null, title: "Atualização no atendimento", details: null };
  }
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <h3 className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/50">{title}</h3>
      {children}
    </section>
  );
}

const muted = "text-sm text-neutral panel:text-white/55";

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
  const facts = [
    ["Cidade informada", insight?.city ?? "Não informada"],
    ["Procedimento informado", insight?.procedure ?? "Não informado"],
    ...(origin !== "Anúncio" && adName ? [["Anúncio associado", adName]] : []),
    ...(lead.broadcast ? [["Resposta ao disparo", `${lead.broadcast.name} · ${dateTimeLabel(lead.broadcast.repliedAt)}`]] : []),
    ["Entrada do lead", dateTimeLabel(lead.createdAt)],
    ["Última atividade", dateTimeLabel(conversation?.messages[0]?.createdAt ?? lead.createdAt)],
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
  ];
  const profile = contactProfileData(lead, lead.variableDefinitions);
  const openTasks = lead.tasks.filter((task) => !task.completedAt).length;
  // Etapa, responsável, telefone e origem vão no cabeçalho: é o que se procura primeiro.
  const meta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral panel:text-white/60">
      <Badge tone={lead.stage?.kind === "lost" ? "danger" : lead.stage?.kind === "won" ? "success" : "iris"}>{lead.stage?.name ?? "Etapa indisponível"}</Badge>
      {handoff?.status === "waiting" && <Badge tone="warn">Aguardando a equipe</Badge>}
      <span>{phoneLabel(lead.phone)}</span>
      <span aria-hidden>·</span>
      <span>{origin === "Anúncio" && adName ? `${origin} · ${adName}` : origin}</span>
      <span aria-hidden>·</span>
      <span>Responsável: <span className="text-ink panel:text-white">{assignee}</span></span>
    </div>
  );

  const conversationPanel = conversation && history ? (
    <>
      <ConversationSummary conversationId={conversation.id} state={{ summary: conversation.summary, summaryAt: conversation.summaryAt,
        summaryMsgCount: conversation.summaryMsgCount, messageCount: conversation._count.messages }} />
      {(history.before || params.antes) && <nav className="flex flex-wrap gap-2" aria-label="Páginas da conversa">
        {history.before && <ButtonLink size="sm" variant="outline" prefetch={false} href={crmBoardHref(params, { antes: history.before })}>Mensagens anteriores</ButtonLink>}
        {params.antes && <ButtonLink size="sm" variant="ghost" prefetch={false} href={crmBoardHref(params, { antes: null })}>Mensagens recentes</ButtonLink>}
      </nav>}
      {history.messages.length === 0 ? <p className={muted}>Nenhuma mensagem registrada.</p> :
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
  ) : <p className={muted}>Nenhuma conversa vinculada.</p>;

  const dataTab = (
    <>
      {conversation && (
        <DetailSection title="Atendimento">
          {!conversation.assignedUserId && (phoneUnknown
            ? <CrmItWasMe leadId={lead.id} conversationId={conversation.id} />
            : <CrmAssumeLead leadId={lead.id} conversationId={conversation.id} />)}
          {(conversation.assignedUserId || conversation.agentPaused || conversation.needsHuman) && (
            <CrmHandoffControls leadId={lead.id} conversationId={conversation.id} assignedUserId={conversation.assignedUserId}
              canReturn users={users} />
          )}
        </DetailSection>
      )}
      <DetailSection title="Dados do contato">
        <dl className="divide-y divide-ink/10 text-sm panel:divide-white/10">
          {facts.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 py-2">
              <dt className="text-neutral panel:text-white/55">{label}</dt>
              <dd className="whitespace-pre-line [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </DetailSection>
      <DetailSection title="Editar contato">
        {/* A chave remonta o formulário quando o valor salvo muda (o `defaultValue` não acompanha a revalidação). */}
        <CrmContactProfile key={JSON.stringify(profile)} leadId={lead.id} data={profile} />
      </DetailSection>
      <DetailSection title="Etiquetas">
        <CrmLeadTags leadId={lead.id} tags={lead.tags} attached={lead.leadTags.map(({ tagId }) => tagId)} />
      </DetailSection>
    </>
  );

  const tasksTab = (
    <>
      {lead.tasks.length === 0 ? <p className={muted}>Nenhuma tarefa para este lead.</p> : (
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
      <DetailSection title="Nova tarefa">
        <CrmTaskForm leadId={lead.id} users={users} />
      </DetailSection>
    </>
  );

  const historyTab = timeline.length === 0 ? <p className={muted}>Nenhum evento registrado.</p> : (
    <ol className="sla-timeline crm-history-timeline relative space-y-4 border-l border-ink/10 pl-4 text-sm panel:border-white/10">
      {timeline.map((event, i) => (
        <li key={event.id} className="sla-step relative break-words" style={{ "--i": i } as CSSProperties}>
          <span aria-hidden className="sla-dot absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-iris" />
          <p className="font-medium">{event.title}</p>
          {event.details && <p className="text-neutral panel:text-white/55">{event.details}</p>}
          <p className="text-neutral panel:text-white/55">{event.source && `${event.source} · `}<time dateTime={event.at.toISOString()}>{dateTimeLabel(event.at)}</time></p>
        </li>
      ))}
    </ol>
  );

  return (
    <CrmLeadDrawer title={lead.name?.trim() || "Contato sem nome"} meta={meta} back={crmBoardHref(params, { lead: null, antes: null })}
      main={conversationPanel}
      tabs={[
        { key: "dados", label: "Dados", content: dataTab },
        { key: "tarefas", label: openTasks ? `Tarefas (${openTasks})` : "Tarefas", content: tasksTab },
        { key: "historico", label: "Histórico", content: historyTab },
      ]} />
  );
}
