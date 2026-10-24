"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
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
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmButton
        size="sm"
        confirm={{
          title: `Revogar “${label}”?`,
          description:
            "O token deixa de funcionar na hora, em qualquer ferramenta que o esteja usando. Não dá para desfazer: emita outro se precisar.",
          confirmLabel: "Revogar token",
          tone: "danger",
        }}
        onConfirm={async () => {
          setError(null);
          const result = await revokeMcpTokenAction({ tenantId, tokenId });
          if (!result.ok) setError(result.error);
          else router.refresh();
        }}
      >
        <Ban size={14} aria-hidden />
        Revogar
      </ConfirmButton>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
