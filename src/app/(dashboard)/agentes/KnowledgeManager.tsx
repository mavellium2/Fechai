"use client";

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useActionToast } from "@/components/ui/toast";
import { Download, FileText, Trash2, X } from "lucide-react";
import posthog from "posthog-js";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StepTabs, type StepTab } from "./StepTabs";
import { addDocument, removeDocument, type Result } from "./actions";
import { ViewEditDocumentDialog } from "./ViewEditDocumentDialog";
import { useUnsavedChanges } from "@/components/ui/unsaved-changes";
import { selectKnowledgeFiles, uploadKnowledgeItems, type KnowledgeUploadItem, type SelectedKnowledgeFile } from "@/modules/knowledge-base/upload-batch";

type Doc = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  fileUrl: string | null;
  fileName: string | null;
};

const STATUS: Record<string, { label: string; tone: "success" | "warn" | "danger" | "neutral" }> = {
  ready: { label: "Pronto", tone: "success" },
  pending: { label: "Processando", tone: "neutral" },
  failed: { label: "Falha nos embeddings", tone: "danger" },
  no_embeddings: { label: "Sem embeddings", tone: "warn" },
};

export function KnowledgeManager({ agentId, documents, addOnly = false }: { agentId: string; documents: Doc[]; addOnly?: boolean }) {
  const [showText, setShowText] = useState(!addOnly);
  const [showFiles, setShowFiles] = useState(!addOnly);
  const [state, setState] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  useActionToast(state, pending, { entity: "documento", action: "create" });
  const [files, setFiles] = useState<SelectedKnowledgeFile[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [progress, setProgress] = useState("");
  const [, startRemove] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedChanges(pending || files.length > 0 || Boolean(title) || Boolean(content), "Cérebro", formRef);

  // O limite do Next.js (next.config.ts) é aplicado antes da action rodar — um
  // arquivo grande demais derruba a requisição com um 413 cru. Bloquear aqui,
  // no input, evita esse crash e explica o motivo na hora.
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selection = selectKnowledgeFiles(files, Array.from(event.target.files ?? []));
    setFiles(selection.files);
    setFileError(selection.errors.join(" ") || null);
    setState(null);
    event.target.value = ""; // Permite selecionar novamente um arquivo removido.
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!files.length && !content.trim()) { setState({ ok: false, error: "Selecione arquivos ou cole um texto." }); return; }
    if (title.trim() && !content.trim()) { setState({ ok: false, error: "Preencha o conteúdo do texto ou limpe seu título para enviar apenas os arquivos." }); return; }
    setPending(true); setState(null); setFileError(null);
    posthog.capture("knowledge_document_submitted", { files: files.length });
    const items: KnowledgeUploadItem[] = files.map((file) => ({ id: file.id, title: file.title, file: file.file }));
    if (content.trim()) items.unshift({ id: "pasted-text", title: title.trim() });
    try {
      const results = await uploadKnowledgeItems(items, async (item, index, total) => {
        setProgress(`Enviando ${index + 1} de ${total}: ${item.title}`);
        const data = new FormData();
        data.set("agentId", agentId);
        data.set("title", item.title);
        if (item.file) data.set("file", item.file);
        else data.set("content", content);
        return addDocument(null, data);
      });
      const succeeded = new Set(results.filter((r) => r.ok).map((r) => r.id));
      setFiles((current) => current.filter((file) => !succeeded.has(file.id)).map((file) => ({
        ...file, error: results.find((r) => r.id === file.id)?.error,
      })));
      if (succeeded.has("pasted-text")) { setTitle(""); setContent(""); }
      const failed = results.filter((r) => !r.ok);
      const warnings = results.filter((r) => r.ok && r.info && r.info !== "Documento adicionado à base.").map((r) => r.info);
      setState({ ok: failed.length === 0,
        info: succeeded.size ? `${succeeded.size} documento(s) adicionado(s). ${warnings.join(" ")}` : undefined,
        error: failed.length ? `${failed.length} documento(s) não foram enviados. ${failed.find((r) => r.id === "pasted-text")?.error ?? "Os arquivos com falha continuam selecionados para tentar novamente."}` : undefined,
      });
    } finally { setPending(false); setProgress(""); }
  }

  function remove(doc: Doc) {
    setRemoveError(null);
    setRemovingId(doc.id);
    startRemove(async () => {
      posthog.capture("knowledge_document_removed");
      const res = await removeDocument(agentId, doc.id);
      // O retorno da action era descartado com `void`: falha ao apagar sumia
      // em silêncio e o documento continuava na lista sem explicação.
      if (!res.ok) setRemoveError(res.error ?? `Não foi possível remover "${doc.title}".`);
      setRemovingId(null);
    });
  }

  const tabs: StepTab[] = [
    {
      key: "adicionar",
      label: "Adicionar",
      content: (
        <form
          ref={formRef}
          onSubmit={send}
          className="space-y-4"
        >
          <fieldset disabled={pending} className="min-w-0 space-y-4">
          <input type="hidden" name="agentId" value={agentId} />
          <Field label="Título do texto" htmlFor="kb-title" optional={!content.trim()}>
            <Input {...fieldProps("kb-title")} name="title" placeholder="Ex: Tabela de preços" value={title} onChange={(e) => setTitle(e.target.value)} required={Boolean(content.trim())} />
          </Field>

          {addOnly && <div className="knowledge-add-modes"><Button variant="outline" type="button" onClick={() => setShowText(true)}>Escrever conteúdo</Button><Button variant="outline" type="button" onClick={() => setShowFiles(true)}>Enviar arquivos</Button></div>}
          <div hidden={!showText}><Field
            label="Conteúdo"
            htmlFor="kb-content"
            hint="Cole um texto e/ou selecione arquivos abaixo. Cada arquivo vira um documento separado."
            optional
          >
            <Textarea
              {...fieldProps("kb-content", { hint: true })}
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="Cole aqui o texto da sua base de conhecimento..."
            />
          </Field></div>

          <div hidden={!showFiles}><Field label="Arquivos" htmlFor="kb-file" hint="Selecione vários .txt, .md ou .pdf de uma vez. Até 50MB por arquivo; o envio acontece um por vez." optional>
            <input
              {...fieldProps("kb-file", { hint: true })}
              type="file"
              name="file"
              multiple
              accept=".txt,.md,.pdf"
              onChange={handleFileChange}
              className="w-full text-sm text-white/70 file:mr-3 file:rounded-control file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white file:transition-colors hover:file:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            />
          </Field></div>
          {addOnly && <p className="agent-help">Arquivos .txt, .md ou .pdf · até 50 MB por arquivo</p>}

          {files.length > 0 && <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-white/70">{files.length} arquivo(s) selecionado(s)</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setFiles([]); setFileError(null); }}>Limpar seleção</Button>
            </div>
            <ul className="space-y-2">{files.map((file) => <li key={file.id} className="rounded-control border border-white/10 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm text-white/75">{file.file.name} · {(file.file.size / (1024 * 1024)).toFixed(1)} MB</p>
                  <label className="mt-2 block text-xs text-white/55" htmlFor={`kb-file-${file.id}`}>Título na base</label>
                  <Input id={`kb-file-${file.id}`} className="mt-1" value={file.title} required maxLength={200}
                    onChange={(e) => setFiles((current) => current.map((f) => f.id === file.id ? { ...f, title: e.target.value } : f))} />
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remover arquivo selecionado ${file.file.name}`} title="Remover da seleção"
                  onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}><X size={16} aria-hidden /></Button>
              </div>
              {file.error && <p role="alert" className="mt-2 text-sm text-danger">{file.error}</p>}
            </li>)}</ul>
          </div>}
          </fieldset>

          {fileError && <Alert tone="warn">{fileError}</Alert>}


          {progress && <p role="status" className="text-sm text-white/70">{progress}</p>}
          <Button type="submit" disabled={!content.trim() && !files.length} loading={pending} loadingLabel="Enviando documentos">
            {files.some((file) => file.error) ? "Tentar enviar os pendentes" : "Adicionar à base"}
          </Button>
        </form>
      ),
    },
    {
      key: "documentos",
      label: `Documentos (${documents.length})`,
      content: (
        <div>
          {removeError && (
            <Alert tone="danger" className="mb-3">
              {removeError}
            </Alert>
          )}

          {documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum documento na base"
              description="O agente responde só com o que você ensinar. Comece com o texto que você mais repete para clientes — preços, horários, como funciona."
            />
          ) : (
            <ul className="space-y-2">
              {documents.map((d) => {
                const s = STATUS[d.status] ?? { label: d.status, tone: "neutral" as const };
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-surface border border-white/10 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{d.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {d.fileUrl && (
                          <a
                            href={d.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-white/60 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                          >
                            <Download size={12} aria-hidden />
                            {d.fileName ?? "arquivo original"}
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <ViewEditDocumentDialog
                        agentId={agentId}
                        documentId={d.id}
                        title={d.title}
                        hasFile={Boolean(d.fileUrl)}
                      />

                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        className="text-white/60 enabled:hover:text-danger"
                        aria-label={`Remover documento ${d.title}`}
                        disabled={removingId === d.id}
                        confirm={{
                          title: "Remover da base de conhecimento?",
                          description: `"${d.title}" sai da base e o agente deixa de usar esse conteúdo nas respostas. Não dá para desfazer.`,
                          confirmLabel: "Remover documento",
                          tone: "danger",
                        }}
                        onConfirm={() => remove(d)}
                      >
                        <Trash2 size={16} aria-hidden />
                      </ConfirmButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ),
    },
  ];

  return addOnly ? tabs[0].content : <StepTabs tabs={tabs} />;
}
