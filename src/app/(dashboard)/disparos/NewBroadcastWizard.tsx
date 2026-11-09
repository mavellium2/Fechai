"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ClipboardList, FileSpreadsheet, Send, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectMenu } from "@/components/ui/select-menu";
import { useOptionalToast } from "@/components/ui/toast/toast-provider";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { cn } from "@/lib/utils";
import type { BroadcastTemplate } from "@/modules/broadcasts/template";
import type { ColumnMapping, ImportedRecipient } from "@/modules/broadcasts/import";
import {
  defaultVariables,
  firstName,
  hasName,
  MAX_RECIPIENTS,
  nameSlots,
  namelessValues,
  parsePastedContacts,
  type ListContact,
  type NamelessMode,
  type VariableSource,
} from "@/modules/broadcasts/contacts";
import { findNamelessVersion } from "@/modules/broadcasts/template";
import { NamelessPanel } from "./NamelessPanel";
import { ContactPicker, type PickedContacts } from "./ContactPicker";
import { PasteContacts } from "./PasteContacts";
import { VariableFields } from "./VariableFields";
import { FileContacts } from "./FileContacts";
import { MessagePreview, TemplatePicker } from "./TemplatePicker";
import { ReviewStep } from "./ReviewStep";
import { SendEstimate } from "./SendEstimate";
import { DisparosNav } from "./DisparosNav";
import { formatPhone } from "./labels";
import {
  loadBroadcastTemplates,
  prepareBroadcast,
  prepareBroadcastFromList,
  sendBroadcastTest,
  startBroadcast,
} from "./actions";

export type Review = {
  id: string;
  name: string;
  template: BroadcastTemplate;
  /** Versão para quem não tem nome, quando o disparo usa. */
  namelessTemplate?: BroadcastTemplate | null;
  /** Contatos sem nome que ficaram de fora ("não enviar"). */
  skippedNameless?: number;
  recipients: ImportedRecipient[];
  duplicates: number;
  recentPhones: string[];
};

type Source = "list" | "paste" | "file";
type Issue = { row: number; error: string; label?: string };
type Step = 1 | 2 | 3;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Mensagem" },
  { n: 2, label: "Para quem" },
  { n: 3, label: "Revisar e enviar" },
];

const SOURCES: { value: Source; label: string; icon: typeof Users }[] = [
  { value: "list", label: "Meus contatos", icon: Users },
  { value: "paste", label: "Digitar ou colar", icon: ClipboardList },
  { value: "file", label: "Planilha", icon: FileSpreadsheet },
];

const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Horário de Brasília" },
  { value: "America/Manaus", label: "Manaus" },
  { value: "America/Rio_Branco", label: "Rio Branco" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
  { value: "UTC", label: "UTC" },
];

const TEST_PHONE_KEY = "fechai:disparos:telefone-teste";

function defaultName() {
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `Disparo de ${today}`;
}

/**
 * Novo disparo em três etapas: mensagem → para quem → revisar e enviar. Um
 * rascunho só (voltar e revisar de novo atualiza o mesmo). Escolher a mensagem
 * já avança; o rodapé fixo diz o que falta em vez de só desligar o botão.
 */
