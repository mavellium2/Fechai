"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampaignFormPanel } from "./CampaignForm";

/**
 * "Nova campanha": o botão e o painel lateral que ele abre. Depois de criar, a
 * pessoa vai para a página da campanha — é lá que anúncios, regras e resultados
 * vão morar, e a lista só mostraria a linha nova.
 *
 * `variant` existe porque a tela pode ter dois (o do cabeçalho e o do estado
 * vazio) e só um leva o destaque de conversão.
 */
export function NewCampaignButton({
  label = "Nova campanha",
  variant = "cta",
}: {
  label?: string;
  variant?: "cta" | "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant={variant} className="max-sm:h-11" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden />
        {label}
      </Button>
      <CampaignFormPanel
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(result) => {
          setOpen(false);
          if (result.id) router.push(`/campanhas/${result.id}`);
        }}
      />
    </>
  );
}
