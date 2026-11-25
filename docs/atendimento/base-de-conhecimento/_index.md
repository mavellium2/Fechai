# Base de conhecimento

Documentos por agente que fornecem os trechos usados para responder.

| Aspecto | Detalhe |
|---|---|
| Menu e rota | Agentes › Conhecimento · `/agentes/[id]` |
| Acesso | Agente da conta da sessão |
| Dados | `KnowledgeDocument`, `KnowledgeChunk` |
| Repositório | [knowledge-base/repository.ts](../../../src/modules/knowledge-base/repository.ts) |

## Arquivos desta pasta

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) · [Telas](telas.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Para mexer neste módulo, saiba que

1. A busca exige conta e agente e considera só trechos com embeddings.
2. O editor abre o texto sob demanda. A lista carrega os metadados.
3. O rascunho vive no navegador e altera só o contexto do teste correspondente até a publicação.
4. A aprovação em Perguntas sem resposta cria ou atualiza um documento da base.

[Guia do repositório](../../../src/modules/knowledge-base/README.md) · [Agentes](../agentes/_index.md)
