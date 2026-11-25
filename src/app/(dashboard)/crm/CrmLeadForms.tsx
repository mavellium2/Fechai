"use client";

import { useActionState, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { useActionToast } from "@/components/ui/toast";
import { CRM_TAG_MAX, CRM_TASK_MAX } from "@/modules/crm/board-filters";
import { saveCrmLead } from "./actions";

type Choice = { id: string; name: string };
type Operation = "addTag" | "newTag" | "removeTag" | "createTask" | "completeTask" | "claim" | "transfer" | "returnToAi" | "itWasMe";

function LeadForm({ leadId, operation, children, feedback, onSuccess }: {
  leadId: string;
  operation: Operation;
  children: (pending: boolean) => ReactNode;
  feedback?: "Tarefa" | "Etiqueta" | "Atribuição";
  onSuccess?: () => void;
}) {
  const [state, submit, pending] = useActionState(async (previous: Awaited<ReturnType<typeof saveCrmLead>> | null, form: FormData) => {
    const result = await saveCrmLead(previous, form);
    if (result.ok) onSuccess?.();
    return result;
  }, null);
  useActionToast(state, pending, { entity: feedback?.toLowerCase() ?? "etiqueta", gender: "f" });
  return (
    <form action={submit} className="min-w-0 space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="operation" value={operation} />
      {children(pending)}
      {!pending && <FormFeedback error={state?.error} info={state?.info} />}
    </form>
  );
}

export function CrmAssumeLead({ leadId, conversationId }: { leadId: string; conversationId: string }) {
  return (
    <LeadForm leadId={leadId} operation="claim" feedback="Atribuição">
      {(pending) => (
        <>
          <input type="hidden" name="conversationId" value={conversationId} />
          <Button variant="outline" size="sm" type="submit" loading={pending}>Assumir atendimento</Button>
        </>
      )}
    </LeadForm>
  );
}

/**
 * CRM-09: alguém respondeu pelo celular da clínica e ninguém se identificou.
 * "Fui eu" assume a conversa e fica com essas respostas.
 */
export function CrmItWasMe({ leadId, conversationId }: { leadId: string; conversationId: string }) {
  return (
    <LeadForm leadId={leadId} operation="itWasMe" feedback="Atribuição">
      {(pending) => (
        <div className="space-y-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <p className="text-sm text-neutral panel:text-white/70">
            Alguém da equipe respondeu pelo celular da clínica e ainda não se identificou.
          </p>
          <Button variant="outline" size="sm" type="submit" loading={pending}>Fui eu</Button>
        </div>
      )}
    </LeadForm>
  );
}

/**
 * CRM-07: com alguém responsável, o card troca o "Assumir" por transferir e
 * devolver para a IA. O responsável que a tela mostra vai junto, e o servidor
 * recusa se ele mudou no meio.
 */
export function CrmHandoffControls({ leadId, conversationId, assignedUserId, canReturn, users }: {
  leadId: string;
  conversationId: string;
  assignedUserId: string | null;
  canReturn: boolean;
  users: Choice[];
}) {
  const [selected, setSelected] = useState("");
  const others = users.filter(({ id }) => id !== assignedUserId);
  const toUserId = others.some(({ id }) => id === selected) ? selected : "";
  return (
    <div className="space-y-3">
      {assignedUserId && others.length > 0 && (
        <LeadForm leadId={leadId} operation="transfer" feedback="Atribuição" onSuccess={() => setSelected("")}>
          {(pending) => (
            <div className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="expectedUserId" value={assignedUserId} />
              <Field className="min-w-40 flex-1" label="Transferir para" htmlFor="crm-transfer-to" labelId="crm-transfer-to-label">
                <SelectMenu name="toUserId" label="Transferir para" labelledBy="crm-transfer-to-label" value={toUserId} onChange={setSelected}
                  disabled={pending} options={[{ value: "", label: "Selecione" }, ...others.map(({ id, name }) => ({ value: id, label: name }))]} />
              </Field>
              <Button variant="outline" size="sm" type="submit" loading={pending} disabled={!toUserId}>Transferir</Button>
            </div>
          )}
        </LeadForm>
      )}
      {canReturn && (
        <LeadForm leadId={leadId} operation="returnToAi" feedback="Atribuição">
          {(pending) => (
            <>
              <input type="hidden" name="conversationId" value={conversationId} />
              <Button variant="outline" size="sm" type="submit" loading={pending}>Devolver para a IA</Button>
            </>
          )}
        </LeadForm>
      )}
    </div>
  );
}

export function CrmLeadTags({ leadId, tags, attached }: { leadId: string; tags: Choice[]; attached: string[] }) {
  const [selected, setSelected] = useState("");
  const applied = new Set(attached);
  const eligible = tags.filter(({ id }) => !applied.has(id));
  const tagId = eligible.some(({ id }) => id === selected) ? selected : "";
  return (
    <div className="space-y-4">
      {attached.length === 0 && <p className="text-sm text-neutral panel:text-white/55">Nenhuma etiqueta no lead.</p>}
      <div className="flex flex-wrap gap-2">
        {tags.filter(({ id }) => applied.has(id)).map((tag) => (
          <LeadForm key={tag.id} leadId={leadId} operation="removeTag">
            {(pending) => (
              <div className="flex max-w-full items-center gap-1 rounded-control bg-ink/5 py-0.5 pl-2 text-sm panel:bg-white/10">
                <span className="min-w-0 break-all">{tag.name}</span>
                <input type="hidden" name="tagId" value={tag.id} />
                <Button type="submit" variant="ghost" size="icon" loading={pending} aria-label={`Remover etiqueta ${tag.name}`}><X size={14} aria-hidden /></Button>
              </div>
            )}
          </LeadForm>
        ))}
      </div>
      {eligible.length > 0 && (
        <LeadForm leadId={leadId} operation="addTag" onSuccess={() => setSelected("")}>
          {(pending) => (
            <div className="flex flex-wrap items-end gap-2">
              <Field className="min-w-40 flex-1" label="Etiqueta existente" htmlFor="crm-tag-existing" labelId="crm-tag-existing-label">
                <SelectMenu name="tagId" label="Etiqueta existente" labelledBy="crm-tag-existing-label" value={tagId} onChange={setSelected}
                  disabled={pending} options={[{ value: "", label: "Selecione" }, ...eligible.map(({ id, name }) => ({ value: id, label: name }))]} />
              </Field>
              <Button type="submit" variant="outline" loading={pending} disabled={!tagId}>Aplicar</Button>
            </div>
          )}
        </LeadForm>
      )}
      <LeadForm leadId={leadId} operation="newTag">
        {(pending) => (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-40 flex-1" label="Nova etiqueta" htmlFor="crm-tag-new">
              <Input id="crm-tag-new" name="name" required maxLength={CRM_TAG_MAX} />
            </Field>
            <Button type="submit" variant="outline" loading={pending}>Criar e aplicar</Button>
          </div>
        )}
      </LeadForm>
    </div>
  );
}

export function CrmTaskForm({ leadId, users }: { leadId: string; users: Choice[] }) {
  const [assignedUserId, setAssignee] = useState("");
  return (
    <LeadForm leadId={leadId} operation="createTask" feedback="Tarefa" onSuccess={() => setAssignee("")}>
      {(pending) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2" label="Tarefa" htmlFor="crm-task-text">
            <Input id="crm-task-text" name="text" required maxLength={CRM_TASK_MAX} placeholder="Ex. Confirmar disponibilidade" />
          </Field>
          <Field label="Prazo (horário de Brasília)" htmlFor="crm-task-due">
            <Input className="min-w-0" id="crm-task-due" name="dueAt" type="datetime-local" required />
          </Field>
          <Field label="Responsável pela tarefa" htmlFor="crm-task-user" labelId="crm-task-user-label">
            <SelectMenu name="assignedUserId" label="Responsável pela tarefa" labelledBy="crm-task-user-label" value={assignedUserId} onChange={setAssignee}
              disabled={pending} options={[{ value: "", label: "Sem responsável" }, ...users.map(({ id, name }) => ({ value: id, label: name }))]} />
          </Field>
          <div className="sm:col-span-2"><Button type="submit" variant="outline" loading={pending}>Adicionar tarefa</Button></div>
        </div>
      )}
    </LeadForm>
  );
}

export function CrmCompleteTask({ leadId, taskId, label }: { leadId: string; taskId: string; label: string }) {
  return (
    <LeadForm leadId={leadId} operation="completeTask" feedback="Tarefa">
      {(pending) => (
        <>
          <input type="hidden" name="taskId" value={taskId} />
          <Button type="submit" variant="outline" size="sm" loading={pending} aria-label={`Concluir tarefa ${label}`}>Concluir</Button>
        </>
      )}
    </LeadForm>
  );
}
