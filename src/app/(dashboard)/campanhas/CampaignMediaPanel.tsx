"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Image as ImageIcon, Images, Mic, Trash2, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";
import { useSaveFeedback } from "@/components/ui/toast";
import { ASSET_ACCEPT, ASSET_KIND_LABEL, ASSET_USAGE_LABEL, ASSET_USAGES, type AssetKind } from "@/modules/campaigns/asset-types";
import { removeCampaignAsset, updateCampaignAsset, uploadCampaignAsset } from "./setup-actions";

type Asset = { id: string; name: string; kind: string; url: string; size: number; usage: string; instruction: string | null };

const USAGE_OPTIONS = ASSET_USAGES.map((value) => ({ value, label: ASSET_USAGE_LABEL[value] }));
const KIND_ICON: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Video, pdf: FileText, audio: Mic };

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Biblioteca de mídias da campanha. "Agente" quer dizer que a IA pode mandar o
 * arquivo na conversa com leads da campanha (seguindo a instrução de uso);
 * "Disparo" deixa o arquivo à mão para o topo de um disparo.
 */
export function CampaignMediaPanel({ campaignId, editable, assets }: { campaignId: string; editable: boolean; assets: Asset[] }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "mídia", action: "save", gender: "f" });
  const [busy, setBusy] = useState<string | null>(null);
  const [usage, setUsage] = useState("agent");
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const base = useId();

  async function run(key: string, task: () => ReturnType<typeof removeCampaignAsset>) {
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
      <CardTitle as="h3" hint="Arquivos com uso “Agente” podem ser enviados pela IA na conversa com leads da campanha, seguindo a instrução de cada um.">
        Mídias
      </CardTitle>

      {assets.length ? (
        <ul className="space-y-3">
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              editable={editable}
              busy={busy === asset.id}
              disabled={save.saving}
              onSave={(input) => run(asset.id, () => updateCampaignAsset(campaignId, asset.id, input))}
              onRemove={() => run(asset.id, () => removeCampaignAsset(campaignId, asset.id))}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Images}
          title="Nenhuma mídia"
          description="Imagens, vídeos, PDFs e áudios da campanha, para o agente e para os disparos."
          className="px-4 py-6"
        />
      )}

      {editable && (
        <form
          ref={formRef}
          className="mt-6 space-y-4 border-t border-ink/10 pt-6 panel:border-white/10"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set("campaignId", campaignId);
            data.set("usage", usage);
            const result = await run("upload", () => uploadCampaignAsset(data));
            if (result.ok) formRef.current?.reset();
          }}
        >
          <h3 className="font-display text-base font-semibold text-ink panel:text-white">Adicionar mídia</h3>
          <Field
            label="Arquivo"
            htmlFor={`${base}-file`}
            hint="Imagem JPG/PNG até 5 MB, vídeo MP4 até 16 MB, PDF até 100 MB ou áudio até 16 MB."
          >
            <input
              ref={fileRef}
              id={`${base}-file`}
              name="file"
              type="file"
              required
              accept={ASSET_ACCEPT}
              className={
                "block w-full rounded-control border border-ink/10 p-2 text-sm text-ink panel:border-white/15 panel:text-white/90 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
              }
            />
          </Field>
          <div>
            <p id={`${base}-usage`} className="mb-2 text-sm font-medium text-ink panel:text-white/90">
              Quem usa
            </p>
            <SelectMenu label="Quem usa" labelledBy={`${base}-usage`} value={usage} onChange={setUsage} options={USAGE_OPTIONS} />
          </div>
          <Field label="Instrução de uso" htmlFor={`${base}-instruction`} optional hint="Quando o agente deve enviar este arquivo.">
            <Textarea
              id={`${base}-instruction`}
              name="instruction"
              rows={2}
              maxLength={500}
              placeholder="Ex.: Enviar quando o lead perguntar como é o procedimento."
            />
          </Field>
          <Button type="submit" className="max-sm:h-11" loading={busy === "upload"} loadingLabel="Enviando arquivo" disabled={save.saving}>
            <Upload size={16} aria-hidden />
            Adicionar mídia
          </Button>
        </form>
      )}
    </section>
  );
}

function AssetRow({
  asset,
  editable,
  busy,
  disabled,
  onSave,
  onRemove,
}: {
  asset: Asset;
  editable: boolean;
  busy: boolean;
  disabled: boolean;
  onSave: (input: { usage: string; instruction: string }) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const [usage, setUsage] = useState(asset.usage);
  const [instruction, setInstruction] = useState(asset.instruction ?? "");
  const changed = usage !== asset.usage || instruction.trim() !== (asset.instruction ?? "");
  const Icon = KIND_ICON[asset.kind] ?? FileText;
  const id = useId();

  return (
    <li className="rounded-control border border-ink/10 p-4 panel:border-white/15">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {asset.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- arquivo da CDN da própria conta
            <img src={asset.url} alt="" className="size-12 shrink-0 rounded-control object-cover" />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-ink/5 panel:bg-white/10">
              <Icon size={20} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className="wrap-anywhere text-sm font-medium text-ink panel:text-white">{asset.name}</p>
            <p className="text-sm text-neutral panel:text-white/60">
              {ASSET_KIND_LABEL[asset.kind as AssetKind] ?? asset.kind} · {sizeLabel(asset.size)} ·{" "}
              {ASSET_USAGE_LABEL[asset.usage as keyof typeof ASSET_USAGE_LABEL] ?? asset.usage}
            </p>
            <a
              href={asset.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 rounded-control text-sm text-iris underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              Abrir arquivo
              <ExternalLink size={16} aria-hidden />
            </a>
          </div>
        </div>
        {editable && (
          <Button type="button" variant="ghost" size="sm" className="max-sm:h-11" loading={busy} loadingLabel="Removendo" disabled={disabled} onClick={() => void onRemove()}>
            <Trash2 size={16} aria-hidden />
            Remover
          </Button>
        )}
      </div>
      {editable ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p id={`${id}-usage`} className="mb-2 text-sm font-medium text-ink panel:text-white/90">
              Quem usa
            </p>
            <SelectMenu label="Quem usa" labelledBy={`${id}-usage`} value={usage} onChange={setUsage} options={USAGE_OPTIONS} />
          </div>
          <Field label="Instrução de uso" htmlFor={`${id}-instruction`} optional>
            <Textarea id={`${id}-instruction`} rows={2} maxLength={500} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          </Field>
          {changed && (
            <div className="sm:col-span-2">
              <Button type="button" size="sm" className="max-sm:h-11" disabled={disabled} onClick={() => void onSave({ usage, instruction })}>
                Salvar mídia
              </Button>
            </div>
          )}
        </div>
      ) : (
        asset.instruction && <p className="mt-3 text-sm text-ink panel:text-white/90">{asset.instruction}</p>
      )}
    </li>
  );
}
