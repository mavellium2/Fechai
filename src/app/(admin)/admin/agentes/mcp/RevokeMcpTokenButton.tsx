"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { revokeMcpTokenAction } from "./actions";

export function RevokeMcpTokenButton({
  tenantId,
  tokenId,
  label,
}: {
  tenantId: string;
  tokenId: string;
  label: string;
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "token", action: "update", gender: "m" });

  return (
    <ConfirmButton
      size="sm"
      confirm={{
        title: `Revogar “${label}”?`,
        description:
          "O token deixa de funcionar na hora, em qualquer ferramenta que o esteja usando. Não dá para desfazer: emita outro se precisar.",
        confirmLabel: "Revogar token",
        tone: "danger",
      }}
      // O ConfirmButton só tem try/finally (sem catch): uma rejeição aqui
      // deixaria o diálogo aberto e a pessoa sem aviso. `run` nunca lança —
      // exceção vira toast de erro via `errorToResult` — e redirects do Next
      // (sessão expirada) passam intactos.
      onConfirm={async () => {
        const result = await save.run(async () => {
          const done = await revokeMcpTokenAction({ tenantId, tokenId });
          return done.ok ? { ok: true, info: "Token revogado." } : { ok: false, error: done.error };
        });
        if (result.ok) router.refresh();
      }}
    >
      <Ban size={14} aria-hidden />
      Revogar
    </ConfirmButton>
  );
}
