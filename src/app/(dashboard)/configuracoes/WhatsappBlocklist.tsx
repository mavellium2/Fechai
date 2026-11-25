"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Plus, X } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBlockedPhone } from "@/modules/whatsapp/blocklist";
import { formatBlockedPhoneInput } from "@/modules/whatsapp/blocklist-input";
import { blockWhatsappNumber, unblockWhatsappNumber } from "../integracoes/actions";

export type BlockedRow = { id: string; phone: string; label: string | null };

/**
 * Lista de números que a conta ignora (todos os agentes, QR e Meta). Mora em
 * Configurações porque não é de um canal nem de um agente.
 *
 * Mora aqui e não em /conversas de propósito: o caso comum é bloquear um
 * número que ainda NÃO escreveu (o ex-fornecedor, o número de spam que já
 * incomodou o vizinho). Uma lista que só aceitasse contatos existentes
 * chegaria sempre tarde.
 *
 * A lista inteira fica visível — sem paginação nem "ver mais". Bloqueio é
 * coisa que se esquece de ter feito, e o cliente que "sumiu" costuma estar
 * aqui; esconder as linhas atrás de um clique é o que faz o suporte demorar
 * uma hora para achar o motivo.
 */
export function WhatsappBlocklist({
  blocked,
  as: Heading = "h2",
}: {
  blocked: BlockedRow[];
  /** Nível do título, para caber na hierarquia de quem o hospeda. */
  as?: "h2" | "h3";
}) {
  const router = useRouter();
  const phoneId = useId();
  const labelId = useId();
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string; info?: string }>, onOk?: () => void) {
    setError(null);
    setInfo(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        setInfo(res.info ?? "Pronto.");
        onOk?.();
      } else {
        setError(res.error ?? "Não foi possível completar a ação.");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 border-t border-white/10 pt-6">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger"
        >
          <Ban size={18} />
        </span>
        <div className="min-w-0">
          <Heading className="font-display text-base font-semibold text-white">Números bloqueados</Heading>
          <p className="mt-0.5 max-w-prose text-sm text-white/65">
            Vale para a conta inteira: todos os agentes e os dois números (QR e Meta) ignoram estes
            contatos por completo. Nada é respondido, a mensagem não entra em Conversas e quem está
            na lista não é avisado do bloqueio.
          </p>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => blockWhatsappNumber(phone, label), () => {
            setPhone("");
            setLabel("");
          });
        }}
      >
        <Field label="Número" htmlFor={phoneId} hint="Com DDD" className="min-w-[10rem] flex-1">
          <Input
            id={phoneId}
            inputMode="tel"
            autoComplete="off"
            placeholder="(11) 98765-4321"
            value={formatBlockedPhoneInput(phone)}
            onChange={(e) => setPhone(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="Anotação" htmlFor={labelId} optional className="min-w-[10rem] flex-1">
          <Input
            id={labelId}
            autoComplete="off"
            placeholder="ex: spam"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Button type="submit" variant="outline" loading={pending} disabled={pending || !phone}>
          <Plus size={16} aria-hidden />
          Bloquear
        </Button>
      </form>

      {blocked.length === 0 ? (
        <p className="text-sm text-white/50">
          Nenhum número bloqueado. Adicione um acima quando alguém não deve ser atendido pelo agente.
        </p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-surface border border-white/10">
          {blocked.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                {/* Mono: é um dado a conferir dígito a dígito, não texto corrido. */}
                <p className="font-mono text-sm text-white">{formatBlockedPhone(row.phone)}</p>
                {row.label && <p className="mt-0.5 truncate text-xs text-white/55">{row.label}</p>}
                {/^55\d{9}$/.test(row.phone) && (
                  <p className="mt-1 text-xs text-danger">
                    Este número parece incompleto. Remova e cadastre novamente com DDD.
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => unblockWhatsappNumber(row.id))}
              >
                <X size={16} aria-hidden />
                Desbloquear
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FormFeedback error={error} info={info} />
    </div>
  );
}
