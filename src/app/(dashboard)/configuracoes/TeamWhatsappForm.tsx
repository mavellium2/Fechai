"use client";

import { useActionState, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useActionToast, useSaveFeedback } from "@/components/ui/toast";
import { maskPhone } from "@/lib/br-lead";
import { dateLabel, phoneLabel, timeLabel } from "@/lib/format";
import {
  cancelTeamWhatsappAction,
  removeTeamWhatsappAction,
  startTeamWhatsappAction,
  type TeamWhatsappResult,
} from "./actions";

type Props = {
  /** Número confirmado (só dígitos), ou null. */
  phone: string | null;
  verifiedAt: string | null;
  /** Número digitado e ainda não confirmado. */
  pendingPhone: string | null;
  codeExpiresAt: string | null;
  /** Calculado no servidor: o código pendente ainda vale. */
  codeValid: boolean;
  /** O QR da clínica está conectado: é por ele que o `#vincular` chega. */
  qrConnected: boolean;
};

const POLL_MS = 5_000;

/**
 * Enquanto há um código valendo, pergunta a situação a uma rota curta e só
 * recarrega a página quando ela muda (mesmo padrão do pulso da agenda): o
 * `#vincular` chega pelo celular da pessoa, fora desta aba. No vencimento do
 * código recarrega uma vez, para a tela mostrar que venceu.
 */
function useConfirmationWatch(active: boolean, until: string | null, verifiedAt: string | null) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const deadline = until ? Date.parse(until) : Number.NaN;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      if (Number.isFinite(deadline) && Date.now() > deadline) {
        window.clearInterval(timer);
        router.refresh();
        return;
      }
      try {
        const res = await fetch("/api/configuracoes/whatsapp", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const body = (await res.json()) as { status: string; verifiedAt: string | null };
        if (body.status !== "pending" || body.verifiedAt !== verifiedAt) {
          window.clearInterval(timer);
          router.refresh();
        }
      } catch {
        // Rede instável: tenta de novo na próxima volta.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, until, verifiedAt, router]);
}

export function TeamWhatsappForm({ phone, verifiedAt, pendingPhone, codeExpiresAt, codeValid, qrConnected }: Props) {
  const [state, formAction, pending] = useActionState(startTeamWhatsappAction, null as TeamWhatsappResult | null);
  useActionToast(state, pending, { entity: "código", action: "create" });
  const cancel = useSaveFeedback({ entity: "pedido", action: "delete" });
  const remove = useSaveFeedback({ entity: "WhatsApp", action: "delete" });
  const [changing, setChanging] = useState(false);
  const [value, setValue] = useState("");
  const fieldId = useId();
  useConfirmationWatch(Boolean(pendingPhone && codeValid), codeExpiresAt, verifiedAt);

  // O código só existe na resposta que o gerou: recarregar a página o perde.
  const fresh = state?.ok && state.linkCode && state.phone === pendingPhone && codeValid ? state : null;
  const showForm = !pendingPhone && (!phone || changing);

  async function run(feedback: ReturnType<typeof useSaveFeedback>, action: () => Promise<{ ok: boolean }>) {
    const result = await feedback.run(action);
    if (result.ok) setChanging(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/60">
        Com o seu WhatsApp confirmado, o Fechai sabe que é você quando você escreve no grupo de transbordo.
      </p>

      {!qrConnected && (
        <Alert tone="warn">
          A confirmação chega pelo WhatsApp da clínica conectado por QR code, que não está conectado agora.{" "}
          <Link href="/integracoes" className="underline underline-offset-2">Conectar em Integrações</Link>
        </Alert>
      )}

      {phone && verifiedAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-white/10 px-3 py-2">
          <p className="min-w-0 text-sm">
            <span className="font-medium text-white/90">{phoneLabel(phone)}</span>
            <span className="text-white/60"> · confirmado em {dateLabel(new Date(verifiedAt))}</span>
          </p>
          {!pendingPhone && (
            <div className="flex flex-wrap gap-2">
              {!changing && <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)}>Trocar número</Button>}
              <Button type="button" variant="ghost" size="sm" loading={remove.saving} loadingLabel="Desligando" onClick={() => void run(remove, removeTeamWhatsappAction)}>
                Desligar
              </Button>
            </div>
          )}
        </div>
      )}

      {pendingPhone && (
        <div className="space-y-3 rounded-control border border-white/10 p-3" aria-live="polite">
          {!codeValid ? (
            <p className="text-sm text-white/70">O código para {phoneLabel(pendingPhone)} venceu. Gere outro para confirmar.</p>
          ) : fresh?.linkCode ? (
            <>
              <p className="text-sm text-white/70">
                Do WhatsApp {phoneLabel(pendingPhone)}, mande esta mensagem para o número da clínica, no privado ou no grupo de transbordo:
              </p>
              <p className="font-mono text-xl tracking-[0.2em] text-white [overflow-wrap:anywhere]">#vincular {fresh.linkCode}</p>
              {fresh.expiresAt && (
                <p className="text-xs text-white/55">
                  Vale até {timeLabel(new Date(fresh.expiresAt))}. Esta tela atualiza sozinha quando a mensagem chegar.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-white/70">
              Aguardando a mensagem de {phoneLabel(pendingPhone)}. Se você não anotou o código, gere outro.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <form action={formAction}>
              <input type="hidden" name="phone" value={pendingPhone} />
              <Button type="submit" variant="outline" size="sm" loading={pending} loadingLabel="Gerando código">Gerar outro código</Button>
            </form>
            <Button type="button" variant="ghost" size="sm" loading={cancel.saving} loadingLabel="Cancelando" onClick={() => void run(cancel, cancelTeamWhatsappAction)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <Field className="min-w-0 flex-1" label={phone ? "Novo número" : "Seu celular com WhatsApp"} htmlFor={fieldId}
            hint="Fica ligado só ao seu usuário. Duas pessoas da equipe não podem usar o mesmo número.">
            <Input {...fieldProps(fieldId, { hint: true })} name="phone" inputMode="tel" autoComplete="tel"
              placeholder="(11) 98765-4321" required value={value} onChange={(event) => setValue(maskPhone(event.target.value))} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={pending} loadingLabel="Gerando código">Gerar código</Button>
            {changing && <Button type="button" variant="ghost" onClick={() => setChanging(false)}>Cancelar</Button>}
          </div>
        </form>
      )}
    </div>
  );
}
