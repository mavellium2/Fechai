# Qualidade dos leads — Padrões

- Parta da população de contatos atendidos. Leads criados no período têm uma base própria em [Relatórios Operacional e Financeiro](../relatorios/_index.md) e [Campanhas](../campanhas/_index.md).
- Para equipe e relatório, devolva apenas os metadados previstos. Nome, telefone e trechos da conversa ficam no servidor. A leitura histórica exige declaração literal reconhecida.
- Reuse `leadOutcome` e `classifyCity` no agregado e nos registros individuais. Para o mensal, calcule antes de congelar o snapshot.
- `trafficSuggestions` é uma regra determinística. Exige pelo menos 10 contatos com cidade declarada e aplica limites por hipótese. A sugestão é apresentada como hipótese, com a ressalva de origem quando aplicável.
- O bloco mensal de qualidade dos leads aparece na análise detalhada quando a competência tem leads. Sem dados no snapshot, o bloco fica oculto.

[Resumo e regras de sugestões](../../../src/modules/lead-insights/summary.ts) · [Cenários do relatório](../../../tests/lead-insights-relatorio.test.ts)
