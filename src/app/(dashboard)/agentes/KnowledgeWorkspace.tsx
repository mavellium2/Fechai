"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import type { SandboxDraft } from "@/modules/agent-engine/sandbox-draft";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { useSaveFeedback } from "@/components/ui/toast";
import { useUnsavedChanges, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { getDocumentContent, removeDocument, updateDocumentAction } from "./actions";
import { KnowledgeManager } from "./KnowledgeManager";

export type KnowledgeDoc = { id: string; title: string; status: string; createdAt: Date; fileUrl: string | null; fileName: string | null };
export function KnowledgeWorkspace({ agentId, name, documents, draft, onDraft, tested, onTest, openRequest }: {
  agentId: string; name: string; documents: KnowledgeDoc[]; draft: SandboxDraft | null;
  onDraft: (draft: SandboxDraft | null) => void; tested: boolean; onTest: () => void;
  openRequest?: { id: string; serial: number } | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const guard = useUnsavedNavigation();
  const save = useSaveFeedback({ entity: "documento" });
  const changed = Boolean(draft && (draft.title !== draft.baseTitle || draft.content !== draft.baseContent));
  useUnsavedChanges(changed || save.saving, "Rascunho do conhecimento", root);
  async function open(id: string) {
    setLoading(true); setError("");
    try { const result = await getDocumentContent(agentId, id); if (result.ok) { onDraft({ documentId: id, title: result.title, content: result.content, baseTitle: result.title, baseContent: result.content, baseRevision: result.revision }); setAdding(false); } else setError(result.error); }
    catch { setError("Não foi possível abrir o documento. Tente novamente."); }
    finally { setLoading(false); }
  }
  // A request comes from a source actually returned by the server, never a guessed citation.
  useEffect(() => {
    if (!openRequest) return;
    let canceled = false;
    getDocumentContent(agentId, openRequest.id).then(result => {
      if (canceled) return;
      if (result.ok) { onDraft({ documentId: openRequest.id, title: result.title, content: result.content, baseTitle: result.title, baseContent: result.content, baseRevision: result.revision }); setAdding(false); }
      else setError(result.error);
    }).catch(() => { if (!canceled) setError("Não foi possível abrir o documento."); });
    return () => { canceled = true; };
  }, [agentId, openRequest, onDraft]);
  async function publish() {
    if (!draft || !tested || !changed || save.saving) return;
    if (!draft.baseRevision) { setError("Reabra o documento para conferir a versão publicada antes de salvar."); return; }
    const snapshot = { ...draft };
    const data = new FormData(); data.set("agentId", agentId);
    for (const [key, value] of Object.entries(snapshot)) if (value !== undefined && key !== "baseContent" && key !== "baseTitle") data.set(key, value);
    const result = await save.run(() => updateDocumentAction(null, data));
    if (result.ok) { const fresh = await getDocumentContent(agentId, snapshot.documentId); onDraft({ ...snapshot, baseContent: snapshot.content, baseTitle: snapshot.title, baseRevision: fresh.ok ? fresh.revision : undefined }); router.refresh(); }
  }
  return <div ref={root} className="knowledge-workspace">
    {error && <div role="alert" className="agent-error">{error}<Button variant="ghost" onClick={() => setError("")}>Fechar</Button></div>}
    {loading && <p role="status">Abrindo documento...</p>}
    {draft ? <>
      <button type="button" className="agent-inline-link" onClick={() => guard(() => onDraft(null))}><ChevronLeft size={14} />Documentos · {draft.baseTitle}</button>
      <span className={`knowledge-version ${changed ? "knowledge-draft" : ""}`}>{changed ? "Rascunho de alteração" : "Conteúdo publicado"}</span>
      <fieldset disabled={save.saving} className="knowledge-document-fields"><label className="agent-form-field"><span>Título do documento</span><input value={draft.title} maxLength={200} onChange={e => onDraft({ ...draft, title: e.target.value })} /></label><label className="agent-form-field"><span>Conteúdo</span><textarea value={draft.content} rows={12} maxLength={500_000} onChange={e => onDraft({ ...draft, content: e.target.value })} /></label></fieldset>
      <p className="agent-help">{name} consulta este texto para responder sobre o atendimento.</p>
      {changed && <><div className="agent-example"><small>O que mudou</small><p>{draft.title !== draft.baseTitle ? "Título e conteúdo revisados" : "Conteúdo revisado"}</p><details><summary>Ver alterações</summary><del>{draft.baseContent}</del><ins>{draft.content}</ins></details></div><p className="agent-help">A versão em atendimento continua igual até você publicar.</p></>}
      <footer className="agent-save-bar"><span>{changed ? tested ? "Rascunho aplicado ao teste" : "Alteração ainda não aplicada ao teste" : "Publicado · disponível para o agente"}</span>{changed && <Button disabled={loading || save.saving || !draft.title.trim() || !draft.content.trim()} loading={save.saving} onClick={tested ? publish : onTest} variant={tested ? "default" : "outline"}>{tested ? "Publicar alterações" : "Aplicar ao teste"}</Button>}</footer>
    </> : <>
      <div className="knowledge-list-title"><h3>Documentos do negócio</h3><Button variant="outline" onClick={() => { setAdding(true); document.getElementById("kb-title")?.focus(); }}><Plus size={14} />Adicionar</Button></div>
      {!documents.length && <p className="agent-help">Nenhum documento. Adicione o conhecimento que o agente deve consultar.</p>}
      <ul className="knowledge-document-list">{documents.map(doc => <li key={doc.id}><div><strong>{doc.title}</strong><small>{{ ready: "Pronto para consulta", pending: "Processando", failed: "Falha no processamento", no_embeddings: "Busca semântica indisponível" }[doc.status] || doc.status} · {doc.fileName ? "Arquivo" : "Texto"}</small>{doc.fileUrl && <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">{doc.fileName || "Arquivo original"}</a>}</div><button className="agent-inline-link" disabled={loading} onClick={() => void open(doc.id)}>Abrir ›</button><ConfirmButton variant="ghost" size="icon" aria-label={`Remover documento ${doc.title}`} confirm={{ title: "Remover documento?", description: `O agente deixará de consultar “${doc.title}”.`, confirmLabel: "Remover", tone: "danger" }} onConfirm={async () => { const result = await save.run(() => removeDocument(agentId, doc.id)); if (result.ok) router.refresh(); }}><Trash2 size={14} /></ConfirmButton></li>)}</ul>
      {adding && <section className="agent-form-section"><h3>Adicionar conhecimento</h3><KnowledgeManager agentId={agentId} documents={documents} addOnly /></section>}
    </>}
  </div>;
}
