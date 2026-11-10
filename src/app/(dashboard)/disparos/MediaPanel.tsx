"use client";
import { useEffect, useId, useState } from "react";
import { FileText, Film, ImageIcon, Link2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  formatBytes,
  mediaAccept,
  mediaFileProblem,
  MEDIA_RULES,
  type MediaFormat,
  type UploadedMedia,
} from "@/modules/broadcasts/media";
import { uploadBroadcastMedia } from "./actions";

export type MediaMode = "file" | "column";

export const MEDIA_ICONS: Record<MediaFormat, typeof ImageIcon> = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  DOCUMENT: FileText,
};

/**
 * Arquivo do topo da mensagem: o mesmo para todos (sobe na hora) ou, com
 * planilha, o link de cada contato numa coluna. O arquivo só vira parte do
 * disparo ao clicar em "Revisar".
 */
export function MediaPanel({
  format,
  mode,
  onMode,
  allowColumn,
  media,
  onMedia,
  onUploading,
  disabled,
}: {
  format: MediaFormat;
  mode: MediaMode;
  onMode: (mode: MediaMode) => void;
  /** Só a planilha tem colunas. */
  allowColumn: boolean;
  media: UploadedMedia | null;
  onMedia: (media: UploadedMedia | null) => void;
  onUploading?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const rules = MEDIA_RULES[format];
  const Icon = MEDIA_ICONS[format];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function upload(file: File) {
    const problem = mediaFileProblem(format, file);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setUploading(true);
    onUploading?.(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("format", format);
      const result = await uploadBroadcastMedia(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onMedia(result.media);
      setPreview(format === "DOCUMENT" ? null : URL.createObjectURL(file));
    } catch {
      setError("Não foi possível enviar o arquivo. Tente de novo.");
    } finally {
      setUploading(false);
      onUploading?.(false);
    }
  }

  const column = allowColumn && mode === "column";
  const shown = preview ?? (media && !media.url.includes("simulado.invalid") ? media.url : null);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-control border border-white/10 bg-white/5 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-medium text-white">
          <Icon size={16} className="text-iris" aria-hidden />
          {rules.label} no topo
        </h2>
        {allowColumn && (
          <SegmentedControl
            label="De onde vem o arquivo"
            value={mode}
            disabled={disabled || uploading}
            options={[
              { value: "file", label: "Mesmo para todos" },
              { value: "column", label: "Link na planilha" },
            ]}
            onSelect={(next) => {
              setError("");
              onMode(next);
            }}
          />
        )}
      </div>

      {column ? (
        <p className="flex items-start gap-2 text-sm text-white/65">
          <Link2 size={14} className="mt-1 shrink-0 text-white/45" aria-hidden />
          Cada contato recebe o arquivo do link da sua linha. Escolha a coluna ao lado. O link
          precisa ser público e começar com https:// ({rules.hint}).
        </p>
      ) : (
        <>
          {media ? (
            <div className="space-y-2">
              {shown && format === "IMAGE" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shown}
                  alt={`Prévia: ${media.filename}`}
                  className="max-h-48 w-full rounded-control bg-black/30 object-contain"
                />
              )}
              {shown && format === "VIDEO" && (
                <video
                  src={shown}
                  controls
                  preload="metadata"
                  className="max-h-48 w-full rounded-control bg-black/30"
                />
              )}
              <p className="flex items-center gap-2 text-sm text-white/80">
                <Icon size={14} className="shrink-0 text-white/50" aria-hidden />
                <span className="min-w-0 truncate">{media.filename}</span>
                <span className="shrink-0 text-xs text-white/45">{formatBytes(media.size)}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-white/60">
              Todos os contatos recebem o mesmo arquivo. {rules.hint}.
            </p>
          )}
          <div>
            <input
              id={`${id}-file`}
              type="file"
              accept={mediaAccept(format)}
              className="sr-only"
              disabled={disabled || uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <Button
              size="sm"
              variant={media ? "ghost" : "outline"}
              loading={uploading}
              loadingLabel="Enviando arquivo"
              disabled={disabled}
              onClick={() => document.getElementById(`${id}-file`)?.click()}
            >
              <Upload size={14} aria-hidden />
              {media ? "Trocar arquivo" : `Escolher ${rules.label.toLowerCase()}`}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
