"use client";

import { useActionState, useRef } from "react";
import { useActionToast } from "@/components/ui/toast";
import { Plus } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/ui/alert";
import type { AgentUsage } from "@/modules/agent-engine/agents";
import { createAgentAction } from "./actions";

/**
 * Criação de agente. Só o nome — o resto é o passo a passo da própria tela do
 * agente, para onde a action redireciona. Pedir persona inteira aqui era o
 * jeito antigo (todos os campos de uma vez, sem contexto).
 */
export function NewAgentButton({ usage, variant = "button" }: { usage: AgentUsage; variant?: "button" | "shortcut" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmNavigation = useUnsavedNavigation();
  const close = () => confirmNavigation(() => ref.current?.close(), ref.current);
  const [state, formAction, pending] = useActionState(createAgentAction, null);
  useActionToast(state, pending, { entity: "agente", action: "create" });

  if (!usage.canCreate) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={variant === "shortcut" ? "agent-shortcut" : undefined}
        disabled
        title={`Seu plano permite ${usage.limit} agente(s)`}
      >
        <Plus size={14} aria-hidden />
        {variant === "shortcut" ? "Novo agente" : "Criar agente"}
      </Button>
    );
  }

  return (
    <>
      <Button type="button" size="sm" variant={variant === "shortcut" ? "ghost" : "default"} className={variant === "shortcut" ? "agent-shortcut" : undefined} onClick={() => ref.current?.showModal()}>
        <Plus size={14} aria-hidden />
        {variant === "shortcut" ? "Novo agente" : "Criar agente"}
      </Button>

      <dialog
        ref={ref}
        onCancel={(event) => { event.preventDefault(); close(); }}
        aria-labelledby="novo-agente-titulo"
        className="m-auto w-[min(28rem,92vw)] rounded-surface border border-white/10 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <h2 id="novo-agente-titulo" className="font-display text-xl font-bold">
          Novo agente
        </h2>
        <p className="mt-1 text-sm text-white/65">
          Dê um nome que diga o que ele faz — “Vendas”, “Suporte”, “Unidade Centro”.
        </p>

        <UnsavedForm label="Novo agente" result={state}
          action={formAction}
          className="mt-5 space-y-4"
          onSubmit={() => posthog.capture("agent_creation_submitted")}
        >
          <Field label="Nome do agente" htmlFor="novo-agente-nome">
            <Input
              {...fieldProps("novo-agente-nome")}
              name="name"
              autoFocus
              required
              maxLength={60}
              placeholder="Ex: Vendas"
            />
          </Field>

          <FormFeedback error={state?.error} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending} loadingLabel="Criando agente">
              Criar e configurar
            </Button>
          </div>
        </UnsavedForm>
      </dialog>
    </>
  );
}
