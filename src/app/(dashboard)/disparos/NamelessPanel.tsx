"use client";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { cn } from "@/lib/utils";
import type { NamelessMode } from "@/modules/broadcasts/contacts";
import type { BroadcastTemplate } from "@/modules/broadcasts/template";
import { MessagePreview } from "./TemplatePicker";

/**
 * Quem não tem nome quando a mensagem usa o nome: outra mensagem aprovada
 * (a "versão sem o nome"), um texto no lugar do nome, ou fica de fora.
 */
export function NamelessPanel({
  main,
  slots,
  count,
  mode,
  onMode,
  alternatives,
  altId,
  onAlt,
  fallback,
  onFallback,
  altValues,
  fallbackValues,
  disabled,
}: {
  main: BroadcastTemplate;
  /** Espaços que usam o nome (1, 2…). */
  slots: number[];
  /** Quantos dos contatos escolhidos não têm nome. */
  count: number;
  mode: NamelessMode;
  onMode: (mode: NamelessMode) => void;
  /** Mensagens aprovadas que servem como versão sem nome (mesma quantidade de espaços). */
  alternatives: BroadcastTemplate[];
  altId: string;
  onAlt: (id: string) => void;
  fallback: string;
  onFallback: (text: string) => void;
  altValues: string[];
  fallbackValues: (string | null)[];
  disabled?: boolean;
}) {
  const alt = alternatives.find((t) => t.id === altId);
  const createHref = `/disparos/modelos/novo?de=${encodeURIComponent(main.id)}&sem=${slots.join(",")}`;
  const options: { value: NamelessMode; title: string; disabled?: boolean }[] = [
    { value: "template", title: "Enviar a versão sem o nome", disabled: !alternatives.length },
    { value: "text", title: "Colocar um texto no lugar do nome" },
    { value: "skip", title: "Não enviar para quem não tem nome" },
  ];
  return (
    <section
      aria-labelledby="nameless-title"
      className="space-y-4 rounded-control border border-white/10 p-5"
    >
      <div>
        <h3 id="nameless-title" className="text-sm font-medium text-white">
          Quem não tem nome
        </h3>
        <p className="mt-1 text-xs text-white/60">
          {count === 0
            ? "Todos os contatos escolhidos têm nome. Isto vale se entrar alguém sem nome."
            : count === 1
              ? "1 contato escolhido não tem nome cadastrado."
              : `${count} contatos escolhidos não têm nome cadastrado.`}
        </p>
      </div>

      <div role="radiogroup" aria-labelledby="nameless-title" className="space-y-2">
        {options.map((o) => {
          const on = o.value === mode;
          return (
            <div
              key={o.value}
              className={cn(
                "rounded-control border p-3 transition-colors",
                on ? "border-iris bg-iris/10" : "border-white/10",
                o.disabled && "opacity-70",
              )}
            >
              <label className={cn("flex items-center gap-3 text-sm", o.disabled ? "cursor-not-allowed" : "cursor-pointer")}>
                <input
                  type="radio"
                  name="nameless-mode"
                  className="accent-iris"
                  checked={on}
                  disabled={disabled || o.disabled}
                  onChange={() => onMode(o.value)}
                />
                <span className="text-white">{o.title}</span>
              </label>

              {o.value === "template" && !alternatives.length && (
                <p className="mt-2 pl-7 text-xs text-white/60">
                  Você ainda não tem a versão sem o nome desta mensagem.{" "}
                  <Link href={createHref} className="text-white underline underline-offset-2">
                    Criar versão sem o nome
                  </Link>{" "}
                  — a Meta precisa aprovar antes de usar.
                </p>
              )}
              {o.value === "template" && on && alternatives.length > 0 && (
                <div className="mt-3 space-y-3 pl-7">
                  <SelectMenu
                    label="Mensagem para quem não tem nome"
                    value={altId}
                    className="w-full"
                    disabled={disabled}
                    onChange={onAlt}
                    options={[
                      { value: "", label: "Escolha a mensagem" },
                      ...alternatives.map((t) => ({ value: t.id, label: t.name })),
                    ]}
                  />
                  {alt && (
                    <div className="rounded-control bg-black/20 p-3">
                      <MessagePreview template={alt} values={altValues} />
                    </div>
                  )}
                </div>
              )}
              {o.value === "text" && on && (
                <div className="mt-3 space-y-3 pl-7">
                  <Input
                    aria-label="O que vai no lugar do nome"
                    value={fallback}
                    maxLength={1024}
                    disabled={disabled}
                    placeholder="Ex.: tudo bem"
                    onChange={(e) => onFallback(e.target.value)}
                  />
                  <div className="rounded-control bg-black/20 p-3">
                    <MessagePreview template={main} values={fallbackValues} />
                  </div>
                </div>
              )}
              {o.value === "skip" && on && count > 0 && (
                <p className="mt-2 pl-7 text-xs text-white/60">
                  {count === 1 ? "Esse contato fica" : `Esses ${count} contatos ficam`} fora deste disparo.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
