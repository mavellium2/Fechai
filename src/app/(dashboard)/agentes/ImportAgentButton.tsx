"use client";

import { useActionState, useRef } from "react";
import { Upload } from "lucide-react";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import type { AgentUsage } from "@/modules/agent-engine/agents";
import { importAgentAction } from "./actions";
import { useActionToast } from "@/components/ui/toast";

export function ImportAgentButton({ usage, variant = "button" }: { usage: AgentUsage; variant?: "button" | "shortcut" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmNavigation = useUnsavedNavigation();
  const [state, action, pending] = useActionState(importAgentAction, null);
  useActionToast(state, pending, { entity: "agente", action: "create" });
  const close = () => confirmNavigation(() => dialogRef.current?.close(), dialogRef.current);

  return (
    <>
      <Button
        type="button"
        variant={variant === "shortcut" ? "ghost" : "outline"}
        className={variant === "shortcut" ? "agent-shortcut" : undefined}
        size="sm"
        disabled={!usage.canCreate}
        title={usage.canCreate ? undefined : `Seu plano permite ${usage.limit} agente(s)`}
        onClick={() => dialogRef.current?.showModal()}
      >
        <Upload size={14} aria-hidden />
        {variant === "shortcut" ? "Importar agente" : "Importar"}
      </Button>

      <dialog
        ref={dialogRef}
        onCancel={(event) => { event.preventDefault(); close(); }}
        aria-labelledby="importar-agente-titulo"
        className="m-auto w-[min(32rem,92vw)] rounded-surface border border-white/10 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <h2 id="importar-agente-titulo" className="font-display text-xl font-bold">
          Importar agente
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-white/65">
          Selecione um arquivo exportado pelo fechai. A cópia nasce desligada para você revisar antes
          de colocá-la em atendimento.
        </p>

        <UnsavedForm label="Importar agente" action={action} result={state} className="mt-5 space-y-4">
          <Field
            label="Arquivo do agente"
            htmlFor="agent-package"
            hint="Formato .fechai-agent.json, com até 45MB."
          >
            <input
              {...fieldProps("agent-package", { hint: true })}
              type="file"
              name="agentPackage"
              accept=".json,application/json,application/vnd.fechai.agent+json"
              required
              className="w-full text-sm text-white/70 file:mr-3 file:rounded-control file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-white/15"
            />
          </Field>

          <Alert tone="info">
            Conversas, contatos, agendamentos e voz gravada não entram no arquivo. Personalidade,
            regras, Cérebro e configurações das habilidades entram.
          </Alert>
          <FormFeedback error={state?.error} info={state?.info} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending} loadingLabel="Importando agente">
              Importar e revisar
            </Button>
          </div>
        </UnsavedForm>
      </dialog>
    </>
  );
}
