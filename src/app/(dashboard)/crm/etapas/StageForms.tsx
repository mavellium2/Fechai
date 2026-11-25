"use client";

import { useActionState, useId, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
      <Button type="submit" variant="outline" loading={pending}>Salvar motivos</Button>
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
  const label = stage ? "Nome da etapa" : "Nova etapa personalizada";

  return (
    <UnsavedForm action={action} result={state} label={label} className="flex min-w-0 flex-wrap items-end gap-2">
      <input type="hidden" name="intent" value={stage ? "rename" : "create"} />
      {stage && <><input type="hidden" name="stageId" value={stage.id} /><input type="hidden" name="previousName" value={stage.name} /></>}
      <div className="min-w-44 flex-1">
        <Field label={label} htmlFor={id}>
          <Input id={id} name="name" value={draft ?? stage?.name ?? ""} onChange={(event) => setDraft(event.target.value)} disabled={pending} required maxLength={80} />
        </Field>
      </div>
      <Button type="submit" variant={stage ? "outline" : "default"} loading={pending}>{stage ? "Renomear" : "Criar etapa"}</Button>
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
    <ol className="space-y-3" aria-label="Ordem das etapas do pipeline">
      {stages.map((stage, index) => (
        <li key={stage.id}>
          <CrmStageForms stage={stage} previousId={stages[index - 1]?.id} nextId={stages[index + 1]?.id}
            destinations={stages.filter(({ id, acceptsArchive }) => id !== stage.id && acceptsArchive)} archive={archive}
            archivePending={pending} archiving={pending && archivingId === stage.id} />
        </li>
      ))}
    </ol>
  );
}

function CrmStageForms({ stage, previousId, nextId, destinations, archive, archivePending, archiving }: {
  stage: Stage;
  previousId?: string;
  nextId?: string;
  destinations: Stage[];
  archive: (data: FormData) => void;
  archivePending: boolean;
  archiving: boolean;
}) {
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><StageNameForm stage={stage} /></div>
        <StageOrderForm stage={stage} previousId={previousId} nextId={nextId} />
      </div>
      <p className="text-sm text-neutral panel:text-white/60">
        {stage.system ? "Etapa de sistema" : "Etapa personalizada"} · {stage.leadCount.toLocaleString("pt-BR")} {stage.leadCount === 1 ? "lead" : "leads"}
      </p>
      {!stage.system && <ArchiveStageForm stage={stage} destinations={destinations} action={archive} pending={archivePending} loading={archiving} />}
    </Card>
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
      <Button type="submit" variant="outline" size="icon" name="direction" value="up" disabled={!previousId || pending} aria-label={`Subir ${stage.name}`} title="Subir etapa"><ArrowUp size={16} aria-hidden /></Button>
      <Button type="submit" variant="outline" size="icon" name="direction" value="down" disabled={!nextId || pending} aria-label={`Descer ${stage.name}`} title="Descer etapa"><ArrowDown size={16} aria-hidden /></Button>
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
    <details className="border-t border-ink/10 pt-3 panel:border-white/10">
      <summary className="w-fit cursor-pointer text-sm font-medium">Arquivar etapa</summary>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="archive" />
        <input type="hidden" name="stageId" value={stage.id} />
        <input type="hidden" name="destinationId" value={needsDestination ? selected : ""} />
        {needsDestination && (
          <div className="min-w-52 flex-1">
            <SelectMenu
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
