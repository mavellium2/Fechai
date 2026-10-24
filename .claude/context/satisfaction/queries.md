# satisfaction — Queries

## loadSatisfaction(tenantId, filters, { maskComments? })
- **Retorna:** `SatisfactionOverview` = `{ summary, rows: SurveyRow[], agents, toReview }`.
- **Filtros:** `isTest: false`, `rating` não nulo, `ratedAt` em `[from, to)`, opcional `rating` e `agentId`.
- **Select:** sem nome/telefone; `comment` mascarado (`knowledge-gaps/mask.ts`) quando `maskComments` (admin/personificação).

## countLowRatingsToReview(tenantId) / listLowRatingsToReview(tenantId, limit = 5)
- **Retorna:** contagem / `LowRatingAlert[]` de notas ≤ 2 com `reviewedAt` nulo. Usado no card do `/inicio`.

## loadConversationSurvey(tenantId, conversationId)
- Última pesquisa da conversa para o cartão no thread (`conversas/SurveyThreadCard.tsx`).

## isSurveyOutbound(tenantId, conversationId, keyId, text, now) (`echo.ts`)
- `true` se o `fromMe` da Evolution é eco da pesquisa (id guardado, ou texto igual em `ECHO_WINDOW_MS = 60s` com pesquisa em `sending`). Evita pausar o agente.

## summarizeSurveys(sent, rated) (`summary.ts`, puro)
- **Retorna:** `SurveySummary` (enviadas, respondidas, taxa, média 1 casa, `distribution[5]`, top 3 motivos + sem classificação). Mesma função do painel e do relatório.

## Relatório mensal (`reports/monthly-satisfaction.ts`)
- `loadMonthlySurveys(tenantId, start, end)` — mesma passada de `evaluateMonthlyMetrics`; comentário vira booleano já na consulta.
- `buildSatisfaction(input, evidence)` → `MonthlyReportData.satisfaction?` (opcional, congelado no snapshot). Coorte da nota por `ratedAt`, envio por `sentAt`, escopo de agentes da revisão. `monthly-validate.ts` confere soma, média e top 3.
