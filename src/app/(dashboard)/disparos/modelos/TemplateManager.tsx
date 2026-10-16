"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import { FileText, Plus, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/ui/toast/use-save-feedback";
import {
  bodyVariables,
  TEMPLATE_LIMITS,
  templateCategoryLabel,
  templateName,
  templateRejectionLabel,
  templateStatusLabel,
  type ManagedTemplate,
  type TemplateCategory,
} from "@/modules/broadcasts/template-draft";
import { createMessageTemplate, listMessageTemplates, type CreateTemplateState } from "./actions";

const CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] = [
  { value: "UTILITY", label: "Utilidade · lembrete, confirmação, aviso" },
  { value: "MARKETING", label: "Marketing · promoção, campanha, convite" },
];

const CATEGORY_HINT: Record<TemplateCategory, string> = {
  UTILITY:
    "Para avisos sobre algo que o contato já combinou com a clínica. É a categoria mais barata. Texto com oferta ou promoção faz a Meta trocar para Marketing.",
  MARKETING:
    "Para campanhas e ofertas. Custa mais por mensagem e o contato pode silenciar esse tipo de envio.",
};

/**
 * Criar um modelo e acompanhar a aprovação, sem o Gerenciador da Meta.
 *
 * O formulário é controlado para a prévia acompanhar a digitação, mas quem
 * decide é o servidor (`validateTemplateDraft`): a tela só mostra os erros que
 * ele devolve, junto de cada campo.
 */
export function TemplateManager({
  initialTemplates,
  initialError,
}: {
  initialTemplates: ManagedTemplate[] | null;
  initialError: string | null;
}) {
  // Modelo enviado: limpa o formulário e traz o status novo da Meta, no próprio
  // envio (não num efeito que reage ao retorno).
  const [state, formAction, pending] = useActionState<CreateTemplateState, FormData>(
    async (previous, form) => {
      const result = await createMessageTemplate(previous, form);
      if (result?.ok) {
        setName("");
        setHeader("");
        setBody("");
        setFooter("");
        setExamples([]);
        refresh();
      }
      return result;
    },
    null,
  );
  useActionToast(state, pending, { entity: "modelo", action: "create" });

  const [name, setName] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("UTILITY");
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [templates, setTemplates] = useState(initialTemplates);
  const [listError, setListError] = useState(initialError);
  const [refreshing, startRefresh] = useTransition();

  const ids = {
    name: useId(),
    category: useId(),
    categoryLabel: useId(),
    header: useId(),
    body: useId(),
    footer: useId(),
    examples: useId(),
  };
  const errors = state?.ok === false ? (state.errors ?? {}) : {};
  const variableCount = bodyVariables(body).length;
  const savedName = templateName(name);

  function refresh() {
    startRefresh(async () => {
      try {
        const result = await listMessageTemplates();
        if (result.ok) {
          setTemplates(result.templates);
          setListError(null);
        } else setListError(result.error);
      } catch {
        setListError("Não foi possível consultar os modelos na Meta agora.");
      }
    });
  }

  function insertVariable() {
    const field = bodyRef.current;
    const next = `{{${variableCount + 1}}}`;
    const start = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + next + body.slice(end));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + next.length, start + next.length);
    });
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardTitle hint="A Meta analisa cada modelo antes de liberar o uso. Depois de aprovado, ele aparece nos Disparos e na escolha do lembrete de consulta.">
            Novo modelo
          </CardTitle>

          <form action={formAction} className="mt-6 space-y-6">
            <Field
              label="Nome"
              htmlFor={ids.name}
              hint="Só para a sua organização: o contato não vê. Ex.: lembrete_consulta"
              error={errors.name}
            >
              <Input
                {...fieldProps(ids.name, { hint: true, error: errors.name })}
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={TEMPLATE_LIMITS.name}
                autoComplete="off"
                disabled={pending}
              />
              {savedName && savedName !== name.trim() && (
                <p className="mt-2 font-mono text-xs text-white/55">Será salvo como {savedName}</p>
              )}
            </Field>

            <Field
              label="Categoria"
              htmlFor={ids.category}
              labelId={ids.categoryLabel}
              hint={CATEGORY_HINT[category]}
              error={errors.category}
            >
              <SelectMenu
                label="Categoria"
                labelledBy={ids.categoryLabel}
                name="category"
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={(value) => setCategory(value as TemplateCategory)}
                disabled={pending}
              />
            </Field>

            <Field label="Cabeçalho" htmlFor={ids.header} optional error={errors.header}>
              <Input
                {...fieldProps(ids.header, { error: errors.header })}
                name="header"
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                maxLength={TEMPLATE_LIMITS.header}
                disabled={pending}
              />
            </Field>

            <Field
              label="Texto da mensagem"
              htmlFor={ids.body}
              hint="Use {{1}}, {{2}}… onde entram nome, data ou horário. O texto não pode começar nem terminar com uma variável."
              error={errors.body}
            >
              <Textarea
                {...fieldProps(ids.body, { hint: true, error: errors.body })}
                ref={bodyRef}
                name="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={TEMPLATE_LIMITS.body}
                rows={6}
                disabled={pending}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={insertVariable}
                  disabled={pending || variableCount >= TEMPLATE_LIMITS.variables}
                >
                  <Plus size={14} aria-hidden /> Inserir variável {`{{${variableCount + 1}}}`}
                </Button>
                <p className="font-mono text-xs text-white/50">
                  {body.length}/{TEMPLATE_LIMITS.body}
                </p>
              </div>
            </Field>

            {variableCount > 0 && (
              <fieldset className="space-y-3" aria-describedby={`${ids.examples}-hint`}>
                <legend className="text-sm font-medium text-white/85">Exemplos das variáveis</legend>
                <p id={`${ids.examples}-hint`} className="text-sm text-white/55">
                  A Meta usa os exemplos só para analisar o modelo. No envio, cada variável recebe
                  o dado real do contato.
                </p>
                {Array.from({ length: variableCount }, (_, i) => (
                  <div key={i} className="grid items-center gap-2 sm:grid-cols-[4rem_1fr]">
                    <label
                      htmlFor={`${ids.examples}-${i}`}
                      className="font-mono text-xs text-white/70"
                    >{`{{${i + 1}}}`}</label>
                    <Input
                      id={`${ids.examples}-${i}`}
                      name="examples"
                      value={examples[i] ?? ""}
                      onChange={(e) =>
                        setExamples((current) => {
                          const copy = Array.from({ length: variableCount }, (_, j) => current[j] ?? "");
                          copy[i] = e.target.value;
                          return copy;
                        })
                      }
                      maxLength={TEMPLATE_LIMITS.example}
                      placeholder={["Maria", "16/10", "15:00"][i] ?? ""}
                      aria-invalid={errors.examples ? true : undefined}
                      disabled={pending}
                    />
                  </div>
                ))}
                {errors.examples && (
                  <p role="alert" className="text-sm text-danger">
                    {errors.examples}
                  </p>
                )}
              </fieldset>
            )}

            <Field label="Rodapé" htmlFor={ids.footer} optional error={errors.footer}>
              <Input
                {...fieldProps(ids.footer, { error: errors.footer })}
                name="footer"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                maxLength={TEMPLATE_LIMITS.footer}
                disabled={pending}
              />
            </Field>

            <Button type="submit" loading={pending} loadingLabel="Enviando para a Meta">
              Enviar para aprovação
            </Button>
          </form>
        </Card>

        <TemplatePreview header={header} body={body} footer={footer} examples={examples} />
      </div>

      <Card>
        <CardTitle
          hint="O status vem da Meta. Modelo em análise costuma ser respondido em minutos ou algumas horas."
          action={
            <Button type="button" variant="ghost" size="sm" onClick={refresh} loading={refreshing} loadingLabel="Atualizando">
              <RefreshCw size={14} aria-hidden /> Atualizar status
            </Button>
          }
        >
          Seus modelos
        </CardTitle>
        <TemplateList templates={templates} error={listError} loading={refreshing && !templates} onRetry={refresh} />
      </Card>
    </div>
  );
}

