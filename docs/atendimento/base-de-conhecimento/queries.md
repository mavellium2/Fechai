# Base de conhecimento — Queries

| Função | Retorno e filtros |
|---|---|
| `listDocuments(tenantId, agentId)` | Metadados por conta e agente, mais recentes primeiro. A página de Agentes também projeta os metadados diretamente. |
| `getDocument(tenantId, agentId, documentId)` | Documento individual com texto completo. Usado sob demanda no editor. |
| `searchSimilarChunks(tenantId, agentId, queryEmbedding, limit?, excludeDocumentId?)` | Conteúdo, distância cosseno, id e título do documento. Filtra conta e agente, ordena pela menor distância e usa quatro resultados por padrão. |
| Recuperação do sandbox com rascunho | Exclui o documento publicado correspondente. Trechos temporários do rascunho concorrem com os demais pela mesma distância. |

[Implementação das consultas](../../../src/modules/knowledge-base/repository.ts) · [Recuperação no motor](../../../src/modules/agent-engine/orchestrator.ts)
