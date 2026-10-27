"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Bot, MoreHorizontal } from "lucide-react";
import type { AgentUsage } from "@/modules/agent-engine/agents";
import { NewAgentButton } from "./NewAgentButton";
import { ImportAgentButton } from "./ImportAgentButton";

type Entry = { id: string; name: string; caption: string; description: string; enabled: boolean; isPrimary: boolean };
const recentKey = "fechai:last-agent";
function subscribe(fn: () => void) { window.addEventListener("storage", fn); return () => window.removeEventListener("storage", fn); }
function recent() { try { return localStorage.getItem(recentKey); } catch { return null; } }
export function rememberAgent(id: string) { try { localStorage.setItem(recentKey, id); } catch { /* Optional local convenience. */ } }

export function AgentDirectory({ agents, usage }: { agents: Entry[]; usage: AgentUsage }) {
  const [query, setQuery] = useState("");
  const last = useSyncExternalStore(subscribe, recent, () => null);
  const items = agents.filter(a => a.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <section className="agents-directory">
    <header className="directory-header"><div><h1>Agentes</h1><p>Escolha um agente para configurar ou testar o atendimento.</p></div><div className="directory-actions"><ImportAgentButton usage={usage} /><NewAgentButton usage={usage} /></div></header>
    <div className="directory-search"><input aria-label="Buscar agente por nome" placeholder="Buscar por nome do agente..." value={query} onChange={e => setQuery(e.target.value)} /><span>{agents.length} agentes · {agents.filter(a => a.enabled && a.isPrimary).length} respondendo</span></div>
    <ul className="directory-grid">{items.map(a => <li key={a.id} className="directory-card">
      <div className="directory-card-heading"><span className="agent-overview-avatar">{a.name.slice(0, 1).toUpperCase()}</span><div><h2>{a.name}</h2><p>{a.caption}</p></div><details className="directory-card-menu"><summary aria-label={`Opções de ${a.name}`}><MoreHorizontal size={20} /></summary><div><Link href={`/agentes/${a.id}`}>Configurar agente</Link><Link href={`/conversas?agent=${a.id}`}>Ver conversas</Link></div></details></div>
      <p className="directory-status"><span className={`agent-status-dot ${a.enabled ? "" : "agent-status-warning"}`} />{!a.enabled ? "Pausado" : a.isPrimary ? "Respondendo no WhatsApp" : "Pronto · só no teste"}</p>
      <p className="directory-description">{a.description || "Configure o conhecimento e as habilidades deste agente."}</p>
      <p className="directory-recent">{last === a.id ? "Último agente acessado" : "\u00a0"}</p>
      <Link href={`/agentes/${a.id}`} className="directory-open" onClick={() => rememberAgent(a.id)}>Abrir agente <ArrowRight size={14} aria-hidden /></Link>
    </li>)}</ul>
    {!items.length && <div className="agents-empty"><Bot size={32} aria-hidden /><h2>{query ? "Nenhum agente encontrado" : "Crie seu primeiro agente"}</h2><p>{query ? "Tente buscar por outro nome." : "Defina a personalidade, o conhecimento e as habilidades para começar."}</p></div>}
    <p className="directory-usage">{usage.used} de {usage.limit} agentes do plano</p>
  </section>;
}
