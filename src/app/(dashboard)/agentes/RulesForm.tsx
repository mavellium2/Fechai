"use client";
import { useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, Undo2 } from "lucide-react";
import { useActionToast } from "@/components/ui/toast";
import { useUnsavedChanges } from "@/components/ui/unsaved-changes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SaveBar } from "./SaveBar";
import { saveRules, type Result } from "./actions";
type Rule = { id: string; text: string };
const serialize = (rules: Rule[]) => rules.map(r => r.text.trim().replace(/[\r\n]+/g, " ")).join("\n");
export function RulesForm({ agentId, initial }: { agentId: string; initial: string }) {
  const [rows, setRows] = useState<Rule[]>(() => initial.split("\n").map((text, i) => ({ id: String(i), text: text.trim() })).filter(r => r.text));
  const [saved, setSaved] = useState(() => serialize(rows));
  const [removed, setRemoved] = useState<{ row: Rule; index: number } | null>(null);
  const [state, setState] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const dirty = rows.some(r => !r.text.trim()) || serialize(rows) !== saved;
  useActionToast(state, pending, { entity: "regras", gender: "f", plural: true });
  useUnsavedChanges(dirty || pending, "Regras", root, save);
  function save() {
    if (pending) return;
    if (rows.some(r => !r.text.trim())) { setState({ ok: false, error: "Preencha ou remova as regras vazias." }); return; }
    const snapshot = serialize(rows);
    const data = new FormData(); data.set("agentId", agentId); data.set("rules", snapshot);
    start(async () => { try { const result = await saveRules(null, data); setState(result); if (result.ok) setSaved(snapshot); } catch { setState({ ok: false, error: "Não foi possível salvar. Suas regras continuam aqui." }); } });
  }
  function move(index: number, offset: number) { const next = [...rows]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setRows(next); }
  return <div ref={root} className="agent-rules-form"><h3>Regras do atendimento</h3><fieldset disabled={pending}>
    {rows.map((row, i) => <div className="agent-rule" key={row.id}><label className="agent-form-field"><span>Regra {i + 1}</span><Textarea rows={2} value={row.text} onChange={e => { setRows(rows.map(r => r.id === row.id ? { ...r, text: e.target.value } : r)); setState(null); }} /></label><div className="agent-row-actions">
      <Button size="icon" variant="ghost" aria-label={`Duplicar regra ${i + 1}`} onClick={() => setRows([...rows.slice(0, i + 1), { ...row, id: crypto.randomUUID() }, ...rows.slice(i + 1)])}><Copy size={14} /></Button>
      <Button size="icon" variant="ghost" aria-label={`Mover regra ${i + 1} para cima`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button><Button size="icon" variant="ghost" aria-label={`Mover regra ${i + 1} para baixo`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button><Button size="icon" variant="ghost" aria-label={`Remover regra ${i + 1}`} onClick={() => { setRemoved({ row, index: i }); setRows(rows.filter(r => r.id !== row.id)); }}><Trash2 size={14} /></Button>
    </div></div>)}
    {!rows.length && <p className="agent-help">Nenhuma regra definida. Adicione orientações para o atendimento.</p>}
    <Button variant="outline" onClick={() => setRows([...rows, { id: crypto.randomUUID(), text: "" }])}><Plus size={14} />Adicionar regra</Button>
    {removed && <Button variant="ghost" onClick={() => { setRows([...rows.slice(0, removed.index), removed.row, ...rows.slice(removed.index)]); setRemoved(null); }}><Undo2 size={14} />Desfazer remoção</Button>}
    </fieldset><p className="agent-help">Use orientações claras e específicas para o seu atendimento.</p><SaveBar dirty={dirty} pending={pending} onSave={save} /></div>;
}
