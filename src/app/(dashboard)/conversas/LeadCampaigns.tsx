"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { useSaveFeedback } from "@/components/ui/toast";
import { addLeadToCampaign } from "../campanhas/setup-actions";

const SOURCE: Record<string, string> = { anuncio: "anúncio", disparo: "disparo", palavra_chave: "palavra-chave", manual: "manual" };

/**
 * Campanhas do lead no card da conversa (o "card do CRM"): em quais ele está,
 * por qual origem, e adicionar a uma campanha à mão — o mesmo
 * `addLeadToCampaign` da aba Leads da campanha.
 */
export function LeadCampaigns({
  leadId,
  campaigns,
  available,
}: {
  leadId: string;
  campaigns: { id: string; name: string; source: string }[];
  available: { id: string; name: string }[];
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "lead", action: "update", gender: "m" });
  const [choice, setChoice] = useState("");
  const options = available.filter((c) => !campaigns.some((own) => own.id === c.id));

  return (
    <section className="contact-section">
      <h3>Campanhas</h3>
      {campaigns.length ? (
        <ul>
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/campanhas/${c.id}?aba=leads`}>{c.name}</Link> · {SOURCE[c.source] ?? c.source}
            </li>
          ))}
        </ul>
      ) : (
        <p>Fora de campanhas.</p>
      )}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SelectMenu
            label="Adicionar à campanha"
            value={choice}
            onChange={setChoice}
            placeholder="Adicionar à campanha"
            options={[{ value: "", label: "Adicionar à campanha" }, ...options.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!choice || save.saving}
            loading={save.saving}
            loadingLabel="Adicionando"
            onClick={async () => {
              const result = await save.run(() => addLeadToCampaign(choice, leadId));
              if (result.ok) {
                setChoice("");
                router.refresh();
              }
            }}
          >
            Adicionar
          </Button>
        </div>
      )}
    </section>
  );
}
