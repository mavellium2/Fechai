"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { approveProposalAction, rejectProposalAction } from "./actions";

/**
 * Decisão sobre a proposta. Cada botão tem o próprio `useSaveFeedback`: carregando,
 * erro (vencida, desatualizada, já decidida) e sucesso vão ao toast do topo
 * (TOASTS.md). Erro fica até fechar; a página só é recarregada no sucesso.
 */
export function ProposalDecision({ proposalId }: { proposalId: string }) {
  const uid = useId();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const approve = useSaveFeedback({ entity: "proposta", action: "update", gender: "f" });
  const reject = useSaveFeedback({ entity: "recusa da proposta", action: "save", gender: "f" });
  const busy = approve.saving || reject.saving;

  function onApprove() {
    void approve
      .run(async () => {
        const done = await approveProposalAction({ proposalId });
        return done.ok ? { ok: true, info: done.info } : { ok: false, error: done.error };
      })
      .then((result) => {
        // Recusa por vencida/desatualizada também muda o estado: recarrega para a tela dizer a situação nova.
        router.refresh();
        return result;
      });
  }

  function onReject() {
    void reject
      .run(async () => {
        const done = await rejectProposalAction({ proposalId, reason });
        return done.ok ? { ok: true, info: done.info } : { ok: false, error: done.error };
      })
      .then((result) => {
        if (result.ok) router.refresh();
        return result;
      });
  }

  return (
    <section className="rounded-surface border border-white/10 bg-white/5 p-6">
      <h2 className="font-display text-lg font-semibold text-white">Decisão</h2>
      <p className="mt-1 text-sm text-white/60">
        Aprovar grava a mudança no agente, agora. Recusar não altera nada e guarda o motivo.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={onApprove} loading={approve.saving} loadingLabel="Aplicando" disabled={busy}>
          <Check size={15} aria-hidden />
          Aprovar e gravar
        </Button>
      </div>

      <div className="mt-6 border-t border-white/10 pt-5">
        <Field
          label="Motivo da recusa"
          htmlFor={`${uid}-reason`}
          hint="Obrigatório para recusar. Quem propôs lê o motivo."
        >
          <Textarea
            {...fieldProps(`${uid}-reason`, { hint: true })}
            value={reason}
            maxLength={1000}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="destructive"
            onClick={onReject}
            loading={reject.saving}
            loadingLabel="Recusando"
            disabled={busy || !reason.trim()}
          >
            <X size={15} aria-hidden />
            Recusar
          </Button>
        </div>
      </div>
    </section>
  );
}
