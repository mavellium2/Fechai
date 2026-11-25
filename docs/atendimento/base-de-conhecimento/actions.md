# Base de conhecimento — Server Actions

As operações estão em `src/app/(dashboard)/agentes/actions.ts` e passam pela resolução do agente da sessão.

| Função | Retorno e efeito |
|---|---|
| `addDocument(prev, formData)` | Recebe título e texto ou arquivo de até 50 MB. Extrai o conteúdo, tenta guardar o original na CDN e registra o resultado da indexação. |
| `getDocumentContent(agentId, documentId)` | Título, conteúdo e revisão SHA-256 ou erro de agente/documento indisponível. |
| `updateDocumentAction(prev, formData)` | Salva edição com título e texto válidos. Se `baseRevision` está presente, verifica a versão e chama `publishDocumentDraft`; o formulário tradicional usa `updateDocument`. |
| `removeDocument(agentId, documentId)` | Exclui via `deleteDocument`, escopado pelo tenant, e registra a exclusão quando há snapshot. O repositório limpa o original da CDN se houver. |

`POST /api/sandbox` recebe o rascunho para teste em conversa isolada e devolve a inspeção quando solicitada. Aprovação de pergunta usa as [actions da fila](../perguntas-sem-resposta/actions.md).

[Actions](../../../src/app/(dashboard)/agentes/actions.ts) · [Sandbox](../../../src/app/api/sandbox/route.ts)
