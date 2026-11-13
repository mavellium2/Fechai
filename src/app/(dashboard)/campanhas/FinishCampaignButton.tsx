"use client";

import { CircleStop } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm-dialog";

/**
 * Encerrar é a única ação de status sem volta (o fim vira "agora" e terminada
 * não reabre), então é a única que confirma — as reversíveis não perguntam.
 */
export function FinishCampaignButton({
  className,
  disabled,
  onFinish,
}: {
  className?: string;
  disabled?: boolean;
  onFinish: () => Promise<void>;
}) {
  return (
    <ConfirmButton
      variant="outline"
      className={className}
      disabled={disabled}
      confirm={{
        title: "Encerrar a campanha agora?",
        description:
          "O fim passa a ser agora: as regras do agente deixam de valer e os leads voltam ao atendimento normal. Os resultados continuam nos relatórios. Não dá para reabrir.",
        confirmLabel: "Encerrar campanha",
        tone: "danger",
      }}
      onConfirm={onFinish}
    >
      <CircleStop size={16} aria-hidden />
      Encerrar
    </ConfirmButton>
  );
}