/** Como a mensagem chega no WhatsApp, com os exemplos no lugar das variáveis. */
function TemplatePreview({
  header,
  body,
  footer,
  examples,
}: {
  header: string;
  body: string;
  footer: string;
  examples: string[];
}) {
  const filled = body.replace(/{{(\d+)}}/g, (slot, n) => examples[Number(n) - 1]?.trim() || slot);
  return (
    <aside aria-label="Prévia da mensagem" className="lg:sticky lg:top-6 lg:self-start">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/50">Prévia</p>
      <div className="mt-3 rounded-surface border border-white/10 bg-black/20 p-4">
        {body.trim() ? (
          <div className="max-w-full rounded-control bg-white/10 px-3 py-2 text-sm leading-relaxed text-white/90">
            {header.trim() && <p className="mb-1 font-semibold text-white">{header}</p>}
            <p className="whitespace-pre-line break-words">{filled}</p>
            {footer.trim() && <p className="mt-2 text-xs text-white/50">{footer}</p>}
          </div>
        ) : (
          <p className="text-sm text-white/50">O texto aparece aqui enquanto você escreve.</p>
        )}
      </div>
    </aside>
  );
}

function TemplateList({
  templates,
  error,
  loading,
  onRetry,
}: {
  templates: ManagedTemplate[] | null;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="mt-6 space-y-3" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-6">
        <Alert tone="danger">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Tentar de novo
          </Button>
        </Alert>
      </div>
    );
  }
  if (!templates?.length) {
    return (
      <EmptyState
        icon={FileText}
        title="Nenhum modelo ainda"
        description="Crie o primeiro acima. Depois que a Meta aprovar, ele aparece nos Disparos e na escolha do lembrete de consulta."
      />
    );
  }
  return (
    <ul className="mt-6 divide-y divide-white/10">
      {templates.map((template) => {
        const status = templateStatusLabel(template.status);
        return (
          <li key={template.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-sm text-white">{template.name}</p>
              <Badge tone={status.tone}>{status.label}</Badge>
              <Badge>{templateCategoryLabel(template.category)}</Badge>
              <span className="font-mono text-micro uppercase text-white/40">{template.language}</span>
            </div>
            {template.body && (
              <p className="mt-2 line-clamp-2 max-w-prose text-sm text-white/60">{template.body}</p>
            )}
            {template.status === "REJECTED" && (
              <p className="mt-2 text-sm text-danger">
                {templateRejectionLabel(template.rejectedReason ?? "")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
