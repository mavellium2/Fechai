# Relatórios Operacional e Financeiro — Consultas

| Função | Entrada e saída |
| --- | --- |
| `resolveRange` | Resolve `periodo` (`hoje`, `7`, `30`, `mes`, `ano`, `tudo`) ou o intervalo prioritário `de`/ `ate` em `ReportRange`. “Tudo” tem início aberto. |
| `computePeriodReport` | Recebe `tenantId` e janela. Devolve `PeriodReport`, incluindo comparação anterior com o mesmo classificador. Aceita premissas e escopo de agentes para auditoria. |
| `periodAssumptions` | Para mês civil inteiro, lê a revisão da competência ou herda a última anterior. |
| `computeFinancialSummary` | Recebe `tenantId` e janela. Devolve `FinancialSummary` com retorno, investimento, custo por lead, séries e triagem. |

As métricas filtram a conta e excluem testes. O operacional do painel abrange os agentes da conta. Compare com o mensal usando a mesma janela e seleção de agentes. Um cancelamento registrado apenas no Clinicorp pode aparecer primeiro no mensal.

[Implementação das consultas](../../../src/modules/reports/service.ts) · [Conferência das métricas](../../../src/app/(dashboard)/relatorios/README.md#auditoria-operacional--mensal-01102026)
