"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignView } from "@/modules/campaigns/view";
import { CampaignFormPanel } from "./CampaignForm";

/** "Editar dados" dentro da aba Dados gerais: abre o mesmo painel do cabeçalho. */
export function EditCampaignButton({ campaign }: { campaign: CampaignView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => setOpen(true)}>
        <Pencil size={16} aria-hidden />
        Editar dados
      </Button>
      <CampaignFormPanel open={open} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} campaign={campaign} />
    </>
  );
}
