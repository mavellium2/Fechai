# Relatório mensal

Fechamento versionado de atendimento, avaliações agendadas e comparecimento, com documento da clínica e PDF.

| Aspecto | Detalhe |
| --- | --- |
| Cliente | `/relatorios?visao=mensal` |
| Revisão | `/admin/relatorios` e `/admin/relatorios/[tenantId]` |
| Dados | `MonthlyReportData`, `MonthlyRoiReport`, `MonthlyRoiReportVersion` |
| Documento v2 | `monthly-v2/MonthlyReportDocument.tsx` |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Consultas](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

- O motor calcula e valida. A IA redige com os fatos validados. Painel e PDF apresentam a versão aprovada.
- A âncora é a avaliação criada pelo agente no mês, acompanhada de presença verificada. O expediente só divide as contagens.
- O retorno estimado aparece quando ativado e quando há premissas suficientes para calcular receita, economia e ROI.
- A aprovação congela cálculos, evidências e limitações. Snapshot anterior à v2 mantém a apresentação antiga.

[Contrato v2](SDD-relatorio-mensal-v2.md) · [Operação e histórico do P-79](P-79-relatorio-mensal-roi.md)
