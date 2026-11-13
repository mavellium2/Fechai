"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSaveFeedback } from "@/components/ui/toast";
import { saveCampaignKeywords } from "./setup-actions";

/** Palavras-chave: quem escreve uma delas na primeira mensagem entra na campanha. */
export function CampaignKeywordsForm({ campaignId, editable, keywords }: { campaignId: string; editable: boolean; keywords: string }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "palavras-chave", action: "save", gender: "f", plural: true });
  const [value, setValue] = useState(keywords);
  const id = useId();
  return (
    <section className="space-y-3">
      <h3 className="font-display text-base font-semibold text-ink panel:text-white">Palavras-chave</h3>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await save.run(() => saveCampaignKeywords(campaignId, value));
          if (result.ok) router.refresh();
        }}
      >
        <Field
          label="Termos, separados por vírgula"
          htmlFor={id}
          optional
          hint="Quem escrever um deles na primeira mensagem entra na campanha. Maiúscula e acento não importam."
        >
          <Input
            id={id}
            className="max-sm:h-11 sm:min-w-80"
            disabled={!editable}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ex.: implante, evento implante"
          />
        </Field>
        {editable && (
          <Button type="submit" variant="outline" className="max-sm:h-11" disabled={value === keywords || save.saving} loading={save.saving} loadingLabel="Salvando">
            Salvar
          </Button>
        )}
      </form>
    </section>
  );
}
