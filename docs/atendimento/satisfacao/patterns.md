# Pesquisa de satisfação — Padrões de código

A busca para o alerta de início usa os campos de nota, teste e revisão. Trecho de `src/modules/satisfaction/queries.ts`.

```ts
return prisma.satisfactionSurvey.count({
  where: { tenantId, isTest: false, rating: { lte: 2, not: null }, reviewedAt: null },
});
```

- Centralize a decisão em `evaluateSurvey`. O worker monta o candidato e fornece o relógio e a configuração.
- Preserve a reivindicação antes do envio em `sendSurvey` e o tratamento do eco de mensagens da Evolution em `echo.ts`.
- Use `SatisfactionSurvey` para captura, distribuição, classificação e revisão. Respeite `classifiedBy: "human"` ao reclassificar em segundo plano.

[Elegibilidade](../../../src/modules/satisfaction/eligibility.ts) · [Envio](../../../src/modules/satisfaction/send.ts) · [Eco](../../../src/modules/satisfaction/echo.ts)
