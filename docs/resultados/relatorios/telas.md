# Relatórios Operacional e Financeiro — Telas

| Tela | Código | Comportamento |
| --- | --- | --- |
| `/relatorios` | `page.tsx`, `RangePicker.tsx` | Abre no Operacional, com 30 dias como padrão. O seletor mantém a visão nos links e no intervalo personalizado. |
| Operacional | `ContactContextSummary`, `LeadReconciliationCard`, `ChartPanel` | KPIs, contexto de entrada, reconciliação de leads, funil, horários de pico, tempo de resposta e gráficos de atendimento e resultados. |
| Financeiro | `FinancialView`, `TriagePanel`, `FinancialCharts` | Retorno estimado, valor por lead e custo do atendimento em formulários próprios. Os gráficos de retorno dependem do valor por lead. |
| Exportação | `export/route.ts` | CSV operacional com os parâmetros de período, BOM e separador ponto e vírgula para Excel. |

`ChartActions` oferece **Ampliar** e **Como é calculado**. A visualização ampliada inclui tabela. A conta exclusivamente afiliada abre a visão de afiliados, onde os ganhos são independentes dos dados de atendimento.

[Mapa dos componentes](../../../src/app/(dashboard)/relatorios/README.md#arquivos-mapa)
