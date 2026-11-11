import { Fragment } from "react";
import { CheckCheck, FileText, Film, ImageIcon } from "lucide-react";
import { MEDIA_RULES, type MediaFormat } from "@/modules/broadcasts/media";
import type { TemplateButton } from "@/modules/broadcasts/template-buttons";
import { ButtonRow } from "../ButtonRow";
import { cn } from "@/lib/utils";

/**
 * Texto com cada `{{n}}` destacado. Com `values`, mostra o exemplo no lugar;
 * sem exemplo, mostra o rótulo (`labels`) ou o próprio `{{n}}`.
 */
export function HighlightedText({
  text,
  values,
  labels,
}: {
  text: string;
  values?: string[];
  labels?: string[];
}) {
  return (
    <>
      {text.split(/({{\d+}})/g).map((part, i) => {
        const slot = /^{{(\d+)}}$/.exec(part);
        if (!slot) return <Fragment key={i}>{part}</Fragment>;
        const n = Number(slot[1]) - 1;
        const value = values?.[n]?.trim();
        return (
          <mark
            key={i}
            title={`Variável ${part}`}
            className={cn(
              "rounded px-1 py-0.5",
              value ? "bg-iris/25 text-white" : "bg-white/10 font-mono text-xs text-white/70",
            )}
          >
            {value || labels?.[n] || part}
          </mark>
        );
      })}
    </>
  );
}

/** Como o contato vê no WhatsApp: balão, título em negrito, rodapé discreto. */
const ICONS: Record<MediaFormat, typeof ImageIcon> = { IMAGE: ImageIcon, VIDEO: Film, DOCUMENT: FileText };

export function WhatsAppBubble({
  media,
  header,
  body,
  footer,
  buttons,
  values,
  labels,
}: {
  /** Botões do modelo, abaixo do balão como no WhatsApp. */
  buttons?: TemplateButton[];
  /** Topo com arquivo: mostra o espaço onde ele aparece. */
  media?: MediaFormat | null;
  header: string;
  body: string;
  footer: string;
  values?: string[];
  labels?: string[];
}) {
  return (
    <div className="rounded-surface border border-white/10 bg-black/20 p-4">
      {body.trim() ? (
        <div className="ml-auto max-w-[90%]">
          <div className="relative rounded-2xl rounded-tr-sm bg-white/10 px-3 pb-2 pt-2.5 text-sm leading-relaxed text-white/90 shadow-sm">
            {media && <MediaPlaceholder format={media} />}
            {header.trim() && <p className="mb-1 font-semibold text-white">{header}</p>}
            <p className="whitespace-pre-wrap break-words">
              <HighlightedText text={body} values={values} labels={labels} />
            </p>
            {footer.trim() && <p className="mt-2 text-xs text-white/50">{footer}</p>}
            <p className="mt-1 flex items-center justify-end gap-1 text-xs text-white/40">
              10:30 <CheckCheck size={14} className="text-iris" aria-hidden />
            </p>
          </div>
          <ButtonRow buttons={buttons} />
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-white/50">
          A mensagem aparece aqui enquanto você escreve.
        </p>
      )}
    </div>
  );
}

function MediaPlaceholder({ format }: { format: MediaFormat }) {
  const Icon = ICONS[format];
  return (
    <span className="mb-2 flex h-24 items-center justify-center gap-2 rounded-xl bg-black/30 text-xs text-white/55">
      <Icon size={18} aria-hidden />
      {MEDIA_RULES[format].label} do disparo
    </span>
  );
}
