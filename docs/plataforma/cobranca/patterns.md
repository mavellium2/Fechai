# Planos e cobrança — Padrões

- Leia `getUsageSummary` para decisões de cota no agente e para exibir consumo. `runAgentTurn` usa o mesmo contrato.
- Centralize preços em centavos e limites em `plans.ts`. Preserve a separação entre plano, preço negociado e cota administrativa.
