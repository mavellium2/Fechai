"use client";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { snapshotForm } from "@/components/ui/unsaved-form-state";
export function SaveBar({ dirty, pending, onSave, label = "Salvar alterações" }: { dirty: boolean; pending: boolean; onSave?: () => void; label?: string }) {
  return <footer className="agent-save-bar"><span role="status">{pending ? "Salvando alterações..." : dirty ? "Alterações ainda não salvas" : "Nenhuma alteração pendente"}</span><Button type={onSave ? "button" : "submit"} onClick={onSave} disabled={!dirty || pending} loading={pending}>{label}</Button></footer>;
}

/** Matches UnsavedForm's snapshot, including hidden values changed by SelectMenu/Switch. */
export function FormSaveBar({ result, pending }: { result: { ok?: boolean | string } | null; pending: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const baseline = useRef("");
  const submitted = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    baseline.current = snapshotForm(form);
    let frame = 0;
    const check = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setDirty(snapshotForm(form) !== baseline.current)); };
    const submit = () => { submitted.current = snapshotForm(form); };
    const observer = new MutationObserver(check);
    observer.observe(form, { subtree: true, attributes: true, attributeFilter: ["value", "checked"], childList: true });
    form.addEventListener("input", check); form.addEventListener("change", check); form.addEventListener("submit", submit); form.addEventListener("unsaved-form-submit", submit);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); form.removeEventListener("input", check); form.removeEventListener("change", check); form.removeEventListener("submit", submit); form.removeEventListener("unsaved-form-submit", submit); };
  }, []);
  useEffect(() => {
    if (!result?.ok || submitted.current === null) return;
    baseline.current = submitted.current; submitted.current = null;
    const frame = requestAnimationFrame(() => setDirty(snapshotForm(ref.current?.closest("form") ?? null) !== baseline.current));
    return () => cancelAnimationFrame(frame);
  }, [result]);
  return <div ref={ref} className="agent-save-bar-holder"><SaveBar dirty={dirty} pending={pending} /></div>;
}
