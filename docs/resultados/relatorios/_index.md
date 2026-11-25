# Relatórios Operacional e Financeiro

O painel mostra atendimento e agenda no período, além de estimativas de retorno e economia quando a conta configura as premissas.

| Aspecto | Detalhe |
| --- | --- |
| Menu | Relatórios |
| Rotas | `/relatorios`, `/relatorios?visao=financeiro`, `/relatorios/export` |
| Acesso | Sessão de proprietário com conta selecionada |
| Servidor | `src/modules/reports/service.ts` |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Consultas](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

- Atendimento exige entrada e resposta atribuída no período. Resolução autônoma usa apenas atendimentos iniciados pelo paciente.
- Leads novos e contatos atendidos têm bases distintas. O painel explica a diferença com `leadReconciliation`.
- Agendamentos feitos no período usam a data de criação. Comparecimento usa a data da consulta e a presença registrada.
- Valores financeiros são estimados, em centavos e dependem de premissas da conta.

Outras visões têm guias próprios. [Relatório mensal](../relatorio-mensal/_index.md) · [Qualidade dos leads](../qualidade-dos-leads/_index.md) · [Campanhas](../campanhas/_index.md)
