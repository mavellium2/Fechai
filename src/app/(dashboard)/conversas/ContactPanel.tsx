import { phoneLabel, dateTimeLabel } from "@/lib/format";
import { ConversationSummary } from "./ConversationSummary";
import { LeadPanel, type LeadPanelData } from "./LeadPanel";
import { ConversationVariables } from "./ConversationVariables";
import { LeadCampaigns } from "./LeadCampaigns";
export type ContactCampaigns = { leadId: string; joined: { id: string; name: string; source: string }[]; available: { id: string; name: string }[] } | null;
export function ContactPanel({ conversation: c, appointment, campaigns = null }: { conversation: LeadPanelData; appointment: { title: string; startsAt: Date } | null; campaigns?: ContactCampaigns }) {
  return <>
    <ConversationSummary conversationId={c.id} state={{ summary: c.summary, summaryAt: c.summaryAt, summaryMsgCount: c.summaryMsgCount, messageCount: c.messageCount }} />
    <section className="contact-section"><h3>Próximo agendamento</h3><p>{appointment ? <>{appointment.title}<br />{dateTimeLabel(appointment.startsAt)}</> : "Nenhum agendamento futuro no fechai."}</p></section>
    <section className="contact-section"><h3>Dados do contato</h3><dl>{[["Nome", c.variables.nome || c.lead.name || "Não informado"], ["Telefone", c.isTest ? "Conversa de teste" : phoneLabel(c.lead.phone)], ...c.variableDefinitions.map(v => [v.key, c.variables[v.key] || "Não informado"]), ["Atendido por", c.agent?.name || "Sem agente atribuído"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    {campaigns && <LeadCampaigns leadId={campaigns.leadId} campaigns={campaigns.joined} available={campaigns.available} />}
    <details className="contact-section"><summary>Histórico e detalhes</summary><ConversationVariables definitions={c.variableDefinitions} values={c.variables} /><LeadPanel conversation={c} /></details>
  </>;
}
