"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/alert";
import { useActionToast } from "@/components/ui/toast";
import { UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { ContactProfileFields } from "@/components/contacts/ContactProfileFields";
import type { ContactProfileData } from "@/modules/crm/contact-profile-shape";
import { saveContactProfile } from "./actions";

/**
 * Edição dos dados do contato pela tela de Contatos. O formulário só monta
 * quando o diálogo abre: a lista pode ter centenas de contatos.
 */
export function EditContactDialog({ leadId, data }: { leadId: string; data: ContactProfileData }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const confirmNavigation = useUnsavedNavigation();
  const close = () => confirmNavigation(() => ref.current?.close(), ref.current);
  const [state, formAction, pending] = useActionState(saveContactProfile, null);
  useActionToast(state, pending, { entity: "contato", action: "update" });
  const titleId = `editar-contato-${leadId}`;

  useEffect(() => {
    if (state?.ok) ref.current?.close();
  }, [state]);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(true); ref.current?.showModal(); }}
        aria-label={`Editar contato ${data.name || data.phone}`}>
        <Pencil size={14} aria-hidden />
        Editar
      </Button>

      <dialog
        ref={ref}
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClose={() => setOpen(false)}
        aria-labelledby={titleId}
        className="m-auto max-h-[90vh] w-[min(32rem,92vw)] overflow-y-auto rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-semibold">Editar contato</h2>
            <p className="mt-1 text-sm text-white/55">
              O que você salvar aqui vale no painel e para o agente. O original do WhatsApp fica guardado.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="shrink-0 rounded-control p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {open && (
          <UnsavedForm label="Editar contato" result={state} action={formAction} className="space-y-4">
            <input type="hidden" name="leadId" value={leadId} />
            <ContactProfileFields idPrefix={titleId} data={data} />
            <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>Cancelar</Button>
              <Button type="submit" size="sm" loading={pending} loadingLabel="Salvando contato">Salvar</Button>
            </div>
          </UnsavedForm>
        )}
      </dialog>
    </>
  );
}
