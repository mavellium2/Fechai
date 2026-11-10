"use client";
import { useActionState, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Check, Clock, Plus, Send, Type, Upload, User, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/ui/toast/use-save-feedback";
import { cn } from "@/lib/utils";
import {
  bodyVariables,
  looksPromotional,
  renumberVariables,
  suggestTemplateName,
  TEMPLATE_LIMITS,
  templateName,
  validateTemplateDraft,
  variablesOutOfOrder,
  type TemplateCategory,
} from "@/modules/broadcasts/template-draft";
import {
  mediaAccept,
  mediaFileProblem,
  MEDIA_RULES,
  type MediaFormat,
} from "@/modules/broadcasts/media";
import {
  createMessageTemplate,
  uploadTemplateExample,
  type CreateTemplateState,
} from "./actions";
import { WhatsAppBubble } from "./WhatsAppBubble";

type Kind = "name" | "date" | "time" | "other";
type Slot = { kind: Kind; example: string };

const KINDS: { kind: Kind; label: string; example: string; icon: typeof User }[] = [
  { kind: "name", label: "Nome do contato", example: "Maria", icon: User },
  { kind: "date", label: "Data", example: "16/10", icon: Calendar },
  { kind: "time", label: "Horário", example: "15:00", icon: Clock },
  { kind: "other", label: "Outro texto", example: "", icon: Type },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<Kind, (typeof KINDS)[number]>;

const CATEGORIES: { value: TemplateCategory; title: string; text: string }[] = [
  {
    value: "UTILITY",
    title: "Aviso ou lembrete",
    text: "Sobre algo que o contato já combinou: confirmação, lembrete, retorno. Custa menos.",
  },
  {
    value: "MARKETING",
    title: "Promoção ou campanha",
    text: "Ofertas, convites e novidades. Custa mais e o contato pode silenciar esse tipo.",
  },
];

const OPT_OUT = "Responda SAIR para não receber mais";

type HeaderKind = "TEXT" | MediaFormat;

const HEADER_KINDS: { value: HeaderKind; label: string }[] = [
  { value: "TEXT", label: "Título" },
  { value: "IMAGE", label: "Imagem" },
  { value: "VIDEO", label: "Vídeo" },
  { value: "DOCUMENT", label: "Documento" },
];

export type TemplateEditorInitial = {
  name: string;
  category: TemplateCategory;
  header: string;
  /** Topo com mídia: o exemplo precisa ser enviado de novo (a Meta não devolve). */
  headerMedia?: MediaFormat | null;
  body: string;
  footer: string;
};

export function TemplateEditor({ initial }: { initial: TemplateEditorInitial | null }) {
  const router = useRouter();
  const [category, setCategory] = useState<TemplateCategory>(initial?.category ?? "UTILITY");
  const [body, setBody] = useState(initial?.body ?? "");
  const [header, setHeader] = useState(initial?.header ?? "");
  const [footer, setFooter] = useState(initial?.footer ?? "");
  const [showHeader, setShowHeader] = useState(Boolean(initial?.header || initial?.headerMedia));
  const [headerKind, setHeaderKind] = useState<HeaderKind>(initial?.headerMedia ?? "TEXT");
  const [example, setExample] = useState<{ kind: MediaFormat; handle: string; name: string } | null>(null);
  const [uploadingExample, setUploadingExample] = useState(false);
  const [exampleError, setExampleError] = useState("");
  const [showFooter, setShowFooter] = useState(Boolean(initial?.footer));
  const [name, setName] = useState(initial?.name ?? "");
  const [nameTouched, setNameTouched] = useState(Boolean(initial?.name));
  const [slots, setSlots] = useState<Slot[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ids = { body: useId(), header: useId(), footer: useId(), name: useId() };

  const [state, formAction, pending] = useActionState<CreateTemplateState, FormData>(
    async (previous, form) => {
      const result = await createMessageTemplate(previous, form);
      if (result?.ok) router.push("/disparos/modelos");
      return result;
    },
    null,
  );
  useActionToast(state, pending, { entity: "modelo", action: "create" });

  const count = bodyVariables(body).length;
  const currentSlots: Slot[] = Array.from(
    { length: count },
    (_, i) => slots[i] ?? { kind: "other", example: "" },
  );
  const examples = currentSlots.map((s) => s.example);
  const labels = currentSlots.map((s) => KIND[s.kind].label);
  const finalName = nameTouched ? name : suggestTemplateName(body);
  const savedName = templateName(finalName);

  const headerMedia = showHeader && headerKind !== "TEXT" ? headerKind : null;
  const headerHandle = headerMedia && example?.kind === headerMedia ? example.handle : "";
  const live = validateTemplateDraft({
    name: finalName,
    category,
    header: showHeader && !headerMedia ? header : "",
    headerMedia,
    headerHandle,
    body,
    footer: showFooter ? footer : "",
    examples,
  });
  const liveErrors = live.ok ? {} : live.errors;
  const serverErrors = state?.ok === false ? (state.errors ?? {}) : {};
  const outOfOrder = variablesOutOfOrder(body);
  const promotional =
    category === "UTILITY" && looksPromotional(`${headerMedia ? "" : header} ${body}`);

  // O que falta, em frases curtas, no rodapé do botão.
  const missing: string[] = [];
  if (!body.trim()) missing.push("escreva a mensagem");
  else if (liveErrors.body) missing.push(liveErrors.body.replace(/\.$/, "").toLowerCase());
  if (liveErrors.examples && !liveErrors.body) missing.push("preencha o exemplo de cada variável");
  if (liveErrors.header) missing.push(liveErrors.header.replace(/\.$/, "").toLowerCase());
  if (liveErrors.headerHandle) missing.push("envie o arquivo de exemplo do topo");
  if (liveErrors.footer) missing.push(liveErrors.footer.replace(/\.$/, "").toLowerCase());
  if (body.trim() && !savedName) missing.push("dê um nome ao modelo");

  function insert(kind: Kind) {
    const field = bodyRef.current;
    const n = count + 1;
    const token = `{{${n}}}`;
    const start = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const spacer = before && !/\s$/.test(before) ? " " : "";
    setBody(before + spacer + token + body.slice(end));
    setSlots((current) => {
      const next = Array.from({ length: n }, (_, i) => current[i] ?? { kind: "other" as Kind, example: "" });
      next[n - 1] = { kind, example: KIND[kind].example };
      return next;
    });
    const caret = start + spacer.length + token.length;
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  }

  function fixNumbering() {
    const { body: next, order } = renumberVariables(body);
    setSlots(order.map((old) => currentSlots[old - 1] ?? { kind: "other", example: "" }));
    setBody(next);
  }

  function setSlotExample(i: number, example: string) {
    setSlots(currentSlots.map((s, j) => (i === j ? { ...s, example } : s)));
  }

  /** O exemplo vai direto para a Meta; ela devolve o identificador que o modelo leva. */
  async function sendExample(kind: MediaFormat, file: File) {
    const problem = mediaFileProblem(kind, file);
    if (problem) {
      setExampleError(problem);
      return;
    }
    setExampleError("");
    setUploadingExample(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("format", kind);
      const result = await uploadTemplateExample(form);
      if (result.ok) setExample({ kind, handle: result.handle, name: file.name });
      else setExampleError(result.error);
    } catch {
      setExampleError("Não foi possível enviar o exemplo. Tente de novo.");
    } finally {
      setUploadingExample(false);
    }
  }

  const bodyProblem = body.trim() && liveErrors.body ? liveErrors.body : serverErrors.body;

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="name" value={finalName} />
      <input type="hidden" name="body" value={body} />
      <input type="hidden" name="header" value={showHeader && !headerMedia ? header : ""} />
      <input type="hidden" name="headerMedia" value={headerMedia ?? ""} />
      <input type="hidden" name="headerHandle" value={headerHandle} />
      <input type="hidden" name="footer" value={showFooter ? footer : ""} />
      {examples.map((e, i) => (
        <input key={i} type="hidden" name="examples" value={e} />
      ))}

      <Card className="space-y-6">
        <section aria-labelledby="cat-title" className="space-y-3">
          <h2 id="cat-title" className="font-display text-lg font-semibold text-white">
            Para que serve esta mensagem?
          </h2>
          <div role="radiogroup" aria-labelledby="cat-title" className="grid gap-3 sm:grid-cols-2">
            {CATEGORIES.map((c) => {
              const on = c.value === category;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={pending}
                  onClick={() => setCategory(c.value)}
                  className={cn(
                    "rounded-control border p-4 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                    on ? "border-iris bg-iris/10" : "border-white/10 bg-white/5 hover:border-white/25",
                  )}
                >
                  <span className="block font-medium text-white">{c.title}</span>
                  <span className="mt-1 block text-sm text-white/60">{c.text}</span>
                </button>
              );
            })}
          </div>
          {promotional && (
            <Alert tone="warn">
              O texto parece promoção (desconto, oferta, cupom…). Como aviso, a Meta costuma
              recusar ou cobrar como campanha.{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => setCategory("MARKETING")}
              >
                Trocar para promoção
              </button>
            </Alert>
          )}
        </section>

        <section aria-labelledby="msg-title" className="space-y-4">
          <h2 id="msg-title" className="font-display text-lg font-semibold text-white">
            Mensagem
          </h2>

          {showHeader ? (
            <OptionalField
              id={ids.header}
              label="Topo da mensagem"
              onRemove={() => {
                setShowHeader(false);
                setHeader("");
                setHeaderKind("TEXT");
                setExampleError("");
              }}
              error={
                headerMedia
                  ? exampleError || serverErrors.headerHandle
                  : (liveErrors.header ?? serverErrors.header)
              }
            >
              <SegmentedControl
                label="Tipo do topo"
                value={headerKind}
                options={HEADER_KINDS}
                disabled={pending || uploadingExample}
                onSelect={(next) => {
                  setHeaderKind(next);
                  setExampleError("");
                }}
                className="mb-3"
              />
              {headerMedia ? (
                <div className="space-y-2">
                  <p className="text-xs text-white/55">
                    Cada disparo escolhe o próprio arquivo. A Meta só precisa de um exemplo para
                    analisar ({MEDIA_RULES[headerMedia].hint}). Modelo com arquivo serve só para
                    Disparos, não para lembretes.
                  </p>
                  <input
                    id={`${ids.header}-file`}
                    type="file"
                    accept={mediaAccept(headerMedia)}
                    className="sr-only"
                    disabled={pending || uploadingExample}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void sendExample(headerMedia, file);
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      id={ids.header}
                      type="button"
                      size="sm"
                      variant={headerHandle ? "ghost" : "outline"}
                      loading={uploadingExample}
                      loadingLabel="Enviando exemplo para a Meta"
                      disabled={pending}
                      onClick={() => document.getElementById(`${ids.header}-file`)?.click()}
                    >
                      <Upload size={14} aria-hidden />
                      {headerHandle ? "Trocar exemplo" : "Enviar arquivo de exemplo"}
                    </Button>
                    {headerHandle && example && (
                      <span className="flex min-w-0 items-center gap-1 text-xs text-white/70">
                        <Check size={12} className="shrink-0 text-success" aria-hidden />
                        <span className="truncate">{example.name}</span>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <Input
                  id={ids.header}
                  value={header}
                  maxLength={TEMPLATE_LIMITS.header}
                  onChange={(e) => setHeader(e.target.value)}
                  placeholder="Ex.: Lembrete de consulta"
                  disabled={pending}
                />
              )}
            </OptionalField>
          ) : null}

          <div>
            <label htmlFor={ids.body} className="text-sm text-white/80">
              Texto
            </label>
            <Textarea
              id={ids.body}
              ref={bodyRef}
              value={body}
              rows={5}
              maxLength={TEMPLATE_LIMITS.body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ex.: Oi, sua avaliação está confirmada para amanhã. Responda esta mensagem se precisar remarcar."
              aria-invalid={bodyProblem ? true : undefined}
              aria-describedby={`${ids.body}-help`}
              className="mt-2"
              disabled={pending}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2" id={`${ids.body}-help`}>
                <span className="text-xs text-white/55">Inserir no texto:</span>
                {KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => insert(k.kind)}
                    disabled={pending || count >= TEMPLATE_LIMITS.variables}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-white/15 px-3 text-xs text-white/80 transition-colors hover:border-iris hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris disabled:opacity-50"
                  >
                    <k.icon size={12} aria-hidden />
                    {k.label}
                  </button>
                ))}
              </div>
              <span className="font-mono text-xs text-white/45">
                {body.length}/{TEMPLATE_LIMITS.body}
              </span>
            </div>
            {outOfOrder ? (
              <Alert tone="warn" className="mt-3">
                As variáveis precisam seguir a ordem {"{{1}}, {{2}}…"}.{" "}
                <button type="button" className="underline underline-offset-2" onClick={fixNumbering}>
                  Corrigir numeração
                </button>
              </Alert>
            ) : (
              bodyProblem && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {bodyProblem}
                </p>
              )
            )}
          </div>

          {count > 0 && (
            <fieldset className="space-y-3 rounded-control border border-white/10 p-4">
              <legend className="px-1 text-sm font-medium text-white/85">Exemplos para a Meta</legend>
              <p className="text-xs text-white/55">
                A Meta só usa os exemplos para analisar. No envio, cada espaço recebe o dado real.
              </p>
              {currentSlots.map((slot, i) => {
                const kind = KIND[slot.kind];
                return (
                  <div key={i} className="grid items-center gap-2 sm:grid-cols-[10rem_1fr]">
                    <label
                      htmlFor={`${ids.body}-ex-${i}`}
                      className="flex items-center gap-2 text-sm text-white/75"
                    >
                      <span className="font-mono text-xs text-white/45">{`{{${i + 1}}}`}</span>
                      {kind.label}
                    </label>
                    <Input
                      id={`${ids.body}-ex-${i}`}
                      value={slot.example}
                      maxLength={TEMPLATE_LIMITS.example}
                      placeholder={kind.example || "Ex.: 20% de desconto"}
                      aria-invalid={!slot.example.trim() && serverErrors.examples ? true : undefined}
                      onChange={(e) => setSlotExample(i, e.target.value)}
                      disabled={pending}
                    />
                  </div>
                );
              })}
            </fieldset>
          )}

          {showFooter ? (
            <OptionalField
              id={ids.footer}
              label="Rodapé"
              onRemove={() => {
                setShowFooter(false);
                setFooter("");
              }}
              error={liveErrors.footer ?? serverErrors.footer}
            >
              <Input
                id={ids.footer}
                value={footer}
                maxLength={TEMPLATE_LIMITS.footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder={OPT_OUT}
                disabled={pending}
              />
            </OptionalField>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!showHeader && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowHeader(true)}>
                <Plus size={14} aria-hidden />
                Título, imagem, vídeo ou documento
              </Button>
            )}
            {!showFooter && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowFooter(true)}>
                <Plus size={14} aria-hidden />
                Rodapé
              </Button>
            )}
            {category === "MARKETING" && !footer && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowFooter(true);
                  setFooter(OPT_OUT);
                }}
              >
                Adicionar “{OPT_OUT}”
              </Button>
            )}
          </div>
          {category === "MARKETING" && !footer && (
            <p className="text-xs text-white/55">
              Em promoções, dizer como parar de receber reduz denúncias do seu número.
            </p>
          )}
        </section>

        <section aria-labelledby="name-title" className="space-y-2">
          <h2 id="name-title" className="font-display text-lg font-semibold text-white">
            Nome do modelo
          </h2>
          <label htmlFor={ids.name} className="block text-sm text-white/60">
            Só você vê. Sugerimos pelo texto; troque se quiser.
          </label>
          <Input
            id={ids.name}
            value={finalName}
            maxLength={TEMPLATE_LIMITS.name}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            placeholder="lembrete_consulta"
            autoComplete="off"
            className="max-w-md font-mono"
            disabled={pending}
            aria-invalid={serverErrors.name ? true : undefined}
          />
          {savedName && savedName !== finalName.trim() && (
            <p className="font-mono text-xs text-white/55">Será salvo como {savedName}</p>
          )}
          {serverErrors.name && <p className="text-sm text-danger">{serverErrors.name}</p>}
        </section>

        <footer className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-3 rounded-b-surface border-t border-white/10 bg-ink/95 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/65" aria-live="polite">
            {missing.length
              ? `Para enviar: ${missing.join(", ")}.`
              : "Pronto. A Meta costuma responder em minutos ou algumas horas."}
          </p>
          <Button type="submit" variant="cta" loading={pending} disabled={missing.length > 0} loadingLabel="Enviando para a Meta">
            <Send size={16} aria-hidden />
            Enviar para a Meta aprovar
          </Button>
        </footer>
      </Card>

      <aside className="h-fit space-y-3 lg:sticky lg:top-24" aria-label="Prévia da mensagem">
        <p className="text-xs text-white/55">Como o contato vai receber</p>
        <WhatsAppBubble
          media={headerMedia}
          header={showHeader && !headerMedia ? header : ""}
          body={body}
          footer={showFooter ? footer : ""}
          values={examples}
          labels={labels}
        />
        {count > 0 && (
          <p className="text-xs text-white/50">
            Os destaques são as partes que mudam para cada contato.
          </p>
        )}
      </aside>
    </form>
  );
}

function OptionalField({
  id,
  label,
  onRemove,
  error,
  children,
}: {
  id: string;
  label: string;
  onRemove: () => void;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm text-white/80">
          {label} <span className="text-white/45">(opcional)</span>
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-control text-xs text-white/55 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          aria-label={`Remover ${label.toLowerCase()}`}
        >
          <X size={12} aria-hidden />
          Remover
        </button>
      </div>
      <div className="mt-2">{children}</div>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
