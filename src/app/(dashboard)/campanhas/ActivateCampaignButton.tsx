"use client";

import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSaveFeedback } from "@/components/ui/toast";
import { activateCampaign } from "./actions";

/** "Ativar" da revisão: o mesmo da barra de ações, no fim do passo a passo. */
export function ActivateCampaignButton({ campaignId, disabled }: { campaignId: string; disabled?: boolean }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "campanha", action: "update", gender: "f" });
  return (
    <Button
      type="button"
      className="max-sm:h-11 max-sm:w-full"
      loading={save.saving}
      loadingLabel="Ativando a campanha"
      disabled={disabled}
      onClick={async () => {
        const result = await save.run(() => activateCampaign(campaignId));
        if (result.ok) router.push(`/campanhas/${campaignId}?aba=visao-geral`);
      }}
    >
      <Rocket size={16} aria-hidden />
      Ativar campanha
    </Button>
  );
}
