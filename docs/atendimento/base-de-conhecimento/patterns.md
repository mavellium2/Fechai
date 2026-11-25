# Base de conhecimento — Padrões de código

A busca do sandbox recebe o documento do rascunho no parâmetro de exclusão. Trecho de `orchestrator.ts`.

```ts
let chunks: { content: string; distance: number; documentId: string; title: string; draft?: boolean }[] = await searchSimilarChunks(tenantId, agentId, embedding, 4, draft?.documentId);
```

- Preserve os filtros de tenant e agente na recuperação, incluindo consultas que usam pgvector.
- Para publicar a revisão testada, envie `baseRevision` e mantenha a troca de conteúdo e trechos na transação. Preparação de embeddings fica antes da transação.
- Se os vetores do rascunho falharem, o teste retorna erro. Para a inspeção, apresente os trechos efetivamente recuperados.

[Repositório](../../../src/modules/knowledge-base/repository.ts) · [Contrato do rascunho](../../../src/app/(dashboard)/agentes/README.md#rascunho-de-conhecimento-e-teste)
