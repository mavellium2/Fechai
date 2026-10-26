"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import type { AgentUsage } from "@/modules/agent-engine/agents";
import { NewAgentButton } from "./NewAgentButton";
import { ImportAgentButton } from "./ImportAgentButton";

export type AgentNavEntry = {
  id: string; name: string; enabled: boolean; isPrimary: boolean; ready: boolean; hasKnowledge: boolean;
};

export function AgentsSidebar({ agents, usage }: { agents: AgentNavEntry[]; usage: AgentUsage }) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const visible = agents.filter((agent) => agent.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  return (
    <aside className="agents-sidebar" aria-label="Seus agentes">
      <div className="agents-sidebar-top">
        <Link href="/agentes" className="agents-overline">Agentes</Link>
        <button type="button" className="agents-search-trigger" aria-label="Buscar agente na lista" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setSearch(""); }}><Search size={13} aria-hidden /></button>
      </div>
      {searchOpen && <label className="agents-sidebar-search"><Search size={14} aria-hidden /><input autoFocus aria-label="Buscar agente" placeholder="Buscar agente" value={search} onChange={(event) => setSearch(event.target.value)} /></label>}
      <nav aria-label="Selecionar agente" className="agents-sidebar-list">
        {visible.map((agent) => {
          const active = pathname === `/agentes/${agent.id}`;
          const status = !agent.enabled ? "Desligado" : !agent.hasKnowledge ? "Falta conhecimento" : agent.isPrimary ? "Atende o WhatsApp" : agent.ready ? "Pronto · só no teste" : "Configuração incompleta";
          return (
            <Link key={agent.id} href={`/agentes/${agent.id}`} aria-current={active ? "page" : undefined} className={`agent-nav-item ${active ? "agent-nav-selected" : ""}`} title={`${agent.name} · ${status}`}>
              <span className={`agent-nav-avatar ${active ? "agent-nav-avatar-active" : ""}`}>{agent.name.slice(0, 1).toUpperCase()}</span>
              <span className="truncate">{agent.name}</span>
              <span className={`agent-status-dot ${!agent.enabled ? "agent-status-off" : !agent.ready ? "agent-status-warning" : ""}`} aria-label={status} />
            </Link>
          );
        })}
        {visible.length === 0 && <p className="px-2 py-3 text-xs text-neutral">{agents.length ? "Nenhum agente encontrado." : "Crie seu primeiro agente."}</p>}
      </nav>
      <div className="agents-shortcuts">
        <p className="agents-overline">Atalhos</p>
        <NewAgentButton usage={usage} variant="shortcut" />
        <ImportAgentButton usage={usage} variant="shortcut" />
      </div>
      <div className="agents-sidebar-footer">
        <p>{usage.used} de {usage.limit} agentes do plano</p>
        {!usage.canCreate && <Link href="/planos" className="mt-2 block text-iris underline underline-offset-2">Mudar de plano</Link>}
      </div>
    </aside>
  );
}
