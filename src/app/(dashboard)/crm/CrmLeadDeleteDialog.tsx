"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Trash2 } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/ui/toast";
import type { CrmBoardCard } from "@/modules/crm/board";
import { deleteCrmLead } from "./actions";

/**
 * Confirmação de exclusão do card. Lead com conversa ou agendamento é recusado
 * no servidor — aqui só se pergunta o que a pessoa está tirando do quadro.
 */
export function CrmLeadDeleteDialog({ lead, close }: { lead: CrmBoardCard; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [state, submit, pending] = useActionState(deleteCrmLead, null);
  useActionToast(state, pending, { entity: "lead", action: "delete" });
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { if (state?.ok) ref.current?.close(); }, [state]);

  return (
    <dialog ref={ref} onClose={close} aria-labelledby={title} onCancel={(event) => { if (pending) event.preventDefault(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-surface border border-ink/10 bg-white p-5 text-ink backdrop:bg-ink/70 panel:border-white/15 panel:bg-ink panel:text-white">
      <h2 id={title} className="font-display break-words text-lg font-semibold">Excluir {lead.name}?</h2>
      <p className="mt-2 text-sm text-neutral panel:text-white/65">
        O card sai do quadro e o cadastro é apagado. Só é possível excluir lead
        sem conversa e sem agendamento — atendimento real fica protegido.
      </p>
      <form action={submit} className="mt-4 space-y-4">
        <input type="hidden" name="leadId" value={lead.id} />
        <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => ref.current?.close()} disabled={pending}>Cancelar</Button>
          <Button type="submit" variant="destructiveSolid" loading={pending} loadingLabel="Excluindo lead">
            <Trash2 size={16} aria-hidden />Excluir
          </Button>
        </div>
      </form>
    </dialog>
  );
}
