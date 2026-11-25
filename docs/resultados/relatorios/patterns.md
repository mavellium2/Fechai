# Relatórios Operacional e Financeiro — Padrões

- Use `PANEL_TIME_ZONE` e os helpers de `scheduling/time.ts` para recortar dias, meses e horários no fuso do painel, inclusive no CSV.
- Ao incluir uma métrica de atendimento, reutilize `contactActivity` e o classificador de contexto. Identifique envios automáticos pelos IDs da operação em `ReportEvent`, `ReminderDispatch` ou `BroadcastRecipient`.
- Mantenha as fórmulas em `service.ts`. Gráficos recebem os agregados calculados pelo servidor, usam `chartColor` e oferecem rótulos textuais e tabela.
- Guarde dinheiro em centavos e exiba com `formatBRL`. Use “estimado” para números derivados de premissas financeiras.
- Altere as chaves de visão junto com a URL e o seletor. Preserve os parâmetros da janela ao navegar.

O script `scripts/audit-report-metrics.ts` compara agregados operacionais e mensais com o mesmo escopo, em leitura no ambiente com banco configurado.

[Regras de cálculo e extensão](../../../src/app/(dashboard)/relatorios/README.md#regras-de-clculo-definies-exatas)
