# Relatório mensal — Consultas

| Função | Uso |
| --- | --- |
| `computeMonthlyReport` | Recebe conta e competência. Por padrão usa snapshot pronto quando existe. A revisão em andamento usa premissas, agentes escolhidos e correções. |
| `evaluateMonthlyMetrics` | Produz `metrics`, `evidence` e `data` na mesma passada. |
| `loadApprovedReport` | Lê a versão publicada. A exportação da clínica depende desse snapshot. |
| `publishedMonthlyMonths` | Lista competências prontas para o seletor do painel. |
| `detectMonthlyPendencies` | Calcula a lista de tópicos da central, a base de `missing` e das limitações de fechamento. |
| `loadMonthlyCaseFacts` | Confere elegibilidade da conversa e lê duração de áudio, dia da semana e período, no escopo da revisão. |

O assistente administrativo consulta `report.evidence` para listar casos, conversas, agendamentos e eventos. A consulta de detalhes confere se o id está no conjunto permitido e filtra por conta. O conjunto de evidências apresenta ids, datas e classificações, preservando nome, telefone, e-mail e texto de mensagem.

[Motor e snapshot](../../../src/modules/reports/monthly.ts) · [Consultas do assistente](../../../src/modules/reports/monthly-ai-tools.ts)
