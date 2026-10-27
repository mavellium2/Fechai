"use client";
import { useActionState, useState } from "react";
import { useActionToast } from "@/components/ui/toast";
import { composeSystemPrompt, type PersonaAnswers } from "@/modules/agent-engine/persona";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { SaveBar } from "./SaveBar";
import { savePersona } from "./actions";
const EMPTY: PersonaAnswers = { agentName: "", businessName: "", sector: "", tone: "", writingStyle: "", offer: "", avoid: "", objective: "" };
export function PersonaForm({ agentId, initial }: { agentId: string; initial: Partial<PersonaAnswers> }) {
  const [answers, setAnswers] = useState<PersonaAnswers>({ ...EMPTY, ...initial });
  const [saved, setSaved] = useState(JSON.stringify({ ...EMPTY, ...initial }));
  const [custom, setCustom] = useState({ tone: false, writingStyle: false });
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof savePersona>> | null, data: FormData) => {
    const snapshot = JSON.stringify(answers);
    const result = await savePersona(prev, data);
    if (result.ok) setSaved(snapshot);
    return result;
  }, null);
  useActionToast(state, pending, { entity: "personalidade", gender: "f" });
  const field = (key: keyof PersonaAnswers, label: string, multiline = false) => <label className="agent-form-field" key={key}><span>{label}</span>{multiline ? <Textarea name={key} value={answers[key]} onChange={e => setAnswers(a => ({ ...a, [key]: e.target.value }))} rows={4} /> : <Input name={key} value={answers[key]} required={key === "businessName"} onChange={e => setAnswers(a => ({ ...a, [key]: e.target.value }))} />}</label>;
  const select = (key: "tone" | "writingStyle", label: string, values: string[]) => <div className="agent-form-field"><span id={`persona-${key}`}>{label}</span><SelectMenu label={label} labelledBy={`persona-${key}`} value={custom[key] ? "__custom__" : answers[key]} onChange={value => { setCustom(c => ({ ...c, [key]: value === "__custom__" })); if (value !== "__custom__") setAnswers(a => ({ ...a, [key]: value })); }} options={[...new Set(["", ...values, answers[key]])].map(v => ({ value: v, label: v || "Escolher" })).concat({ value: "__custom__", label: "Personalizar" })} />{custom[key] && <Input aria-label={`${label} personalizado`} value={answers[key]} onChange={e => setAnswers(a => ({ ...a, [key]: e.target.value }))} />}<input type="hidden" name={key} value={answers[key]} /></div>;
  return <UnsavedForm action={action} result={state} label="Personalidade" className="agent-persona-form">
    <input type="hidden" name="agentId" value={agentId} /><input type="hidden" name="avoid" value={answers.avoid} />
    <section className="agent-form-section"><h3>Quem ela é</h3><div className="agent-fields-grid">{field("agentName", "Nome do agente")}{field("businessName", "Nome do negócio")}</div>{field("sector", "Segmento")}</section>
    <section className="agent-form-section"><h3>Como ela fala</h3><div className="agent-fields-grid">{select("tone", "Tom de voz", ["Acolhedor", "Direto", "Formal"])}{select("writingStyle", "Estilo de escrita", ["Frases curtas", "Detalhado", "Conversacional"])}</div><div className="agent-example"><small>Assim soa a conversa · prévia ilustrativa</small><p>Oi! Sou {answers.agentName || "seu agente"}{answers.businessName ? `, da ${answers.businessName}` : ""}. Como posso te ajudar?</p></div></section>
    <section className="agent-form-section"><h3>Objetivo da conversa</h3>{field("objective", `O que ${answers.agentName || "o agente"} deve buscar?`, true)}<details className="agent-extra"><summary>O que ela oferece e instruções completas</summary>{field("offer", "O que o negócio oferece", true)}<pre className="agent-prompt-preview">{composeSystemPrompt(answers)}</pre></details></section>
    <SaveBar dirty={JSON.stringify(answers) !== saved} pending={pending} />
  </UnsavedForm>;
}
