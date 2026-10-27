"use client";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import Link from "next/link";
import { SelectMenu } from "@/components/ui/select-menu";
import { CONVERSA_STAGES } from "./leadStatus";
export function ConversationFilters({ status, search, counts, agents = [], agentId = "" }: { status: string; search: string; counts: { all: number; needsHuman: number; test: number }; agents?: { id: string; name: string }[]; agentId?: string }) {
  const router = useRouter();
  const filterRef = useRef<HTMLDetailsElement>(null);
  const href = (key: string, agent = agentId) => { const params = new URLSearchParams({ status: key }); if (search) params.set("q", search); if (agent) params.set("agent", agent); return `/conversas?${params}`; };
  return <div className="conversation-filters"><div className="conversation-filter-tabs"><Link href={href("all")} aria-current={status === "all" ? "page" : undefined}>Todas · {counts.all}</Link><Link href={href("needs_human")} aria-current={status === "needs_human" ? "page" : undefined}>Precisa de você · {counts.needsHuman}</Link></div><div className="conversation-filter-more"><SelectMenu label="Filtrar por agente" size="sm" value={agentId} onChange={agent => router.push(href(status, agent))} options={[{ value: "", label: "Todos os agentes" }, ...agents.map(a => ({ value: a.id, label: a.name }))]} /><details ref={filterRef}><summary>{status !== "all" && status !== "needs_human" ? `Filtros · ${CONVERSA_STAGES.find(s => s.key === status)?.label || status}` : "Filtros"}</summary><SelectMenu size="sm" label="Filtrar conversas por situação" value={CONVERSA_STAGES.some(s => s.key === status) ? status : "all"} onChange={key => { if (filterRef.current) filterRef.current.open = false; router.push(href(key)); }} options={CONVERSA_STAGES.map(s => ({ value: s.key, label: s.label, dot: s.dot, separatorBefore: s.separatorBefore, badge: s.key === "test" ? counts.test : undefined }))} /></details></div></div>;
}
