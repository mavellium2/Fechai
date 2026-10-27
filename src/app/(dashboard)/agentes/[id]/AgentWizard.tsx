"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Book, Braces, Calendar, Flame, Funnel, Hand, LayoutGrid, List, MessageCircle, Mic, Repeat2, Search, UserRound, Users, Volume2, X, type LucideIcon } from "lucide-react";
import posthog from "posthog-js";
import { ACTION_CATALOG, type ActionKey } from "@/modules/agent-engine/actions";
import type { PersonaAnswers } from "@/modules/agent-engine/persona";
import type { ScheduleConfig } from "@/modules/scheduling/config";
import { splitReminderLead } from "@/modules/scheduling/config";
import { describeRanges, getWeeklyAvailability } from "@/modules/scheduling/weekly-availability";
import type { FollowUpConfig } from "@/modules/follow-up/config";
import type { HandoffConfig } from "@/modules/agent-engine/handoff";
import type { VariableDefinition } from "@/modules/agent-engine/variables";
import { DEFAULT_VARIABLES } from "@/modules/agent-engine/variable-definitions";
import { Switch } from "@/components/ui/switch";
import { useSaveFeedback } from "@/components/ui/toast";
import { useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { Sandbox, type SandboxHandle } from "@/app/(dashboard)/conversas/Sandbox";
import type { SandboxDraft } from "@/modules/agent-engine/sandbox-draft";
import { KnowledgeWorkspace } from "../KnowledgeWorkspace";
import { EditorLayout } from "../EditorLayout";
import { rememberAgent } from "../AgentDirectory";
import { PersonaForm } from "../PersonaForm";
import { RulesForm } from "../RulesForm";
import { VariablesSettings } from "../VariablesSettings";
import { ScheduleSettings } from "../ScheduleSettings";
import { FollowUpSettings } from "../FollowUpSettings";
import { HandoffSettings } from "../HandoffSettings";
import { BehaviorSettings } from "../BehaviorSettings";
import { setActionEnabled, setAgentBehavior } from "../actions";
import { AgentHeader, type HeaderAgent } from "./AgentHeader";

type Doc = { id: string; title: string; status: string; createdAt: Date; fileUrl: string | null; fileName: string | null };
type BehaviorKey = "listenAudio" | "speakReplies" | "stopOnEmoji";
type ItemKey = "personalidade" | "regras" | "conhecimento" | "dados" | ActionKey | BehaviorKey;
type Tile = {
  key: ItemKey; label: string; caption: string; icon: LucideIcon;
  description: string; facts: [string, string][]; editLabel?: string;
  on?: boolean; unavailable?: boolean; note?: string;
};

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ACTION_ICONS: Record<ActionKey, LucideIcon> = {
  register_lead: List, mark_hot_lead: Flame, schedule_meeting: Calendar,
  follow_up: Repeat2, handoff_human: Users, disqualify_lead: Funnel,
};
const ACTION_ORDER: ActionKey[] = ["schedule_meeting", "follow_up", "handoff_human", "disqualify_lead", "register_lead", "mark_hot_lead"];

export function AgentWizard({
  agent, canDelete, canDuplicate, persona, rules, variableDefinitions, documents,
  enabledKeys, planLimit, scheduleConfig, clinicorpConnected, metaReminders = false,
  followUpConfig, handoffConfig, listenAudio, speakReplies, stopOnEmoji, voice,
  catalogKey = null, voiceAvailable, speechBlocklist, voiceStyle, voicePrompt,
}: {
  agent: HeaderAgent; canDelete: boolean; canDuplicate: boolean;
  persona: Partial<PersonaAnswers>; rules: string; variableDefinitions: VariableDefinition[];
  documents: Doc[]; enabledKeys: string[]; planLimit: number; scheduleConfig: ScheduleConfig;
  clinicorpConnected: boolean; metaReminders?: boolean; followUpConfig: FollowUpConfig;
  handoffConfig: HandoffConfig; listenAudio: boolean; speakReplies: boolean; stopOnEmoji: boolean;
  voice: { label: string | null; createdAt: Date | null; source: string | null } | null;
  catalogKey?: string | null; voiceAvailable: boolean; speechBlocklist: string; voiceStyle: string; voicePrompt: string;
}) {
  const router = useRouter();
  const feedback = useSaveFeedback({ entity: "configuração do agente", gender: "f" });
  const [selectedKey, setSelectedKey] = useState<ItemKey>("personalidade");
  const [testOpen, setTestOpen] = useState(false);
  const sandbox = useRef<SandboxHandle>(null);
  const [draft, setDraft] = useState<SandboxDraft | null>(null);
  const [testedDraft, setTestedDraft] = useState("");
  const [documentRequest, setDocumentRequest] = useState<{ id: string; serial: number } | null>(null);
  useEffect(() => { rememberAgent(agent.id); }, [agent.id]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const [detailRequested, setDetailRequested] = useState(false);
  useEffect(() => {
    if (detailRequested && window.matchMedia("(max-width: 1023px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      detailRef.current?.focus({ preventScroll: true });
    }
  }, [selectedKey, detailRequested]);
  const confirmNavigation = useUnsavedNavigation();
  const activeKeys = enabledKeys.filter((key) => ACTION_CATALOG.some((action) => action.key === key && action.status !== "disabled"));
  const behaviors: Record<BehaviorKey, boolean> = { listenAudio, speakReplies, stopOnEmoji };
  const week = getWeeklyAvailability(scheduleConfig);
  const workdays = week.flatMap((ranges, day) => ranges.length ? [DAYS[day]] : []);
  const dayLabel = workdays.join(",") === "Seg,Ter,Qua,Qui,Sex" ? "Seg a sex" : workdays.join(", ") || "Sem dias disponíveis";
  const scheduleHours = week.filter((ranges) => ranges.length).map(describeRanges);
  const uniformHours = scheduleHours.length && scheduleHours.every((value) => value === scheduleHours[0]);
  const reminders = scheduleConfig.reminderEnabled ? scheduleConfig.reminders : [];
  const reminderLabel = reminders.map((reminder) => {
    const { amount, unit } = splitReminderLead(reminder.minutesBefore);
    const units = { minutes: "min", hours: "h", days: amount === 1 ? "dia" : "dias", weeks: amount === 1 ? "semana" : "semanas" };
    return `${amount}${unit === "hours" || unit === "minutes" ? "" : " "}${units[unit]}${reminder.sendTime ? ` às ${reminder.sendTime}` : " antes"}`;
  }).join(" e ") || "Desligados";
  const followUpSteps = (followUpConfig.noReply.enabled ? followUpConfig.noReply.steps.length : 0) + (followUpConfig.declined.enabled ? followUpConfig.declined.steps.length : 0);
  const ruleCount = rules.split(/\r?\n/).filter((line) => line.trim()).length;

  const about: Tile[] = [
    { key: "personalidade", label: "Personalidade", caption: persona.tone || "Definir personalidade", icon: UserRound,
      description: "Como ela se apresenta e conversa", editLabel: "Editar personalidade",
      facts: [["Nome", persona.agentName || "Não informado"], ["Negócio", persona.businessName || "Não informado"], ["Segmento", persona.sector || "Não informado"], ["Tom de voz", persona.tone || "Não informado"], ["Escrita", persona.writingStyle || "Não informado"], ["Objetivo", persona.objective || "Não informado"]],
      note: "Preço, horário e endereço ficam em Conhecimento." },
    { key: "regras", label: "Regras", caption: `${ruleCount} ${ruleCount === 1 ? "regra" : "regras"}`, icon: Ban,
      description: "Os limites que ela respeita em toda conversa", editLabel: "Editar regras",
      facts: [["Regras", String(ruleCount)]], note: rules || "Nenhuma regra adicional. Você pode definir o que o agente nunca deve dizer ou prometer." },
    { key: "conhecimento", label: "Conhecimento", caption: `${documents.length} ${documents.length === 1 ? "documento" : "documentos"}`, icon: Book,
      description: "O que ela sabe sobre o seu negócio", editLabel: "Gerenciar conhecimento",
      facts: [["Documentos", String(documents.length)], ["Prontos", String(documents.filter((doc) => doc.status === "ready").length)]],
      note: documents.length ? "Mantenha preços, serviços e informações do negócio atualizados." : "Adicione o primeiro documento para o agente responder com o conhecimento do seu negócio." },
    { key: "dados", label: "Dados", caption: `${variableDefinitions.length + DEFAULT_VARIABLES.length} campos`, icon: Braces,
      description: "Os dados que ela guarda ao longo da conversa", editLabel: "Editar dados",
      facts: [["Padrão", "Nome, número e endereço"], ["Personalizados", String(variableDefinitions.length)]],
      note: "Os dados são preenchidos com o que o contato informa na conversa." },
  ];

  const actionCaptions: Record<ActionKey, string> = {
    schedule_meeting: dayLabel, follow_up: `${followUpSteps} mensagens`,
    handoff_human: handoffConfig.notifyGroup ? handoffConfig.groupName || "Grupo configurado" : "Recepção",
    register_lead: "Em breve", mark_hot_lead: "Em breve", disqualify_lead: "Ligado",
  };
  const abilities: Tile[] = ACTION_ORDER.map((key) => {
    const definition = ACTION_CATALOG.find((action) => action.key === key)!;
    const on = activeKeys.includes(key);
    const unavailable = definition.status === "disabled";
    const facts: [string, string][] = key === "schedule_meeting"
      ? [["Dias", dayLabel], ["Horário", uniformHours ? scheduleHours[0] : "Varia por dia"], ["Duração", `${scheduleConfig.durationMinutes} min`], ["Lembretes", reminderLabel], ["Agenda", clinicorpConnected ? "fechai + Clinicorp" : "fechai"]]
      : key === "follow_up"
        ? [["Sem resposta", followUpConfig.noReply.enabled ? `${followUpConfig.noReply.steps.length} mensagens` : "Desligado"], ["Não quer agora", followUpConfig.declined.enabled ? `${followUpConfig.declined.steps.length} mensagens` : "Desligado"], ["Envio", `${followUpConfig.window.startHour}h às ${followUpConfig.window.endHour}h`]]
        : key === "handoff_human"
          ? [["Destino", "Fila da recepção"], ["Aviso em grupo", handoffConfig.notifyGroup ? handoffConfig.groupName || "Configurado" : "Desligado"]]
          : unavailable ? [["Disponibilidade", "Em breve"], ["Configuração", "Indisponível"]] : [["Status", on ? "Ligado" : "Desligado"], ["Registro", "Motivo explícito"], ["Resultado", "Relatório de triagem"]];
    return {
      key, label: key === "handoff_human" ? "Chamar a equipe" : key === "mark_hot_lead" ? "Lead quente" : key === "disqualify_lead" ? "Triagem" : key === "follow_up" ? "Follow-up" : definition.label,
      caption: unavailable ? "Em breve" : on ? actionCaptions[key] : "Desligado", icon: ACTION_ICONS[key], on, unavailable,
      description: key === "schedule_meeting" ? "Marca horários direto na agenda." : definition.description, facts,
      editLabel: key === "schedule_meeting" ? "Ajustar agendamento" : key === "follow_up" ? "Ajustar follow-up" : key === "handoff_human" ? "Ajustar transferência" : undefined,
      note: unavailable ? "Esta habilidade ainda não está disponível." : key === "handoff_human" ? "O aviso é para a equipe interna. O contato não entra no grupo." : undefined,
    };
  });

  const voiceItems: Tile[] = [
    { key: "listenAudio", label: "Ouvir áudios", caption: listenAudio ? "Ligado" : "Desligado", icon: Mic, on: listenAudio,
      description: "Transcreve as mensagens de voz e responde ao contato.", facts: [["Status", listenAudio ? "Ligado" : "Desligado"], ["Entrada", "Áudio do contato"], ["Resposta", speakReplies ? "Em áudio" : "Em texto"]], editLabel: "Ajustar voz e conversa" },
    { key: "speakReplies", label: "Responder em áudio", caption: voice ? speakReplies ? "Ligado" : "Desligado" : "Escolher voz", icon: Volume2, on: speakReplies,
      description: "Responde em voz a quem também enviou áudio.", facts: [["Voz", voice?.label || (voice ? "Configurada" : "Não escolhida")], ["Origem", voice ? voice.source === "catalog" ? "Voz pronta" : "Voz gravada" : "Não escolhida"]],
      editLabel: "Escolher e ajustar voz", note: !voiceAvailable ? "A resposta em áudio não está disponível nesta instalação." : !voice ? "Escolha uma voz antes de ligar a resposta em áudio." : undefined },
    { key: "stopOnEmoji", label: "Pausar com reação", caption: stopOnEmoji ? "Ligado" : "Desligado", icon: Hand, on: stopOnEmoji,
      description: "Pausa o agente quando alguém da equipe reage à conversa pelo WhatsApp.", facts: [["Status", stopOnEmoji ? "Ligado" : "Desligado"], ["Quem reage", "Equipe"], ["Efeito", "Pausa a conversa"], ["Retomada", "Pelo painel"]], editLabel: "Ajustar voz e conversa",
      note: "Reações do contato não pausam o agente." },
  ];
  const groups = [{ label: "Sobre ela", items: about }, { label: "Habilidades", items: abilities }, { label: "Voz", items: voiceItems }];
  const allItems = groups.flatMap((group) => group.items);
  const selected = allItems.find((item) => item.key === selectedKey) ?? about[0];
  const atLimit = activeKeys.length >= planLimit;
  const isBehavior = selectedKey in behaviors;
  const toggleBlocked = selected.unavailable || (isBehavior
    ? selectedKey === "speakReplies" && (!voice || !voiceAvailable)
    : !selected.on && atLimit);
  const limitNote = !selected.on && !isBehavior && atLimit && !selected.unavailable && selected.on !== undefined
    ? `Limite de ${planLimit} habilidades ligadas. Desligue uma para ligar esta.` : "";
  const detailNote = [selected.note, limitNote].filter(Boolean).join("\n\n");

  function selectItem(key: ItemKey) {
    if (key === selectedKey) return;
    confirmNavigation(() => {
      if (selectedKey === "conhecimento") { setDraft(null); setTestedDraft(""); setDocumentRequest(null); }
      setSelectedKey(key);
      setDetailRequested(true);
    });
  }

  async function toggle(next: boolean) {
    const key = selectedKey;
    const result = await feedback.run(() => isBehavior
      ? setAgentBehavior(agent.id, key as BehaviorKey, next)
      : setActionEnabled(agent.id, key as ActionKey, next));
    if (result.ok) {
      if (!isBehavior) posthog.capture("agent_action_toggled", { action_key: key, enabled: next });
      router.refresh();
    }
  }

  function editorContent() {
    if (selectedKey === "personalidade") return <PersonaForm agentId={agent.id} initial={persona} />;
    if (selectedKey === "regras") return <RulesForm agentId={agent.id} initial={rules} />;
    if (selectedKey === "dados") return <VariablesSettings agentId={agent.id} initial={variableDefinitions} />;
    if (selectedKey === "conhecimento") return <KnowledgeWorkspace agentId={agent.id} name={persona.agentName || agent.name} documents={documents} draft={draft} onDraft={setDraft} tested={Boolean(draft && JSON.stringify(draft) === testedDraft)} openRequest={documentRequest} onTest={() => { setTestOpen(true); if (draft) void sandbox.current?.compare(draft); }} />;
    if (selectedKey === "schedule_meeting") return <ScheduleSettings agentId={agent.id} config={scheduleConfig} clinicorpConnected={clinicorpConnected} metaReminders={metaReminders} />;
    if (selectedKey === "follow_up") return <FollowUpSettings agentId={agent.id} config={followUpConfig} />;
    if (selectedKey === "handoff_human") return <><h3>Aviso para a equipe</h3><HandoffSettings agentId={agent.id} config={handoffConfig} /></>;
    if (selectedKey in behaviors) return <BehaviorSettings focused={selectedKey as BehaviorKey} agentId={agent.id} listenAudio={listenAudio} speakReplies={speakReplies} stopOnEmoji={stopOnEmoji} voice={voice} catalogKey={catalogKey} voiceAvailable={voiceAvailable} speechBlocklist={speechBlocklist} voiceStyle={voiceStyle} voicePrompt={voicePrompt} />;
    return null;
  }

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visibleGroups = groups.map((group) => ({ ...group, items: group.items.filter((item) => `${item.label} ${item.caption}`.toLocaleLowerCase("pt-BR").includes(term)) }));
  const descriptions: Partial<Record<ItemKey, string>> = {
    personalidade: "Como ela se apresenta e conduz cada conversa.", regras: "Oriente o que ela deve fazer e evitar em cada atendimento.",
    conhecimento: "As informações que ela consulta para responder com segurança.", dados: "Escolha quais informações ela registra durante a conversa.",
    schedule_meeting: "Consulte a disponibilidade e marque os atendimentos.", follow_up: "Retome a conversa em etapas, respeitando o momento do contato.",
    handoff_human: "Passe a conversa para a recepção quando precisar de uma pessoa.", disqualify_lead: "Identifique contatos que não procuram um novo atendimento.",
    listenAudio: "Permita que ela entenda mensagens de voz dos contatos.", speakReplies: "Escolha uma voz para responder aos contatos que enviam áudio.",
    stopOnEmoji: "Assuma o atendimento reagindo a uma mensagem no WhatsApp.",
  };
  return <div className={`agent-workspace agent-v7 ${testOpen ? "agent-test-open" : ""}`}>
    <AgentHeader agent={agent} canDelete={canDelete} canDuplicate={canDuplicate} toolbar={<>
      <div className="agent-view-toggle" aria-label="Visualização das configurações"><button aria-label="Exibir em blocos" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={17} /></button><button aria-label="Exibir em lista" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={19} /></button></div>
      <label className="agent-search"><Search size={15} aria-hidden /><input aria-label="Buscar configuração" placeholder="Buscar" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button className="agent-test-button" onClick={() => setTestOpen(value => !value)} aria-expanded={testOpen}><MessageCircle size={15} />Testar conversa</button>
    </>} />
    <div className="agent-body">
      <nav aria-label="Configurações do agente" className={`agent-config-nav ${view === "list" ? "agent-config-list" : ""}`}>
        {visibleGroups.filter(g => g.items.length).map(group => <section key={group.label} className="agent-config-group"><h2>{group.label}</h2><div className="agent-config-items">{group.items.map(item => <button key={item.key} className={`agent-config-item ${item.key === selectedKey ? "agent-config-active" : ""} ${item.on === false || item.unavailable ? "agent-config-off" : ""}`} aria-current={item.key === selectedKey ? "page" : undefined} onClick={() => selectItem(item.key)}><span className="agent-config-icon"><item.icon size={27} strokeWidth={1.6} />{item.on && <span className="agent-status-dot" />}</span><span className="agent-config-copy"><span>{item.label}</span><small>{item.caption}</small></span></button>)}</div></section>)}
        {!visibleGroups.some(g => g.items.length) && <p className="agent-help">Nenhuma configuração encontrada.</p>}
        <p className="agent-config-usage">{activeKeys.length} habilidades ativas</p>
      </nav>
      <section ref={detailRef} tabIndex={-1} className="agent-edit-main" aria-label={selected.label}>
        <header className="agent-edit-heading"><div><h2>{selected.label}</h2><p>{selected.unavailable ? "Esta habilidade ainda não está disponível para ativação." : descriptions[selectedKey] || selected.description}</p></div>{selected.on !== undefined && !selected.unavailable && <div className="agent-edit-switch"><span>{selected.on ? "Ligado" : "Desligado"}</span><Switch checked={Boolean(selected.on)} onCheckedChange={toggle} disabled={Boolean(toggleBlocked) || feedback.saving} loading={feedback.saving} label={`${selected.label}: ${selected.on ? "ligado" : "desligado"}`} /></div>}</header>
        {limitNote && <p role="status" className="agent-help">{limitNote}</p>}
        <div className="agent-inline-editor" key={selectedKey}><EditorLayout value={true}>
          {selected.unavailable ? <><div className="agent-coming-soon"><h3>Em breve</h3><p>A configuração de {selected.label.toLocaleLowerCase("pt-BR")} aparecerá aqui quando a habilidade estiver disponível.</p><p>Você pode continuar configurando as habilidades disponíveis na lateral.</p></div><h3>Continue configurando {agent.name}</h3><p className="agent-help">{selectedKey === "register_lead" ? "Em Dados, escolha quais informações o agente registra durante as conversas." : "Em Chamar a equipe, defina quando encaminhar a conversa à recepção."}</p><button className="agent-detail-edit" onClick={() => selectItem(selectedKey === "register_lead" ? "dados" : "handoff_human")}>Ver {selectedKey === "register_lead" ? "Dados" : "Chamar a equipe"}</button></> : selectedKey === "disqualify_lead" ? <><h3>Situações reconhecidas</h3>{[["Fora da área de atendimento", "O contato informa uma região que o negócio não atende."], ["Não procura atendimento", "Vendas, parcerias, currículo ou cobranças."], ["Spam ou trote", "Mensagens automáticas, engano ou brincadeira."], ["Assunto administrativo", "Contato atual tratando de um assunto sem novo agendamento."], ["Outro motivo", "Situação registrada com uma justificativa específica."]].map(([title, text]) => <div key={title} className="agent-info-row"><h4>{title}</h4><p>{text}</p></div>)}<section className="agent-form-section"><h3>Como orientar o agente</h3><p className="agent-help">As orientações do atendimento ficam em Regras. Ligue a habilidade para permitir o registro da triagem.</p></section></> : editorContent()}
        </EditorLayout></div>
      </section>
      <aside className="agent-detail agent-v7-summary" aria-label="Visão rápida da configuração"><span className="agent-detail-icon"><selected.icon size={34} strokeWidth={1.5} /></span><h2>{selected.label}</h2><p className="agent-detail-description">{selectedKey === "personalidade" ? "Como ela se apresenta e conversa" : "Visão rápida da configuração"}</p><dl className="agent-facts">{selected.facts.map(([label, value]) => <div className="agent-fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{detailNote && <p className="agent-detail-note whitespace-pre-line">{detailNote}</p>}</aside>
      <aside className="agent-sandbox-panel" aria-label="Testar conversa" hidden={!testOpen}><header><h2>Testar conversa</h2><button className="tenant-icon-button" aria-label="Fechar conversa de teste" onClick={() => setTestOpen(false)}><X size={18} /></button></header><Sandbox ref={sandbox} agentId={agent.id} agentName={persona.agentName || agent.name} onApplied={value => setTestedDraft(JSON.stringify(value))} onOpenDocument={id => { const open = () => { setSelectedKey("conhecimento"); setDocumentRequest({ id, serial: Date.now() }); }; if (draft?.documentId === id) setSelectedKey("conhecimento"); else confirmNavigation(open); }} /></aside>
    </div>
  </div>;
}
