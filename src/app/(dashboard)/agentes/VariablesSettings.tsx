"use client";

import { useRef, useState, useTransition } from "react";
import { useActionToast } from "@/components/ui/toast";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/components/ui/unsaved-changes";
import { DEFAULT_VARIABLES, MAX_CUSTOM_VARIABLES, type VariableDefinition } from "@/modules/agent-engine/variable-definitions";
import { saveAgentVariables, type Result } from "./actions";
import { SaveBar } from "./SaveBar";

export function VariablesSettings({ agentId, initial }: { agentId: string; initial: VariableDefinition[] }) {
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [state, setState] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  useActionToast(state, pending, { entity: "variáveis", gender: "f", plural: true });
  const rootRef = useRef<HTMLDivElement>(null);
  useUnsavedChanges(pending || JSON.stringify(rows) !== saved, "Variáveis", rootRef, save);

  function change(index: number, patch: Partial<VariableDefinition>) {
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setState(null);
  }

  function save() {
    if (pending) return;
    const normalized = rows.map((row) => ({ key: row.key.trim().toLowerCase(), description: row.description.trim() }));
    startTransition(async () => {
      try {
        const result = await saveAgentVariables(agentId, normalized);
        setState(result);
        if (result.ok) { setRows(normalized); setSaved(JSON.stringify(normalized)); }
      } catch {
        setState({ ok: false, error: "Não foi possível salvar as variáveis." });
      }
    });
  }

  return <div ref={rootRef} className="space-y-5">
    <div>
      <h3 className="text-sm font-semibold text-white">Campos padrão</h3>
      <ul className="mt-2 space-y-2">
        {DEFAULT_VARIABLES.map((row) => <li key={row.key} className="rounded-control border border-white/10 p-3 text-sm">
          <span className="block font-medium">{{ nome: "Nome", numero: "Número", endereco: "Endereço" }[row.key] ?? row.key}</span>
          <span className="mt-2 block text-xs text-white/60">{row.description}</span>
        </li>)}
      </ul>
    </div>
    <fieldset disabled={pending} className="min-w-0 space-y-3">
      <legend className="text-sm font-semibold text-white">Campos personalizados</legend>
      {rows.length === 0 && <p className="text-sm text-white/50">Nenhuma variável personalizada.</p>}
      {rows.map((row, index) => <div key={index} className="space-y-3 rounded-control border border-white/10 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <label htmlFor={`variable-key-${index}`} className="text-sm text-white/80">Nome do campo</label>
            <Input id={`variable-key-${index}`} className="mt-1" value={row.key} maxLength={40}
              placeholder="ex: tipo_paciente" onChange={(e) => change(index, { key: e.target.value })} />
          </div>
          <Button type="button" variant="ghost" aria-label={`Remover variável ${row.key || index + 1}`}
            onClick={() => { setRows(rows.filter((_, i) => i !== index)); setState(null); }}><Trash2 size={15} aria-hidden /></Button>
        </div>
        <div>
          <label htmlFor={`variable-description-${index}`} className="text-sm text-white/80">O que o agente deve guardar</label>
          <Textarea id={`variable-description-${index}`} className="mt-1" rows={2} maxLength={300}
            placeholder="Ex: tipo de atendimento pedido pela pessoa" value={row.description}
            onChange={(e) => change(index, { description: e.target.value })} />
        </div>
        {row.key && <p className="text-xs text-white/50">Aparecerá como <code>{`{{${row.key}}}`}</code> na conversa.</p>}
      </div>)}
      <Button type="button" variant="outline" disabled={rows.length >= MAX_CUSTOM_VARIABLES}
        onClick={() => { setRows([...rows, { key: "", description: "" }]); setState(null); }}>
        <Plus size={15} aria-hidden />Adicionar campo
      </Button>
    </fieldset>
    <SaveBar dirty={JSON.stringify(rows) !== saved} pending={pending} onSave={save} />
  </div>;
}
