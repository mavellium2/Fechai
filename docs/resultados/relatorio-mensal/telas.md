# Relatório mensal — Telas

| Tela | Comportamento |
| --- | --- |
| `/admin/relatorios` | Lista administrativa por conta e competência. |
| `/admin/relatorios/[tenantId]` | `MonthlyCloseWizard` guia importação e conferência, pendências, validação, análise com IA, aprovação e entrega. |
| `/relatorios?visao=mensal` | O seletor lista competências publicadas. `MonthlyReportDocument` apresenta a v2 e `MonthlyReportEvidence` abre registros do snapshot abaixo da folha. |
| `/relatorios/mensal/pdf` | Entrega o documento da versão aprovada. A prévia administrativa tem rota própria e é identificada como rascunho. |
| `/imprimir/relatorio-mensal` | Usa token assinado de curta duração e a mesma árvore da folha da v2 para o Chromium. |

As cinco etapas do editor compartilham um formulário. A central de pendências tem formulários próprios. A etapa ativa fica no assistente, pois o editor é remontado com a nova revisão depois de salvar.

[Assistente de fechamento](../../../src/app/(dashboard)/relatorios/README.md#assistente-de-fechamento-admin-5-etapas)
