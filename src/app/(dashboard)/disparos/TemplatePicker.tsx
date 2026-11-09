"use client";
import Link from "next/link";
import { Check, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { BroadcastTemplate } from "@/modules/broadcasts/template";
import { cn } from "@/lib/utils";

/** Mensagem com cada `{{n}}` destacado — preenchido com `values` quando houver. */
export function MessagePreview({
  template,
  values,
}: {
  template: BroadcastTemplate;
  values?: (string | null)[];
}) {
  const parts = template.body.split(/({{\d+}})/g);
  return (
    <div className="space-y-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">
      {template.header && <p className="font-semibold text-white">{template.header}</p>}
      <p>
        {parts.map((part, i) => {
          const slot = /^{{(\d+)}}$/.exec(part);
          if (!slot) return <span key={i}>{part}</span>;
          const value = values?.[Number(slot[1]) - 1];
          return (
            <mark
              key={i}
              className={cn(
                "rounded px-1 py-0.5",
                value ? "bg-iris/25 text-white" : "bg-white/10 font-mono text-xs text-white/70",
              )}
              title={`Variável ${part}`}
            >
              {value || part}
            </mark>
          );
        })}
      </p>
      {template.footer && <p className="text-xs text-white/50">{template.footer}</p>}
    </div>
  );
}

export function TemplatePicker({
  templates,
  value,
  onChange,
  loading,
  error,
  onReload,
  disabled,
}: {
  templates: BroadcastTemplate[] | null;
  value: string;
  onChange: (template: BroadcastTemplate) => void;
  loading: boolean;
  error: string;
  onReload: () => void;
  disabled?: boolean;
}) {
  if (error)
    return (
      <Alert tone="danger">
        {error}{" "}
        <button type="button" className="underline underline-offset-2" onClick={onReload}>
          Tentar de novo
        </button>
      </Alert>
    );
  if (templates === null)
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 w-full" />
        ))}
      </div>
    );
  if (templates.length === 0)
    return (
      <Alert tone="warn">
        Você ainda não tem mensagem aprovada que sirva para disparo.{" "}
        <Link href="/disparos/modelos/novo" className="underline underline-offset-2">
          Escreva um modelo
        </Link>{" "}
        e aguarde a aprovação da Meta — costuma levar de minutos a algumas horas.
      </Alert>
    );
  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Mensagens aprovadas"
        className="grid gap-4 md:grid-cols-2"
      >
        {templates.map((t) => {
          const on = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(t)}
              className={cn(
                "flex flex-col rounded-control border p-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                "disabled:cursor-not-allowed disabled:opacity-60",
                on
                  ? "border-iris bg-iris/10"
                  : "border-white/10 bg-white/5 enabled:hover:border-white/30",
              )}
            >
              <span className="mb-3 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-white/55">{t.name}</span>
                {on ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-white">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-iris">
                      <Check size={12} aria-hidden />
                    </span>
                    Escolhida
                  </span>
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full border border-white/25" aria-hidden />
                )}
              </span>
              <MessagePreview template={t} />
            </button>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
        Não achou a mensagem?
        <Link href="/disparos/modelos/novo" className="underline underline-offset-2 hover:text-white">
          Escrever um modelo novo
        </Link>
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-white disabled:opacity-60"
        >
          <RefreshCw size={12} aria-hidden className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
          Atualizar lista
        </button>
      </p>
    </div>
  );
}
