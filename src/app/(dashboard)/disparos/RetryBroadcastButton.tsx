"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { sanitizeReason } from "@/components/ui/toast/messages";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { confirmBroadcastRetry } from "./actions";

export function RetryBroadcastButton({ campaignId, token, count, recentCount, hours, refresh }: {
  campaignId: string;
  token: string;
  count: number;
  recentCount: number;
  hours: string;
  refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [review, setReview] = useState({ token, count, recentCount });
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const save = useSaveFeedback({ entity: "reenvio", action: "create" });

  async function confirm() {
    let nextId: string | undefined;
    const result = await save.run(async () => {
      const response = await confirmBroadcastRetry(campaignId, review.token, consent, reviewed);
      if (response.ok) nextId = response.id;
      return response;
    });
    if (nextId) {
      dialog.current?.close();
      router.push(`/disparos/${nextId}`);
      return;
    }
    setError(sanitizeReason(result.error) ?? "Não foi possível confirmar o reenvio. Tente novamente.");
  }

  const contacts = (n: number) => `${n} ${n === 1 ? "contato" : "contatos"}`;
  return <>
    <Button type="button" variant="outline" onClick={() => {
      setReview({ token, count, recentCount });
      setError(null);
      setReviewed(false);
      setConsent(false);
      dialog.current?.showModal();
    }}>
      <RotateCcw size={16} aria-hidden /> Reenviar falhas ({count})
    </Button>
    <dialog
      ref={dialog}
      aria-labelledby={title}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      onCancel={(event) => { if (save.saving) event.preventDefault(); }}
      onClose={() => { if (error) void refresh(); }}
    >
      <h3 id={title} className="font-display text-lg font-semibold">Reenviar para {contacts(review.count)}?</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/70">
        Será criado um novo disparo com as mesmas mensagens, na próxima faixa permitida ({hours}).
        Só entram falhas confirmadas e elegíveis. Quem recebeu, respondeu ou tem resultado incerto fica de fora.
      </p>
      {review.recentCount > 0 && <p className="mt-2 text-sm text-warn">
        Outros disparos tiveram envios aceitos nos últimos 7 dias para {contacts(review.recentCount)} desta lista.
      </p>}
      <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} disabled={save.saving} />
          <span>Revisei as falhas, confirmei que as restrições foram resolvidas e conferi a frequência de envio.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={save.saving} />
          <span>Confirmo que estes contatos autorizaram o recebimento das mensagens.</span>
        </label>
        <FormFeedback error={error} />
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" disabled={save.saving} onClick={() => dialog.current?.close()}>Voltar</Button>
          <Button type="submit" disabled={!reviewed || !consent} loading={save.saving} loadingLabel="Confirmando">
            Confirmar reenvio
          </Button>
        </div>
      </form>
    </dialog>
  </>;
}
