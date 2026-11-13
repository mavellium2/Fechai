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
 * É a ação primária da tela e, no painel, a ação primária é `iris`
 * (`variant="default"`): `signal` (`cta`) é das telas de conversão.
 */
export function NewCampaignButton({ label = "Nova campanha" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" className="max-sm:h-11" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden />
        {label}
      </Button>
      <CampaignFormPanel
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(result) => {
          setOpen(false);
          if (result.id) router.push(`/campanhas/${result.id}?aba=anuncios`);
        }}
      />
    </>
  );
}
