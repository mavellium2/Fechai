"use client";

import { useActionState, useId, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { actionText } from "@/components/ui/action";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/ui/toast";
import type { ActionResult } from "@/components/ui/toast/types";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { saveCrmLossCatalog, saveCrmStage } from "./actions";

type Stage = { id: string; name: string; system: boolean; acceptsArchive: boolean; leadCount: number };

export function CrmLossCatalogForm({ labels, revision }: { labels: string[]; revision: string }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [state, save, pending] = useActionState(async (previous: ActionResult | null, form: FormData) => {
    const result = await saveCrmLossCatalog(previous, form);
    if (result.ok) setDraft(null);
    return result;
  }, null);
  useActionToast(state, pending, { entity: "motivos de perda", gender: "m", plural: true });
  return (
    <UnsavedForm action={save} result={state} label="Motivos de perda" className="space-y-3">
      <input type="hidden" name="revision" value={revision} />
      <Field label="Motivos de perda" htmlFor={id} hint="Um motivo por linha. A equipe escolhe um deles ao mover um lead para Perdido.">
        <Textarea name="reasons" id={id} rows={Math.min(8, labels.length + 1)} value={draft ?? labels.join("\n")} readOnly={pending} required
          onChange={(event) => setDraft(event.target.value)} />
      </Field>
      <Button type="submit" variant="action" loading={pending}>Salvar motivos</Button>
    </UnsavedForm>
  );
}

export function StageNameForm({ stage }: { stage?: Stage }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [state, action, pending] = useActionState(async (previous: ActionResult | null, formData: FormData) => {
    const result = await saveCrmStage(previous, formData);
    if (result.ok) setDraft(null);
    return result;
  }, null);
  useActionToast(state, pending, { entity: "etapa", action: stage ? "update" : "create", gender: "f" });
  const label = stage ? `Nome da etapa ${stage.name}` : "Nome da nova etapa";
  const input = <Input id={id} name="name" value={draft ?? stage?.name ?? ""} onChange={(event) => setDraft(event.target.value)} disabled={pending} required maxLength={80}
    placeholder={stage ? undefined : "Ex.: Orçamento enviado"} />;
  // "Renomear" só aparece com o nome mudado: na lista, dez botões iguais parados viram ruído.
  const changed = draft !== null && draft.trim() !== (stage?.name ?? "") && draft.trim() !== "";

  return (
    <UnsavedForm action={action} result={state} label={label} className="flex min-w-0 flex-wrap items-end gap-2">
      <input type="hidden" name="intent" value={stage ? "rename" : "create"} />
      {stage && <><input type="hidden" name="stageId" value={stage.id} /><input type="hidden" name="previousName" value={stage.name} /></>}
      <div className="min-w-44 flex-1">
        {stage ? <><label htmlFor={id} className="sr-only">{label}</label>{input}</> : <Field label={label} htmlFor={id}>{input}</Field>}
      </div>
      {(!stage || changed || pending) && (
        <Button type="submit" variant={stage ? "action" : "cta"} loading={pending}>{stage ? "Renomear" : "Criar etapa"}</Button>
      )}
    </UnsavedForm>
  );
}

export function CrmStageList({ stages }: { stages: Stage[] }) {
  const [archivingId, setArchivingId] = useState<string | null>(null);
  // A linha sai da lista no sucesso; mantenha o toast no componente que fica montado.
  const [state, archive, pending] = useActionState(async (previous: ActionResult | null, data: FormData) => {
    setArchivingId(String(data.get("stageId")));
    return saveCrmStage(previous, data);
  }, null);
  useActionToast(state, pending, { entity: "etapa", action: "update", gender: "f" });

  return (
    <ol className="divide-y divide-ink/10 panel:divide-white/10" aria-label="Ordem das etapas do pipeline">
      {stages.map((stage, index) => (
        <li key={stage.id} className="py-3 first:pt-0 last:pb-0">
          <CrmStageForms position={index + 1} stage={stage} previousId={stages[index - 1]?.id} nextId={stages[index + 1]?.id}
            destinations={stages.filter(({ id, acceptsArchive }) => id !== stage.id && acceptsArchive)} archive={archive}
            archivePending={pending} archiving={pending && archivingId === stage.id} />
        </li>
      ))}
    </ol>
  );
}

function CrmStageForms({ position, stage, previousId, nextId, destinations, archive, archivePending, archiving }: {
  position: number;
  stage: Stage;
  previousId?: string;
  nextId?: string;
  destinations: Stage[];
  archive: (data: FormData) => void;
  archivePending: boolean;
  archiving: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink/5 font-mono text-xs text-neutral panel:bg-white/10 panel:text-white/70">{position}</span>
        <div className="min-w-0 flex-1 basis-56"><StageNameForm stage={stage} /></div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={stage.system ? "neutral" : "iris"}>{stage.system ? "Sistema" : "Personalizada"}</Badge>
          <span className="w-16 text-right text-sm tabular-nums text-neutral panel:text-white/60">
            {stage.leadCount.toLocaleString("pt-BR")} {stage.leadCount === 1 ? "lead" : "leads"}
          </span>
          <StageOrderForm stage={stage} previousId={previousId} nextId={nextId} />
        </div>
      </div>
      {!stage.system && <div className="pl-10"><ArchiveStageForm stage={stage} destinations={destinations} action={archive} pending={archivePending} loading={archiving} /></div>}
    </div>
  );
}

function StageOrderForm({ stage, previousId, nextId }: { stage: Stage; previousId?: string; nextId?: string }) {
  const [state, action, pending] = useActionState(saveCrmStage, null);
  useActionToast(state, pending, { entity: "ordem das etapas", action: "update", gender: "f" });

  return (
    <form action={action} className="flex gap-2" aria-label={`Ordem da etapa ${stage.name}`}>
      <input type="hidden" name="intent" value="move" />
      <input type="hidden" name="stageId" value={stage.id} />
      <input type="hidden" name="beforeId" value={previousId ?? ""} />
      <input type="hidden" name="afterId" value={nextId ?? ""} />
      <Button type="submit" variant="action" size="icon" name="direction" value="up" disabled={!previousId || pending} aria-label={`Subir ${stage.name}`} title="Subir etapa"><ArrowUp size={16} aria-hidden /></Button>
      <Button type="submit" variant="action" size="icon" name="direction" value="down" disabled={!nextId || pending} aria-label={`Descer ${stage.name}`} title="Descer etapa"><ArrowDown size={16} aria-hidden /></Button>
    </form>
  );
}

function ArchiveStageForm({ stage, destinations, action, pending, loading }: {
  stage: Stage; destinations: Stage[]; action: (data: FormData) => void; pending: boolean; loading: boolean;
}) {
  const [destination, setDestination] = useState("");
  const needsDestination = stage.leadCount > 0;
  const selected = destinations.some(({ id }) => id === destination) ? destination : "";

  return (
    <details>
      <summary className={`w-fit cursor-pointer text-sm hover:underline ${actionText}`}>Arquivar etapa</summary>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="archive" />
        <input type="hidden" name="stageId" value={stage.id} />
        <input type="hidden" name="destinationId" value={needsDestination ? selected : ""} />
        {needsDestination && (
          <div className="min-w-52 flex-1">
            <SelectMenu
              accent="signal"
              label="Etapa que vai receber os leads"
              options={[{ value: "", label: "Escolha o destino dos leads" }, ...destinations.map((candidate) => ({ value: candidate.id, label: candidate.name }))]}
              value={selected}
              onChange={setDestination}
              disabled={pending}
            />
          </div>
        )}
        <Button type="submit" variant="destructive" loading={loading} disabled={pending || (needsDestination && !selected)}>Confirmar arquivamento</Button>
      </form>
    </details>
  );
}
