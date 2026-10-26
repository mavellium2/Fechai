"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Copy, Download, Ellipsis, Pencil, Star, Trash2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSaveFeedback } from "@/components/ui/toast";
import { deleteAgent, duplicateAgent, renameAgent, setAgentEnabled, setPrimaryAgent } from "../actions";
import { useUnsavedChanges, useUnsavedNavigation } from "@/components/ui/unsaved-changes";

export type HeaderAgent = { id: string; name: string; isPrimary: boolean; enabled: boolean };

/** Existing management actions, now collected in the compact workspace header. */
export function AgentHeader({ agent, canDelete, canDuplicate, toolbar }: {
  agent: HeaderAgent;
  canDelete: boolean;
  canDuplicate: boolean;
  toolbar: ReactNode;
}) {
  const router = useRouter();
  const feedback = useSaveFeedback({ entity: "agente" });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [savedName, setSavedName] = useState(agent.name);
  const [lastServerName, setLastServerName] = useState(agent.name);
  if (agent.name !== lastServerName) {
    setLastServerName(agent.name);
    setSavedName(agent.name);
    if (!editing) setName(agent.name);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const confirmNavigation = useUnsavedNavigation();
  useUnsavedChanges(editing && name !== savedName, "Nome do agente", rootRef, save);

  function closeMenu() { menuRef.current?.removeAttribute("open"); }
  async function save() {
    if (feedback.saving) return;
    const submitted = name.trim();
    const result = await feedback.run(() => renameAgent(agent.id, submitted));
    if (result.ok) {
      setSavedName(submitted);
      setName(submitted);
      setEditing(false);
      router.refresh();
    }
  }
  function cancelEdit() {
    confirmNavigation(() => { setName(savedName); setEditing(false); }, rootRef.current);
  }
  const status = !agent.enabled ? "Desligado para clientes" : agent.isPrimary ? "Respondendo no WhatsApp" : "Pronto · só no teste";

  return (
    <header ref={rootRef} className="agent-header">
      <Link href="/agentes" className="tenant-icon-button" aria-label="Todos os agentes"><ChevronLeft size={20} aria-hidden /></Link>
      <div className="agent-heading">
        {editing ? (
          <div className="flex min-w-0 items-center gap-1">
            <Input value={name} disabled={feedback.saving} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus aria-label="Nome do agente" className="h-8 max-w-48"
              onKeyDown={(event) => { if (event.key === "Enter") void save(); if (event.key === "Escape") cancelEdit(); }} />
            <Button size="icon" aria-label="Salvar nome" onClick={() => void save()} loading={feedback.saving}><Check size={15} aria-hidden /></Button>
            <Button size="icon" variant="ghost" aria-label="Cancelar edição" onClick={cancelEdit} disabled={feedback.saving}><X size={15} aria-hidden /></Button>
          </div>
        ) : <h1 title={savedName}>{savedName}</h1>}
        <span className="agent-heading-status"><span className={`agent-status-dot ${agent.enabled ? "" : "agent-status-off"}`} aria-hidden />{status}</span>
      </div>
      <div className="agent-header-tools">
        {toolbar}
        <details ref={menuRef} className="agent-management">
          <summary className="tenant-icon-button list-none [&::-webkit-details-marker]:hidden" aria-label="Gerenciar agente" title="Gerenciar agente"><Ellipsis size={19} aria-hidden /></summary>
          <div className="agent-management-menu">
            <div className="agent-management-power">
              <span>Agente {agent.enabled ? "ligado" : "desligado"}</span>
              <Switch checked={agent.enabled} loading={feedback.saving} label="Ativar agente para clientes"
                onCheckedChange={async (next) => {
                  const result = await feedback.run(() => setAgentEnabled(agent.id, next));
                  if (result.ok) router.refresh();
                }} />
            </div>
            <Button variant="ghost" size="sm" disabled={feedback.saving} onClick={() => { setName(savedName); setEditing(true); closeMenu(); }}><Pencil size={14} aria-hidden />Renomear</Button>
            <a href={`/api/agents/${agent.id}/export`} download className={buttonVariants({ variant: "ghost", size: "sm" })}><Download size={14} aria-hidden />Exportar agente</a>
            <Button variant="ghost" size="sm" disabled={!canDuplicate || feedback.saving} title={canDuplicate ? undefined : "Limite de agentes do plano atingido"} onClick={async () => {
              await feedback.run(async () => {
                const result = await duplicateAgent(agent.id);
                if (result.ok && result.agentId) { closeMenu(); router.push(`/agentes/${result.agentId}`); }
                return result;
              });
            }}><Copy size={14} aria-hidden />Duplicar agente</Button>
            {!agent.isPrimary && <Button variant="ghost" size="sm" disabled={feedback.saving} onClick={async () => {
              const result = await feedback.run(() => setPrimaryAgent(agent.id));
              if (result.ok) { closeMenu(); router.refresh(); }
            }}><Star size={14} aria-hidden />Usar no WhatsApp</Button>}
            {canDelete && <ConfirmButton size="sm" className="agent-menu-item" disabled={feedback.saving}
              confirm={{ title: `Excluir ${agent.name}?`, description: "A persona, a base de conhecimento e as ações deste agente serão apagadas. As conversas que ele já atendeu continuam no histórico.", confirmLabel: "Excluir agente", tone: "danger" }}
              onConfirm={async () => {
                const result = await feedback.run(() => deleteAgent(agent.id));
                if (result.ok) { closeMenu(); router.push("/agentes"); router.refresh(); }
              }}><Trash2 size={14} aria-hidden />Excluir agente</ConfirmButton>}
          </div>
        </details>
      </div>
    </header>
  );
}