export function NewBroadcastWizard({
  displayPhone,
  defaultTestPhone,
  draft,
  initialTemplateId,
  notice,
}: {
  displayPhone: string | null;
  defaultTestPhone: string;
  draft: Review | null;
  /** "Usar em disparo" na tela de modelos: já chega com o modelo escolhido. */
  initialTemplateId?: string;
  /** Aviso logo abaixo das abas. */
  notice?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useOptionalToast();
  const [step, setStep] = useState<Step>(draft ? 3 : 1);
  const [name, setName] = useState(draft?.name ?? defaultName());
  const [templates, setTemplates] = useState<BroadcastTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [template, setTemplate] = useState<BroadcastTemplate | null>(draft?.template ?? null);
  const [source, setSource] = useState<Source>("list");
  const [picked, setPicked] = useState<PickedContacts>(
    () => new Map((draft?.recipients ?? []).map((r) => [r.phone, { phone: r.phone, name: r.name }])),
  );
  const [pasted, setPasted] = useState("");
  const [variables, setVariables] = useState<VariableSource[]>(
    defaultVariables(draft?.template.parameterCount ?? 0),
  );
  const [namelessChoice, setNamelessChoice] = useState<NamelessMode | null>(null);
  const [namelessAlt, setNamelessAlt] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ phone: "", name: "", parameters: [] });
  const [review, setReview] = useState<Review | null>(draft);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [testPhone, setTestPhone] = useState(defaultTestPhone);
  const [start, setStart] = useState<"now" | "scheduled">("now");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [recent, setRecent] = useState<string[]>(draft?.recentPhones ?? []);
  const [acknowledge, setAcknowledge] = useState(false);
  const [consent, setConsent] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const test = useSaveFeedback({ entity: "teste", action: "create" });
  const confirm = useSaveFeedback({ entity: "disparo", action: "create" });
  const busy = preparing || test.saving || confirm.saving;

  async function fetchTemplates() {
    setLoadingTemplates(true);
    setTemplatesError("");
    try {
      const result = await loadBroadcastTemplates();
      if (!result.ok) setTemplatesError(result.error);
      else {
        setTemplates(result.templates);
        const preset = initialTemplateId
          ? result.templates.find((t) => t.id === initialTemplateId)
          : undefined;
        if (preset && !template) {
          setTemplate(preset);
          setVariables(defaultVariables(preset.parameterCount));
          setStep(2);
        }
      }
    } catch {
      setTemplatesError("Não foi possível carregar as mensagens aprovadas.");
    } finally {
      setLoadingTemplates(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchTemplates();
      // O último número de teste usado vence o do cadastro.
      try {
        const saved = window.localStorage.getItem(TEST_PHONE_KEY);
        if (saved) setTestPhone(saved);
      } catch {
        // Armazenamento bloqueado: fica o número do cadastro.
      }
    }, 0);
    return () => clearTimeout(timer);
    // Carrega uma vez ao abrir; "Atualizar lista" refaz depois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(next: Step) {
    setStep(next);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /** Escolher a mensagem é a decisão da etapa 1: já segue para a 2. */
  function chooseTemplate(t: BroadcastTemplate) {
    if (t.id !== template?.id) {
      setTemplate(t);
      setNamelessChoice(null);
      setNamelessAlt(null);
      setVariables(defaultVariables(t.parameterCount));
      setMapping(autoMapping(columns, t.parameterCount));
    }
    go(2);
  }

  const listContacts = useMemo<ListContact[]>(() => {
    if (source === "list") return [...picked.values()];
    if (source === "paste")
      return parsePastedContacts(pasted).flatMap((l) => (l.ok ? [{ phone: l.phone, name: l.name }] : []));
    return [];
  }, [source, picked, pasted]);

  const sample = listContacts.find(hasName) ?? listContacts[0] ?? null;
  const previewValues = useMemo(() => {
    if (!template || source === "file") return undefined;
    return variables.map((v) => {
      if (v.source === "text") return v.text.trim() || null;
      const value = v.source === "firstName" ? firstName(sample?.name) : sample?.name?.trim();
      return value || (v.source === "firstName" ? "[primeiro nome]" : "[nome completo]");
    });
  }, [template, source, variables, sample]);

  // Quem não tem nome: só importa quando a mensagem usa o nome e os contatos
  // não vêm de planilha (na planilha, cada espaço vem de uma coluna).
  const slots = source === "file" ? [] : nameSlots(variables);
  const namelessCount = slots.length ? listContacts.filter((c) => !hasName(c)).length : 0;
  const alternatives =
    template && templates && slots.length
      ? templates.filter(
          (t) => t.id !== template.id && t.parameterCount === variables.length - slots.length,
        )
      : [];
  const suggested =
    template && templates ? findNamelessVersion(template, templates, slots) : undefined;
  const namelessMode: NamelessMode = namelessChoice ?? (suggested ? "template" : "text");
  const altId = namelessAlt ?? suggested?.id ?? "";
  const fallback = slots.length ? variables[slots[0] - 1].text : "";
  function setFallback(text: string) {
    setVariables(variables.map((v) => (v.source === "text" ? v : { ...v, text })));
  }

  // Agendado: o horário de início também é o início da faixa de cada dia — o
  // que não couber até o "último envio" continua no dia seguinte no mesmo horário.
  const dailyStart = start === "scheduled" && time ? time : windowStart;

  // O que falta em cada etapa — o rodapé diz isso em vez de só desligar o botão.
  const missing: string[] = [];
  if (step === 1 && !template) missing.push("escolha a mensagem");
  if (step === 2 && template) {
    if (source === "file") {
      if (!file) missing.push("escolha o arquivo");
      else if (!columns.length) missing.push("aguarde a leitura do arquivo");
      else if (!mapping.phone || mapping.parameters.some((p) => !p))
        missing.push("associe o telefone e os espaços às colunas");
    } else {
      if (!listContacts.length) missing.push("escolha os contatos");
      if (listContacts.length > MAX_RECIPIENTS) missing.push(`use até ${MAX_RECIPIENTS} contatos`);
      if (variables.some((v) => v.source === "text" && !v.text.trim()))
        missing.push("preencha os textos dos espaços");
      if (namelessCount > 0 && namelessMode === "template" && !alternatives.some((t) => t.id === altId))
        missing.push("escolha a mensagem para quem não tem nome");
      if (namelessCount > 0 && namelessMode === "text" && !fallback.trim())
        missing.push("escreva o que vai no lugar do nome");
    }
  }
  if (step === 3) {
    if (!name.trim()) missing.push("dê um nome ao disparo");
    if (start === "scheduled" && (!date || !time)) missing.push("escolha a data e a hora de início");
    if (!dailyStart || !windowEnd) missing.push("defina o horário de envio");
    else if (dailyStart >= windowEnd)
      missing.push(
        start === "scheduled"
          ? "o último envio precisa ser depois do horário de início"
          : "o fim do horário precisa ser depois do início",
      );
    if (recent.length && !acknowledge) missing.push("confirme o aviso de envios recentes");
    if (!consent) missing.push("confirme a autorização dos contatos");
  }

  async function submitContacts() {
    if (!template) return;
    setIssues([]);
    setPreparing(true);
    const contacts = listContacts;
    try {
      const r =
        source === "file"
          ? await prepareBroadcast(fileForm(template))
          : await prepareBroadcastFromList({
              name,
              templateId: template.id,
              draftId: review?.id,
              contacts,
              variables,
              nameless: { mode: namelessMode, templateId: altId },
            });
      if (r.ok) {
        // Sem toast de sucesso: a própria etapa seguinte é o retorno.
        applyReview(r);
        go(3);
        return;
      }
      const found: Issue[] = "issues" in r && Array.isArray(r.issues) ? (r.issues as Issue[]) : [];
      setIssues(
        source === "file"
          ? found
          : found.map((i) => {
              const c = contacts[i.row - 1];
              return { ...i, label: c ? [c.name, formatPhone(c.phone)].filter(Boolean).join(" · ") : undefined };
            }),
      );
      toast?.error(r.error);
    } catch {
      toast?.error("Não foi possível preparar a lista. Tente de novo.");
    } finally {
      setPreparing(false);
    }
  }

  function fileForm(t: BroadcastTemplate) {
    const form = new FormData();
    form.set("name", name);
    form.set("templateId", t.id);
    form.set("file", file!);
    form.set("mapping", JSON.stringify(mapping));
    if (review) form.set("draftId", review.id);
    return form;
  }

  function applyReview(r: Review) {
    setReview({
      id: r.id,
      name: r.name,
      template: r.template,
      namelessTemplate: r.namelessTemplate ?? null,
      skippedNameless: r.skippedNameless ?? 0,
      recipients: r.recipients,
      duplicates: r.duplicates,
      recentPhones: r.recentPhones,
    });
    setRecent(r.recentPhones);
    setAcknowledge(false);
  }

  async function sendTest() {
    if (!review) return;
    try {
      window.localStorage.setItem(TEST_PHONE_KEY, testPhone.trim());
    } catch {
      // Sem armazenamento, só não lembra o número.
    }
    await test.run(async () => {
      const r = await sendBroadcastTest(review.id, testPhone);
      return r.ok
        ? { ok: true, info: "Teste enviado. Confira a mensagem no seu WhatsApp." }
        : { ok: false, error: r.error ?? "Não foi possível enviar o teste." };
    });
  }

  async function confirmSend() {
    if (!review) return;
    const result = await confirm.run(async () => {
      const r = await startBroadcast(
        review.id,
        consent,
        { timezone, windowStart: dailyStart, windowEnd, ...(start === "scheduled" ? { date, time } : {}) },
        acknowledge,
        name,
      );
      if (!r.ok && "recentPhones" in r && r.recentPhones) {
        setRecent(r.recentPhones);
        setAcknowledge(false);
      }
      return r;
    });
    if (result.ok) router.push(`/disparos/${review.id}`);
  }

  const reachable = (n: Step) => n < step || (n === 3 && review !== null);

  const stepper = (
    <nav aria-label="Etapas do disparo" className="lg:flex lg:justify-end">
      <ol className="flex flex-wrap items-center gap-1">
        {STEPS.map((s, i) => {
          const done = s.n < step;
          const current = s.n === step;
          const canGo = !current && !busy && reachable(s.n);
          return (
            <li key={s.n} className="flex items-center gap-1">
              {i > 0 && <span className="h-px w-4 bg-white/20" aria-hidden />}
              <button
                type="button"
                disabled={!canGo}
                aria-current={current ? "step" : undefined}
                onClick={() => go(s.n)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                  current
                    ? "bg-iris/15 font-medium text-white"
                    : done
                      ? "text-white/75 enabled:hover:bg-white/5"
                      : "text-white/45",
                  canGo ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full font-mono text-xs",
                    done ? "bg-success/20 text-success" : current ? "bg-iris text-white" : "bg-white/10",
                  )}
                  aria-hidden
                >
                  {done ? <Check size={12} /> : s.n}
                </span>
                {s.label}
                {done && <span className="sr-only">(concluída)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  return (
    <div ref={top} className="scroll-mt-24 space-y-5">
      <DisparosNav actions={stepper} />
      {notice}

      {step === 1 && (
        <section aria-labelledby="pick-title" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="pick-title" className="font-display text-lg font-semibold text-white">
              Escolha a mensagem
            </h2>
            <p className="text-sm text-white/55">
              Só mensagens aprovadas pela Meta iniciam conversa.
              {displayPhone ? ` Envio por ${displayPhone}.` : ""}
            </p>
          </div>
          <TemplatePicker
            templates={templates}
            value={template?.id ?? ""}
            onChange={chooseTemplate}
            loading={loadingTemplates}
            error={templatesError}
            onReload={() => void fetchTemplates()}
            disabled={busy}
          />
        </section>
      )}

      {step === 2 && template && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <aside className="space-y-4" aria-label="Mensagem">
            <section className="space-y-3 rounded-control border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 truncate text-sm font-medium text-white">
                  Mensagem
                  <span className="ml-2 font-mono text-xs font-normal text-white/50">{template.name}</span>
                </h2>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(1)}>
                  Trocar
                </Button>
              </div>
              <MessagePreview template={template} values={previewValues} />
              {sample && source !== "file" && template.parameterCount > 0 && (
                <p className="text-xs text-white/50">Exemplo para {sample.name || formatPhone(sample.phone)}</p>
              )}
              {source === "file" && template.parameterCount > 0 && (
                <p className="text-xs text-white/55">Os espaços destacados vêm das colunas da planilha.</p>
              )}
            </section>
            {source !== "file" && template.parameterCount > 0 && (
              <VariableFields variables={variables} onChange={setVariables} disabled={busy} />
            )}
            {slots.length > 0 && listContacts.length > 0 && (
              <NamelessPanel
                main={template}
                slots={slots}
                count={namelessCount}
                mode={namelessMode}
                onMode={setNamelessChoice}
                alternatives={alternatives}
                altId={altId}
                onAlt={setNamelessAlt}
                fallback={fallback}
                onFallback={setFallback}
                altValues={namelessValues(variables)}
                fallbackValues={variables.map((v) =>
                  v.source === "text" ? v.text.trim() || null : fallback.trim() || null,
                )}
                disabled={busy}
              />
            )}
          </aside>

          <section aria-labelledby="who-title" className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="who-title" className="font-display text-lg font-semibold text-white">
                Quem vai receber?
              </h2>
              <div role="radiogroup" aria-label="De onde vêm os contatos" className="flex flex-wrap gap-1 rounded-control bg-white/5 p-1">
                {SOURCES.map((o) => {
                  const on = o.value === source;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={busy}
                      onClick={() => {
                        if (on) return;
                        setSource(o.value);
                        setIssues([]);
                      }}
                      className={cn(
                        "inline-flex h-8 items-center gap-2 rounded-control px-3 text-sm transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                        on ? "bg-iris text-white" : "text-white/70 hover:text-white",
                      )}
                    >
                      <o.icon size={14} aria-hidden />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {source === "list" && <ContactPicker picked={picked} onChange={setPicked} disabled={busy} />}
            {source === "paste" && <PasteContacts text={pasted} onChange={setPasted} disabled={busy} />}
            {source === "file" && (
              <FileContacts
                template={template}
                file={file}
                onFile={(f) => {
                  setFile(f);
                  setColumns([]);
                  setIssues([]);
                }}
                columns={columns}
                onColumns={(cols) => {
                  setColumns(cols);
                  setMapping(autoMapping(cols, template.parameterCount));
                }}
                mapping={mapping}
                onMapping={setMapping}
                disabled={busy}
              />
            )}
            {issues.length > 0 && <IssueList issues={issues} />}
          </section>
        </div>
      )}

      {step === 3 && review && (
        <ReviewStep
          review={review}
          testPhone={testPhone}
          onTestPhone={setTestPhone}
          onSendTest={sendTest}
          testing={test.saving}
          disabled={busy}
        >
          <section aria-labelledby="when-title" className="space-y-4 rounded-control border border-white/10 p-4">
            <h3 id="when-title" className="text-sm font-medium text-white">
              Quando enviar
            </h3>
            <label className="block text-xs text-white/70">
              Nome do disparo <span className="text-white/45">(só você vê)</span>
              <Input className="mt-1" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </label>
            <SegmentedControl
              label="Início do disparo"
              value={start}
              disabled={busy}
              options={[
                { value: "now", label: "Assim que possível" },
                { value: "scheduled", label: "Agendar" },
              ]}
              onSelect={setStart}
            />
            {start === "scheduled" ? (
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-white/70">
                  Data
                  <Input type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
                </label>
                <label className="text-xs text-white/70">
                  Começa às
                  <Input type="time" className="mt-1" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
                </label>
                <label className="text-xs text-white/70">
                  Último envio às
                  <Input type="time" className="mt-1" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} disabled={busy} />
                </label>
                <p className="col-span-3 text-xs text-white/50">
                  Se não terminar até o último horário, para e continua no dia seguinte
                  {time ? ` às ${time}` : " no mesmo horário de início"}.
                </p>
              </div>
            ) : (
              <fieldset>
                <legend className="text-xs text-white/70">Enviar todos os dias entre</legend>
                <div className="mt-1 flex items-center gap-2">
                  <Input type="time" aria-label="Começar a enviar às" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} disabled={busy} />
                  <span className="text-sm text-white/55">e</span>
                  <Input type="time" aria-label="Parar de enviar às" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} disabled={busy} />
                </div>
              </fieldset>
            )}
            <SendEstimate
              total={review.recipients.length}
              timezone={timezone}
              scheduled={start === "scheduled" ? { date, time } : null}
              windowStart={dailyStart}
              windowEnd={windowEnd}
            />
            <details>
              <summary className="cursor-pointer text-xs text-white/60">Fuso horário</summary>
              <SelectMenu
                label="Fuso horário"
                value={timezone}
                onChange={setTimezone}
                disabled={busy}
                className="mt-2 w-full"
                options={TIMEZONES}
              />
            </details>
          </section>

          {recent.length > 0 && (
            <Alert tone="warn">
              <p className="text-sm">
                {recent.length === 1 ? "1 contato recebeu" : `${recent.length} contatos receberam`} disparo nos
                últimos 7 dias. Mensagens seguidas aumentam o risco de denúncia do seu número.
              </p>
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 accent-iris"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                  disabled={busy}
                />
                Enviar mesmo assim
              </label>
            </Alert>
          )}

          <label className="flex items-start gap-3 rounded-control border border-white/10 p-4 text-sm text-white/85">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy}
              className="mt-1 accent-iris"
            />
            <span>
              Estes contatos autorizaram receber mensagens da minha empresa pelo WhatsApp.
              <span className="mt-1 block text-xs text-white/55">
                Fica registrado com seu usuário e horário.
              </span>
            </span>
          </label>
        </ReviewStep>
      )}

      <footer className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-3 border-t border-white/10 bg-ink/95 px-1 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/65" aria-live="polite">
          {missing.length
            ? `Para continuar: ${missing.join(", ")}.`
            : step === 2
              ? source === "file"
                ? "Tudo certo. Vamos ler a planilha e montar a revisão."
                : `${listContacts.length} ${listContacts.length === 1 ? "contato" : "contatos"} prontos.`
              : step === 3 && review
                ? "O rascunho fica salvo: dá para sair e continuar depois."
                : "Escolha uma mensagem para continuar."}
        </p>
        <div className="flex gap-2">
          {step === 1 ? (
            <Link
              href="/disparos"
              className="inline-flex h-10 items-center rounded-control px-4 text-sm text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              Cancelar
            </Link>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => go((step - 1) as Step)}>
              <ArrowLeft size={16} aria-hidden />
              Voltar
            </Button>
          )}
          {step === 1 && template && (
            <Button onClick={() => go(2)}>
              Próximo
              <ArrowRight size={16} aria-hidden />
            </Button>
          )}
          {step === 2 && (
            <Button loading={preparing} disabled={missing.length > 0 || busy} onClick={submitContacts}>
              Revisar
              <ArrowRight size={16} aria-hidden />
            </Button>
          )}
          {step === 3 && review && (
            <Button variant="cta" loading={confirm.saving} disabled={missing.length > 0 || busy} onClick={confirmSend}>
              <Send size={16} aria-hidden />
              {start === "scheduled" ? "Agendar" : "Enviar"} {review.recipients.length}{" "}
              {review.recipients.length === 1 ? "mensagem" : "mensagens"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}


function autoMapping(available: string[], count: number): ColumnMapping {
  return {
    phone: ["telefone", "phone", "whatsapp", "celular"].find((c) => available.includes(c)) ?? "",
    name: ["nome", "name"].find((c) => available.includes(c)) ?? "",
    parameters: Array.from({ length: count }, (_, i) => (available.includes(`var_${i + 1}`) ? `var_${i + 1}` : "")),
  };
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <div className="rounded-control border border-danger/30 bg-danger/10 p-4" role="alert">
      <h3 className="font-semibold text-white">
        Corrija {issues.length === 1 ? "este contato" : `estes ${issues.length} contatos`} e tente de novo
      </h3>
      <ul className="mt-3 max-h-60 space-y-2 overflow-auto text-sm text-white/75">
        {issues.map((i) => (
          <li key={i.row}>
            {i.label ? <span className="font-mono text-white">{i.label}</span> : <>Linha {i.row}</>}: {i.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
