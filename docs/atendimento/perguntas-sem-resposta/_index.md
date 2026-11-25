# Perguntas sem resposta

Fila de pontos que o agente pediu para confirmar com a equipe.

| Aspecto | Detalhe |
|---|---|
| Menu e rotas | Perguntas · `/perguntas`, `/admin/perguntas` |
| Acesso | Produto habilitado na conta, superadmin na rota administrativa |
| Dados | `KnowledgeGap`, `KnowledgeGapOccurrence`, `KnowledgeGapSettings` |
| Operação | [Módulo knowledge-gaps](../../../src/modules/knowledge-gaps/README.md) |

## Arquivos desta pasta

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) · [Telas](telas.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Para mexer neste módulo, saiba que

1. A fila recebe registros explícitos do agente. Conversa de teste fica de fora.
2. Aprovar ensina a base do agente. Retomar o contato é uma escolha explícita.
3. A autorização vem de `responders`; só o superadmin muda quem responde.
4. Mavellium e superadmin em personificação veem dados do contato mascarados.

[Contrato e operação](P-87-perguntas-sem-resposta.md) · [Decisão da fila](../../decisions/ADR-004-fila-perguntas-sem-resposta.md)
