"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { useActionToast } from "@/components/ui/toast";
import { CRM_MANUAL_NAME_MAX } from "@/modules/crm/limits";
import { createCrmLead } from "./actions";

type Stage = { id: string; name: string; kind: string | null };

/**
 * Cadastro de lead pelo quadro. A etapa escolhida é a de entrada: o lead nasce
 * nela, sem conversa e sem mensagem. O telefone é a chave que evita duplicar
 * um contato que já existe na conta.
 */
export function CrmLeadCreateDialog({ stages, defaultStageId, close }: {
  stages: Stage[]; defaultStageId: string; close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [stageId, setStageId] = useState(defaultStageId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [state, submit, pending] = useActionState(createCrmLead, null);
  useActionToast(state, pending, { entity: "lead", action: "create" });
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { if (state?.ok) ref.current?.close(); }, [state]);

  // Perdido exige motivo e justificativa na movimentação; não é destino de cadastro.
  const options = stages.filter(({ kind }) => kind !== "lost").map(({ id, name: label }) => ({ value: id, label }));

  return (
    <dialog ref={ref} onClose={close} aria-labelledby={title} onCancel={(event) => { if (pending) event.preventDefault(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-surface border border-ink/10 bg-white p-5 text-ink backdrop:bg-ink/70 panel:border-white/15 panel:bg-ink panel:text-white">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={title} className="font-display break-words text-lg font-semibold">Adicionar lead</h2>
          <p className="mt-1 text-sm text-neutral panel:text-white/60">Cadastro manual: entra no quadro sem iniciar conversa.</p>
        </div>
        <Button type="button" variant="action" size="icon" aria-label="Fechar" onClick={() => ref.current?.close()} disabled={pending}>
          <X size={18} aria-hidden />
        </Button>
      </div>
      <form action={submit} className="space-y-4">
        <Field label="Nome" htmlFor={`${title}-name`} optional>
          <Input {...fieldProps(`${title}-name`)} name="name" maxLength={CRM_MANUAL_NAME_MAX} autoFocus
            placeholder="Ex: Ana Souza" value={name} onChange={(event) => setName(event.target.value)} readOnly={pending} />
        </Field>
        <Field label="Telefone" htmlFor={`${title}-phone`} hint="Formato livre — ex.: 11 99999-9999">
          <Input {...fieldProps(`${title}-phone`)} name="phone" inputMode="tel" autoComplete="tel" required
            placeholder="(11) 99999-9999" value={phone} onChange={(event) => setPhone(event.target.value)} readOnly={pending} />
        </Field>
        <Field label="Etapa inicial" htmlFor={`${title}-stage`} labelId={`${title}-stage-label`}>
          <SelectMenu name="stageId" accent="signal" label="Etapa inicial" labelledBy={`${title}-stage-label`} value={stageId}
            onChange={setStageId} disabled={pending} options={options} />
        </Field>
        <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="action" onClick={() => ref.current?.close()} disabled={pending}>Cancelar</Button>
          <Button type="submit" variant="cta" className="text-ink" loading={pending} loadingLabel="Adicionando lead" disabled={!stageId || !phone.trim()}>
            <Plus size={16} aria-hidden />Adicionar
          </Button>
        </div>
      </form>
    </dialog>
  );
}
