# Base de conhecimento — Domínio

| Modelo | Campos e relações relevantes |
|---|---|
| `KnowledgeDocument` | `tenantId`, `agentId`, `title`, `content`, `fileUrl?`, `fileName?`, `status` e os trechos do documento. |
| `KnowledgeChunk` | `tenantId`, `agentId`, `documentId`, `content` e `embedding` com dimensão 1536, operado pelo pgvector. |

- Ingestão lê texto ou extrai texto de um PDF com camada textual. A divisão em trechos, com sobreposição, e os embeddings preparam o conteúdo para busca semântica.
- `pending`, `ready`, `failed` e `no_embeddings` distinguem processamento, conclusão, falha e indisponibilidade de embeddings. A geração usa o provedor de embeddings ativo.
- `content` contém o texto que entra na busca. `fileUrl` e `fileName` identificam o original na CDN quando o upload funciona.
- A publicação pelo editor de rascunho prepara os vetores antes de trocar o documento e os trechos em uma transação condicional. Versão concorrente ou falha na preparação preserva o documento publicado.
- Aprovar uma pergunta grava sua pergunta e resposta no mesmo documento. Uma nova aprovação reescreve esse documento ou o recria se foi apagado.

[Schema](../../../prisma/schema.prisma) · [Repositório](../../../src/modules/knowledge-base/repository.ts) · [Fila de perguntas](../perguntas-sem-resposta/_index.md)
