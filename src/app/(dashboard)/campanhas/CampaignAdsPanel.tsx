"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { MousePointerClick, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSaveFeedback } from "@/components/ui/toast";
import { linkCampaignAd, unlinkCampaignAd } from "./setup-actions";

type LinkedAd = {
  id: string;
  adId: string | null;
  adsetId: string | null;
  metaCampaignId: string | null;
  code: string | null;
  displayName: string;
};
type Captured = { key: string; adId: string | null; code: string | null; name: string | null; leads: number; lastAt: string };

/**
 * Anúncios da campanha. O lead que chega por um anúncio vinculado entra na
 * campanha sozinho (origem "anúncio"). Duas formas de vincular:
 *
 * - **Da lista:** os anúncios que já trouxeram leads para a conta, com o id e
 *   o código que o WhatsApp entregou — é o que de fato atribui o lead.
 * - **À mão:** o id do anúncio (Gerenciador de Anúncios) ou o código escrito
 *   nele, para o anúncio que ainda não trouxe ninguém.
 */
export function CampaignAdsPanel({
  campaignId,
  editable,
  ads,
  captured,
}: {
  campaignId: string;
  editable: boolean;
  ads: LinkedAd[];
  captured: Captured[];
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "anúncio", action: "update", gender: "m" });
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState({ adId: "", adsetId: "", metaCampaignId: "", code: "", displayName: "" });
  const base = useId();

  const linkedKeys = new Set(ads.flatMap((ad) => [ad.adId ? `id:${ad.adId}` : "", ad.code ? `code:${ad.code.toLowerCase()}` : ""]));
  const available = captured.filter(
    (ad) => !(ad.adId && linkedKeys.has(`id:${ad.adId}`)) && !(ad.code && linkedKeys.has(`code:${ad.code.toLowerCase()}`)),
  );

  async function run(key: string, task: () => ReturnType<typeof linkCampaignAd>) {
    setBusy(key);
    try {
      const result = await save.run(task);
      if (result.ok) router.refresh();
      return result;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <CardTitle as="h3" hint="O lead que chega por um anúncio vinculado entra na campanha sozinho, com origem “anúncio”. Quem já veio dele durante a campanha entra ao vincular.">
        Anúncios
      </CardTitle>

      {ads.length ? (
        <ul className="divide-y divide-ink/10 panel:divide-white/10">
          {ads.map((ad) => (
            <li key={ad.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="wrap-anywhere text-sm font-medium text-ink panel:text-white">{ad.displayName}</p>
                <p className="text-sm text-neutral panel:text-white/60">
                  {[
                    ad.code && `código ${ad.code}`,
                    ad.adId && `anúncio ${ad.adId}`,
                    ad.adsetId && `conjunto ${ad.adsetId}`,
                    ad.metaCampaignId && `campanha Meta ${ad.metaCampaignId}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="max-sm:h-11"
                  loading={busy === ad.id}
                  loadingLabel="Desvinculando"
                  disabled={save.saving}
                  onClick={() => void run(ad.id, () => unlinkCampaignAd(campaignId, ad.id))}
                >
                  <Trash2 size={16} aria-hidden />
                  Desvincular
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={MousePointerClick}
          title="Nenhum anúncio vinculado"
          description="Vincule os anúncios da Meta desta campanha para os leads entrarem sozinhos."
          className="px-4 py-6"
        />
      )}

      {editable && (
        <div className="mt-6 space-y-6 border-t border-ink/10 pt-6 panel:border-white/10">
          <section>
            <h3 className="font-display text-base font-semibold text-ink panel:text-white">Anúncios que já trouxeram leads</h3>
            {available.length ? (
              <ul className="mt-3 space-y-2">
                {available.slice(0, 30).map((ad) => (
                  <li
                    key={ad.key}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-ink/10 p-3 panel:border-white/15"
                  >
                    <div className="min-w-0">
                      <p className="wrap-anywhere text-sm font-medium text-ink panel:text-white">
                        {ad.code ? (ad.name ? `${ad.code} - ${ad.name}` : ad.code) : ad.name ?? `Anúncio ${ad.adId}`}
                      </p>
                      <p className="text-sm text-neutral panel:text-white/60">
                        {ad.leads} lead{ad.leads === 1 ? "" : "s"}
                        {ad.adId ? ` · anúncio ${ad.adId}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="max-sm:h-11"
                      loading={busy === ad.key}
                      loadingLabel="Vinculando"
                      disabled={save.saving}
                      onClick={() =>
                        void run(ad.key, () =>
                          linkCampaignAd(campaignId, {
                            adId: ad.adId ?? undefined,
                            code: ad.code ?? undefined,
                            displayName: ad.code ? (ad.name ? `${ad.code} - ${ad.name}` : ad.code) : ad.name ?? undefined,
                          }),
                        )
                      }
                    >
                      <Plus size={16} aria-hidden />
                      Vincular
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-neutral panel:text-white/60">
                {captured.length
                  ? "Todos os anúncios capturados já estão nesta campanha."
                  : "Nenhum anúncio trouxe lead ainda. Vincule pelo id ou pelo código abaixo."}
              </p>
            )}
          </section>

          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run("manual", () => linkCampaignAd(campaignId, manual));
              if (result.ok) setManual({ adId: "", adsetId: "", metaCampaignId: "", code: "", displayName: "" });
            }}
          >
            <h3 className="font-display text-base font-semibold text-ink panel:text-white">Vincular à mão</h3>
            <p className="text-sm text-neutral panel:text-white/60">
              O WhatsApp entrega o id do anúncio e o código escrito nele (como AD37). Informe pelo menos um dos dois; conjunto e
              campanha da Meta ficam como referência.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Id do anúncio" htmlFor={`${base}-ad`} optional>
                <Input
                  id={`${base}-ad`}
                  inputMode="numeric"
                  className="max-sm:h-11"
                  value={manual.adId}
                  onChange={(e) => setManual({ ...manual, adId: e.target.value })}
                />
              </Field>
              <Field label="Código do anúncio" htmlFor={`${base}-code`} optional>
                <Input
                  id={`${base}-code`}
                  className="max-sm:h-11"
                  placeholder="Ex.: AD37"
                  value={manual.code}
                  onChange={(e) => setManual({ ...manual, code: e.target.value })}
                />
              </Field>
              <Field label="Id do conjunto" htmlFor={`${base}-set`} optional>
                <Input
                  id={`${base}-set`}
                  inputMode="numeric"
                  className="max-sm:h-11"
                  value={manual.adsetId}
                  onChange={(e) => setManual({ ...manual, adsetId: e.target.value })}
                />
              </Field>
              <Field label="Id da campanha na Meta" htmlFor={`${base}-camp`} optional>
                <Input
                  id={`${base}-camp`}
                  inputMode="numeric"
                  className="max-sm:h-11"
                  value={manual.metaCampaignId}
                  onChange={(e) => setManual({ ...manual, metaCampaignId: e.target.value })}
                />
              </Field>
              <Field label="Nome para exibir" htmlFor={`${base}-name`} optional>
                <Input
                  id={`${base}-name`}
                  className="max-sm:h-11"
                  value={manual.displayName}
                  onChange={(e) => setManual({ ...manual, displayName: e.target.value })}
                />
              </Field>
            </div>
            <Button type="submit" className="max-sm:h-11" loading={busy === "manual"} loadingLabel="Vinculando anúncio" disabled={save.saving}>
              Vincular anúncio
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
