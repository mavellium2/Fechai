"use client";
import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowUp, RotateCcw } from "lucide-react";
import type { SandboxDraft, SandboxInspection } from "@/modules/agent-engine/sandbox-draft";
import { ChatLog } from "@/components/chat/ChatLog";
import { Alert } from "@/components/ui/alert";
import "./sandbox.css";
import { TypingToCheck } from "@/components/ui/TypingToCheck";

type Msg = { id: string; role: "user" | "assistant"; content: string; inspection?: SandboxInspection; tools?: string[] };
export type SandboxHandle = { compare: (draft: SandboxDraft) => Promise<void> };
const TOOL_LABELS: Record<string, string> = { schedule_meeting: "Agendar horário", list_available_slots: "Consultar horários livres", handoff_human: "Chamar a equipe", follow_up: "Follow-up", remember_variables: "Registrar dados", report_unanswered: "Registrar pergunta sem resposta" };
export function Sandbox({ agentId, agentName = "Agente", ref, onOpenDocument, onApplied }: { agentId?: string; agentName?: string; ref?: Ref<SandboxHandle>; onOpenDocument?: (id: string) => void; onApplied?: (draft: SandboxDraft) => void } = {}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [applied, setApplied] = useState<SandboxDraft | null>(null);
  const [comparison, setComparison] = useState<{ before: Msg; after: Msg; question: string } | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  async function request(message: string, draft?: SandboxDraft | null, history?: Msg[]) {
    const draftPayload = draft ? { documentId: draft.documentId, title: draft.title, content: draft.content, baseRevision: draft.baseRevision } : undefined;
    const response = await fetch("/api/sandbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, agentId, sessionId, ...(draftPayload ? { draft: draftPayload } : {}), ...(history ? { compare: true, history: history.slice(-10).map(m => ({ role: m.role, content: m.content })) } : {}) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível executar o teste.");
    if (result.status !== "ok") throw new Error("O agente não respondeu. Confira se ele está disponível nesta conta.");
    if (draft && !result.inspection) throw new Error("O teste não foi concluído. Tente aplicar o rascunho novamente antes de publicar.");
    return { id: crypto.randomUUID(), role: "assistant" as const, content: result.reply, tools: result.toolsUsed, inspection: result.inspection };
  }
  async function compare(draft: SandboxDraft) {
    if (busy.current) return;
    const answerIndex = messages.findLastIndex(m => m.role === "assistant");
    const question = messages[answerIndex - 1];
    if (answerIndex < 1 || question?.role !== "user") { setError("Envie uma mensagem de teste antes de aplicar o rascunho. Vamos repetir a mesma pergunta para comparar."); input.current?.focus(); return; }
    const snapshot = { ...draft };
    busy.current = true; setPending(true); setError("");
    try {
      const after = await request(question.content, snapshot, messages.slice(0, answerIndex - 1));
      setComparison({ before: messages[answerIndex], after, question: question.content });
      setApplied(snapshot); setInspecting(null); onApplied?.(snapshot);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível aplicar o rascunho ao teste."); }
    finally { busy.current = false; setPending(false); }
  }
  useImperativeHandle(ref, () => ({ compare }));
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = input.current?.value.trim();
    if (!content || busy.current) return;
    busy.current = true; setPending(true); setError(""); setComparison(null);
    const user: Msg = { id: crypto.randomUUID(), role: "user", content };
    const previous = comparison ? [...messages.slice(0, -1), comparison.after] : messages;
    setMessages([...previous, user]); input.current!.value = "";
    try { const reply = await request(content, applied, applied ? previous : undefined); setMessages([...previous, user, reply]); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível falar com o agente."); }
    finally { busy.current = false; setPending(false); input.current?.focus(); }
  }
  async function reset() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { const query = new URLSearchParams({ sessionId }); if (agentId) query.set("agentId", agentId); const response = await fetch(`/api/sandbox?${query}`, { method: "DELETE" }); if (!response.ok) throw new Error(); setMessages([]); setComparison(null); setApplied(null); setInspecting(null); }
    catch { setError("Não conseguimos recomeçar o teste. Tente novamente."); }
    finally { busy.current = false; setPending(false); }
  }
  const inspected = messages.find(m => m.id === inspecting);
  return <div className="sandbox-workspace">
    <p className="sandbox-version">{applied ? "Rascunho aplicado" : "Versão publicada"} · conversa de teste</p>
    <ChatLog label="Conversa de teste com o agente" scrollKey={`${messages.length}-${pending}-${inspecting}-${Boolean(comparison)}`} className="sandbox-log">
      {!messages.length && <div className="sandbox-empty"><h3>Converse com {agentName}</h3><p>Escreva como se fosse um contato. Este teste não envia WhatsApp nem ocupa a agenda real.</p></div>}
      {comparison ? <><div className="sandbox-user">{comparison.question}</div><h3>Comparar respostas</h3><p className="agent-help">Mesma pergunta e histórico anterior</p><div className="sandbox-answer"><small>ANTES · VERSÃO PUBLICADA</small><p>{comparison.before.content}</p></div><div className="sandbox-answer sandbox-after"><small>DEPOIS · RASCUNHO</small><p>{comparison.after.content}</p></div><p className="agent-help">Fontes consultadas: {comparison.after.inspection?.sources.map(s => s.title).join(", ") || "nenhum trecho recuperado"}</p><button className="agent-detail-edit" disabled={pending} onClick={() => applied && void compare(applied)}>Testar novamente</button><p className="agent-help">Publique pelo editor para usar a correção no atendimento.</p></> : messages.map(m => <div key={m.id} className={`sandbox-message ${m.role === "user" ? "sandbox-user" : ""}`}>{m.role === "assistant" ? <><div className="sandbox-answer"><small>{agentName}</small><p>{m.content}</p></div><button className="agent-detail-edit" onClick={() => setInspecting(inspecting === m.id ? null : m.id)} aria-expanded={inspecting === m.id}>Inspecionar resposta</button></> : m.content}</div>)}
      {pending && <p role="status" className="sandbox-pending"><TypingToCheck state="typing" size={18} />Aguardando o agente...</p>}
      {inspected && <section className="sandbox-inspection"><h3>Inspecionar resposta</h3><p className="agent-help">Registros deste turno</p>{inspected.inspection ? <>
        {inspected.inspection.sources.length ? inspected.inspection.sources.map((source, i) => <article className="sandbox-source" key={`${source.documentId}-${i}`}><small>CONHECIMENTO CONSULTADO{source.draft ? " · RASCUNHO" : ""}</small><strong>{source.title}</strong><blockquote>{source.content}</blockquote>{onOpenDocument && <button className="agent-inline-link" onClick={() => onOpenDocument(source.documentId)}>Abrir no editor ao lado ←</button>}</article>) : <p className="agent-help">{inspected.inspection.searched ? "Nenhum trecho recuperado nesta busca." : "Busca semântica indisponível neste turno."}</p>}
        <details className="agent-extra"><summary>Instruções disponíveis</summary><pre>{inspected.inspection.instructions}</pre></details><h4>Habilidades acionadas</h4><p className="agent-help">{inspected.inspection.tools.length ? inspected.inspection.tools.map(t => TOOL_LABELS[t] || t).join(" · ") : "Nenhuma"}</p>
      </> : <p className="agent-help">Inspeção indisponível para esta resposta.</p>}</section>}
      {!inspecting && !comparison && messages.length > 0 && <section className="sandbox-inspection"><h3>Entenda de onde veio uma resposta</h3><p className="agent-help">Selecione “Inspecionar resposta” para ver trechos consultados, instruções disponíveis e habilidades executadas.</p></section>}
    </ChatLog>
    {error && <Alert tone="danger">{error}</Alert>}
    <div className="sandbox-composer"><form onSubmit={send}><label className="sr-only" htmlFor={id}>Mensagem de teste</label><input id={id} ref={input} maxLength={4000} placeholder="Escreva como se fosse um contato..." autoComplete="off" /><button aria-label="Enviar mensagem de teste" disabled={pending}><ArrowUp size={18} /></button></form><button type="button" className="agent-inline-link" disabled={pending} onClick={reset}><RotateCcw size={12} />Recomeçar conversa</button></div>
  </div>;
}
