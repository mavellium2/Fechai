"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SidePanel } from "@/components/ui/side-panel";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/ui/toast";
import { UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { NAME_MAX, OBJECTIVE_MAX } from "@/modules/campaigns/limits";
import type { CampaignActionResult } from "@/modules/campaigns/result";
import type { CampaignView } from "@/modules/campaigns/view";
import { createCampaign, updateCampaign } from "./actions";

/** O que o formulário precisa para editar: os valores que já estão salvos. */
export type EditableCampaign = Pick<CampaignView, "id" | "name" | "objective" | "startsOn" | "endsOn">;

/**
 * Painel lateral de criar e editar campanha (não há rota `/campanhas/nova`).
 *
 * - **Esc e fechar com alteração não salva** passam pelo aviso padrão do
 *   produto (`useUnsavedNavigation`): o painel só fecha se a pessoa confirmar.
 * - **Cada abertura monta um formulário novo** (`key`): o que foi digitado e
 *   descartado não volta na próxima vez, e a edição abre sempre com o que está
 *   salvo agora.
 * - Fica dentro de um `<dialog>` modal, onde o toast do topo não é alcançável
 *   por teclado — por isso o erro também aparece aqui dentro, perto do campo.
 */
export function CampaignFormPanel({
  open,
  onClose,
  onSaved,
  campaign,
}: {
  open: boolean;
  onClose: () => void;
  /** Depois de salvar (já fechado o aviso de alterações): quem chama fecha o painel e decide o resto. */
  onSaved: (result: CampaignActionResult) => void;
  /** Sem isto o painel cria; com isto, edita. */
  campaign?: EditableCampaign;
}) {
  const confirmNavigation = useUnsavedNavigation();
  const requestClose = () => confirmNavigation(onClose);

  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }

  return (
    <SidePanel
      open={open}
      onClose={requestClose}
      title={campaign ? "Editar campanha" : "Nova campanha"}
      subtitle={campaign ? campaign.name : "Dê um nome e, se já souber, o período."}
    >
      <CampaignForm key={session} campaign={campaign} onCancel={requestClose} onSaved={onSaved} />
    </SidePanel>
  );
}

function CampaignForm({
  campaign,
  onCancel,
  onSaved,
}: {
  campaign?: EditableCampaign;
  onCancel: () => void;
  onSaved: (result: CampaignActionResult) => void;
}) {
  const editing = Boolean(campaign);
  const [state, formAction, pending] = useActionState(editing ? updateCampaign : createCampaign, null);
  useActionToast(state, pending, { entity: "campanha", action: editing ? "update" : "create", gender: "f" });

  // Sempre a função mais recente, sem entrar nas dependências do efeito.
  const savedRef = useRef(onSaved);
  useEffect(() => {
    savedRef.current = onSaved;
  });
  useEffect(() => {
    if (state?.ok) savedRef.current(state);
  }, [state]);

  // O foco vai para o Nome quando o painel abre. Este formulário monta ANTES de
  // o `<dialog>` abrir (o painel chama `showModal()` no efeito dele) e o
  // `showModal()` deixaria o foco no botão de fechar, o primeiro da tabulação.
  // Então espera o diálogo abrir; com o painel fechado (carga da página) desiste
  // depois de alguns quadros.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const focusWhenOpen = () => {
      const input = nameRef.current;
      if (!input) return;
      if (!input.closest("dialog")?.open) {
        if (tries++ < 10) frame = requestAnimationFrame(focusWhenOpen);
        return;
      }
      input.focus();
    };
    frame = requestAnimationFrame(focusWhenOpen);
    return () => cancelAnimationFrame(frame);
  }, []);

  const base = useId();
  const ids = {
    name: `${base}-nome`,
    objective: `${base}-objetivo`,
    starts: `${base}-inicio`,
    ends: `${base}-fim`,
    period: `${base}-periodo`,
  };

  const [objectiveLength, setObjectiveLength] = useState(campaign?.objective?.length ?? 0);

  const failed = state && !state.ok ? state : null;
  const fieldErrors = failed?.fieldErrors ?? {};
  // Erro de campo aparece junto do campo; o resto (permissão, "não encontrada")
  // vai no rodapé do formulário.
  const generalError = failed && Object.keys(fieldErrors).length === 0 ? failed.error : null;

  const objectiveField = fieldProps(ids.objective, { error: fieldErrors.objective });
  const startsField = fieldProps(ids.starts, { error: fieldErrors.startsOn });
  const endsField = fieldProps(ids.ends, { error: fieldErrors.endsOn });

  return (
    <UnsavedForm
      label={editing ? "Editar campanha" : "Nova campanha"}
      result={state}
      resetOnSuccess={!editing}
      action={formAction}
      className="space-y-5"
    >
      {campaign && <input type="hidden" name="id" value={campaign.id} />}

      <Field label="Nome" htmlFor={ids.name} error={fieldErrors.name}>
        <Input
          {...fieldProps(ids.name, { error: fieldErrors.name })}
          ref={nameRef}
          className="max-sm:h-11"
          name="name"
          required
          maxLength={NAME_MAX}
          autoComplete="off"
          placeholder="Ex.: Black Friday 2026"
          defaultValue={campaign?.name ?? ""}
        />
      </Field>

      <Field label="Objetivo" htmlFor={ids.objective} optional error={fieldErrors.objective}>
        <Textarea
          {...objectiveField}
          // O contador entra na descrição do campo: lido ao focar, sem anunciar a cada letra.
          aria-describedby={[`${ids.objective}-contador`, objectiveField["aria-describedby"]].filter(Boolean).join(" ")}
          name="objective"
          rows={3}
          maxLength={OBJECTIVE_MAX}
          placeholder="Ex.: Encher a agenda de avaliações de novembro."
          defaultValue={campaign?.objective ?? ""}
          onChange={(event) => setObjectiveLength(event.target.value.length)}
        />
        <p id={`${ids.objective}-contador`} className="mt-1 text-right text-xs tabular-nums text-neutral panel:text-white/55">
          {objectiveLength}/{OBJECTIVE_MAX}
        </p>
      </Field>

      <div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Início" htmlFor={ids.starts} optional error={fieldErrors.startsOn}>
            <Input
              {...startsField}
              aria-describedby={[ids.period, startsField["aria-describedby"]].filter(Boolean).join(" ")}
              className="max-sm:h-11"
              type="date"
              name="startsOn"
              defaultValue={campaign?.startsOn ?? ""}
            />
          </Field>
          <Field label="Fim" htmlFor={ids.ends} optional error={fieldErrors.endsOn}>
            <Input
              {...endsField}
              aria-describedby={[ids.period, endsField["aria-describedby"]].filter(Boolean).join(" ")}
              className="max-sm:h-11"
              type="date"
              name="endsOn"
              defaultValue={campaign?.endsOn ?? ""}
            />
          </Field>
        </div>
        <p id={ids.period} className="mt-2 text-sm text-neutral panel:text-white/55">
          Datas no horário de Brasília. Sem data de início, a campanha fica como rascunho.
        </p>
      </div>

      <FormFeedback error={generalError} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" className="max-sm:h-11" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" className="max-sm:h-11" loading={pending} loadingLabel="Salvando campanha">
          {editing ? "Salvar alterações" : "Criar campanha"}
        </Button>
      </div>
    </UnsavedForm>
  );
}
