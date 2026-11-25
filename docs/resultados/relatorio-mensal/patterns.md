# Relatório mensal — Padrões

- Crie métricas e evidências dentro de `evaluateMonthlyMetrics`, valide as somas com `validateMonthlyReport` e congele no snapshot. Validação também recusa número do resumo sem lastro nos dados.
- Use a mesma árvore `MonthlyReportDocument` para painel e impressão v2. A lista de registros fica fora da árvore da folha. Relatórios sem `data` mantêm o caminho legado.
- Mantenha o desvio por formato na leitura. Chaves ausentes em snapshots antigos preservam a versão que já foi entregue.
- Use `detectMonthlyPendencies` para introduzir tópico de cobertura. O aceite usa `limitationFingerprint` da lista que o admin viu.
- O conteúdo da IA vem dos agregados validados e das ferramentas de consulta. Registre evidências consultadas no servidor. O caso do mês usa fatos lidos no servidor e texto revisado manualmente.
- Preserve os formulários ocultos das demais etapas na mesma revisão. A validação é feita pelo código, inclusive quando os campos ficam ocultos.
- Mudança de schema precisa de `db push` e `generate` para web e worker. As rotas de PDF usam sessão ou impressão assinada e fallback de impressão com endereço relativo.

[Validador v2](../../../src/modules/reports/monthly-validate.ts) · [Fluxo do PDF](../../../src/modules/reports/monthly-print.ts) · [Operação e implantação](P-79-relatorio-mensal-roi.md#arquivos-e-implantao)
