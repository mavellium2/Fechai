"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Book, Bot, Braces, Calendar, ChevronRight, Flame, Funnel, Hand, LayoutGrid, List, MessageCircle, Mic, Repeat2, Search, UserRound, Users, Volume2, X, type LucideIcon } from "lucide-react";
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
import { Sandbox } from "@/app/(dashboard)/conversas/Sandbox";
import { PersonaForm } from "../PersonaForm";
import { RulesForm } from "../RulesForm";
import { VariablesSettings } from "../VariablesSettings";
import { KnowledgeManager } from "../KnowledgeManager";
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

/** The editor mounts the original forms, preserving their actions and unsaved-change guards. */
function AgentEditor({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirmNavigation = useUnsavedNavigation();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  function requestClose() { confirmNavigation(onClose, ref.current); }
  return (
    <dialog ref={ref} aria-labelledby={titleId} className="agent-editor" onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClick={(event) => { if (event.target === ref.current) requestClose(); }}>
      <header className="agent-editor-header">
        <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        <button type="button" className="tenant-icon-button" aria-label="Fechar edição" onClick={requestClose}><X size={20} aria-hidden /></button>
      </header>
      <div className="agent-editor-body">{children}</div>
    </dialog>
  );
}

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ACTION_ICONS: Record<ActionKey, LucideIcon> = {
  register_lead: List, mark_hot_lead: Flame, schedule_meeting: Calendar,
  follow_up: Repeat2, handoff_human: Users, disqualify_lead: Funnel,
};
const ACTION_ORDER: ActionKey[] = ["schedule_meeting", "follow_up", "handoff_human", "register_lead", "mark_hot_lead", "disqualify_lead"];

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
  const [editor, setEditor] = useState<ItemKey | "testar" | null>(null);
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
          : [["Disponibilidade", unavailable ? "Em breve" : on ? "Ligado" : "Desligado"]];
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
      description: "Transcreve as mensagens de voz e responde ao contato.", facts: [["Transcrição", listenAudio ? "Ligada" : "Desligada"]], editLabel: "Ajustar voz e conversa" },
    { key: "speakReplies", label: "Responder em áudio", caption: voice ? speakReplies ? "Ligado" : "Desligado" : "Escolher voz", icon: Volume2, on: speakReplies,
      description: "Responde em voz a quem também enviou áudio.", facts: [["Voz", voice?.label || (voice ? "Configurada" : "Não escolhida")], ["Origem", voice ? voice.source === "catalog" ? "Voz pronta" : "Voz gravada" : "Não escolhida"]],
      editLabel: "Escolher e ajustar voz", note: !voiceAvailable ? "A resposta em áudio não está disponível nesta instalação." : !voice ? "Escolha uma voz antes de ligar a resposta em áudio." : undefined },
    { key: "stopOnEmoji", label: "Pausar com reação", caption: stopOnEmoji ? "Ligado" : "Desligado", icon: Hand, on: stopOnEmoji,
      description: "Pausa o agente quando alguém da equipe reage à conversa pelo WhatsApp.", facts: [["Reação da equipe", stopOnEmoji ? "Pausa o agente" : "Não pausa"]], editLabel: "Ajustar voz e conversa",
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
    confirmNavigation(() => {
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
      if (next && key === "schedule_meeting") setEditor(key);
      router.refresh();
    }
  }

  function editorContent() {
    if (editor === "personalidade") return <PersonaForm agentId={agent.id} initial={persona} />;
    if (editor === "regras") return <RulesForm agentId={agent.id} initial={rules} />;
    if (editor === "dados") return <VariablesSettings agentId={agent.id} initial={variableDefinitions} />;
    if (editor === "conhecimento") return <KnowledgeManager agentId={agent.id} documents={documents} />;
    if (editor === "schedule_meeting") return <ScheduleSettings agentId={agent.id} config={scheduleConfig} clinicorpConnected={clinicorpConnected} metaReminders={metaReminders} />;
    if (editor === "follow_up") return <FollowUpSettings agentId={agent.id} config={followUpConfig} />;
    if (editor === "handoff_human") return <HandoffSettings agentId={agent.id} config={handoffConfig} />;
    if (editor === "testar") return <Sandbox agentId={agent.id} />;
    if (editor && editor in behaviors) return <BehaviorSettings agentId={agent.id} listenAudio={listenAudio} speakReplies={speakReplies} stopOnEmoji={stopOnEmoji} voice={voice} catalogKey={catalogKey} voiceAvailable={voiceAvailable} speechBlocklist={speechBlocklist} voiceStyle={voiceStyle} voicePrompt={voicePrompt} />;
    return null;
  }

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visibleGroups = groups.map((group) => ({ ...group, items: group.items.filter((item) => `${item.label} ${item.caption}`.toLocaleLowerCase("pt-BR").includes(term)) }));
  const editorTitle = editor === "testar" ? `Testar conversa · ${agent.name}` : allItems.find((item) => item.key === editor)?.label || "Editar agente";

  return (
    <div className="agent-workspace">
      <AgentHeader agent={agent} canDelete={canDelete} canDuplicate={canDuplicate}
        toolbar={<>
          <div className="agent-view-toggle" aria-label="Visualização">
            <button type="button" aria-label="Exibir em grade" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={17} aria-hidden /></button>
            <button type="button" aria-label="Exibir em lista" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={19} aria-hidden /></button>
          </div>
          <label className="agent-search"><Search size={15} aria-hidden /><input aria-label="Buscar configuração" placeholder="Buscar" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <button type="button" className="agent-test-button" onClick={() => setEditor("testar")}><MessageCircle size={15} aria-hidden />Testar conversa</button>
        </>} />
      <div className="agent-body">
        <div className="agent-board">
          {visibleGroups.some((group) => group.items.length) ? visibleGroups.filter((group) => group.items.length).map((group) => (
            <section key={group.label} className="agent-group" aria-label={group.label}>
              <h2 className="agent-group-heading">{group.label}</h2>
              <div className={`agent-tiles ${view === "list" ? "agent-tiles-list" : ""}`}>
                {group.items.map((item) => (
                  <button type="button" key={item.key} className={`agent-tile ${selectedKey === item.key ? "agent-tile-selected" : ""} ${item.on === false || item.unavailable ? "agent-tile-off" : ""}`}
                    aria-pressed={selectedKey === item.key} aria-controls="agent-selected-detail" onClick={() => selectItem(item.key)}>
                    <span className="agent-tile-icon"><item.icon size={28} strokeWidth={1.6} aria-hidden />{item.on !== undefined && <span className="agent-status-dot" aria-hidden />}</span>
                    <span className="agent-tile-label">{item.label}</span>
                    <span className="agent-tile-caption">{item.caption}</span>
                  </button>
                ))}
              </div>
            </section>
          )) : <div role="status" className="agents-empty"><Search size={26} aria-hidden /><p className="mt-4 text-sm text-neutral">Nenhuma configuração encontrada.</p><button type="button" className="mt-3 text-iris underline" onClick={() => setSearch("")}>Limpar busca</button></div>}
        </div>
        <aside id="agent-selected-detail" className="agent-detail" ref={detailRef} tabIndex={-1} aria-label={`Detalhes: ${selected.label}`}>
          <div className="agent-detail-icon"><selected.icon size={38} strokeWidth={1.5} aria-hidden /></div>
          <h2>{selected.label}</h2>
          <p className="agent-detail-description">{selected.description}</p>
          {selected.on !== undefined && !selected.unavailable && <div className="agent-detail-toggle">
            <span>{selected.on ? "Ligado" : "Desligado"}</span>
            <Switch checked={Boolean(selected.on)} onCheckedChange={(next) => void toggle(next)} label={`${selected.label}: ${selected.on ? "ligado" : "desligado"}`}
              disabled={toggleBlocked} loading={feedback.saving} describedBy={toggleBlocked ? "agent-toggle-note" : undefined} />
          </div>}
          <dl className="agent-facts">{selected.facts.map(([label, value]) => <div className="agent-fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {detailNote && <p id="agent-toggle-note" className="agent-detail-note whitespace-pre-line">{detailNote}</p>}
          {selected.editLabel && !selected.unavailable && <button type="button" className="agent-detail-edit" onClick={() => setEditor(selectedKey)}>{selected.editLabel}<ChevronRight size={17} aria-hidden /></button>}
        </aside>
      </div>
      <footer className="agent-footer">
        <nav className="agent-breadcrumb" aria-label="Localização"><Bot size={13} aria-hidden /><Link href="/agentes">Agentes</Link><ChevronRight size={12} aria-hidden /><span>{agent.name}</span><ChevronRight size={12} aria-hidden /><span aria-current="page">{selected.label}</span></nav>
        <p>{allItems.length} itens · {activeKeys.length} de {planLimit} habilidades ligadas</p>
      </footer>
      <AgentEditor title={editorTitle} open={editor !== null} onClose={() => { setEditor(null); router.refresh(); }}>{editorContent()}</AgentEditor>
    </div>
  );
}
