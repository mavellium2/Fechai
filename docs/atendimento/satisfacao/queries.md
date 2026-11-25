# Pesquisa de satisfação — Queries

| Função | Retorno e escopo |
|---|---|
| `getSurveySettings(tenantId)` | Configuração efetiva com defaults. |
| `loadSatisfaction(tenantId, filters, { maskComments? })` | Enviadas por `sentAt` e notas por `ratedAt`, filtradas por período e agente. Limita resumo a 5.000 notas e a lista a 100 avaliações, mais recentes primeiro. O filtro da nota atua na lista. |
| `countLowRatingsToReview(tenantId)`, `listLowRatingsToReview(tenantId, limit?)` | Notas 1 e 2 sem `reviewedAt`, com lista recente e limite padrão 5. |
| Linha do tempo de Conversas | Projeta o cartão da pesquisa mais recente entre os estados exibíveis. |

Agregados, tabela de Relatórios e alertas excluem `isTest`. Comentários da visão de personificação são mascarados. O snapshot mensal recebe apenas agregados.

[Queries e filtros](../../../src/modules/satisfaction/queries.ts) · [Linha do tempo](../../../src/app/(dashboard)/conversas/page.tsx)
