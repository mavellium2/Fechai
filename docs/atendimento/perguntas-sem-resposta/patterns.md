# Perguntas sem resposta — Padrões de código

A página administrativa usa a opção explícita de máscara. Trecho de `src/app/(admin)/admin/perguntas/page.tsx`.

```ts
const [gaps, counts] = selected && canAnswer
  ? await Promise.all([listGaps(selected.id, status, { masked: true }), countGaps(selected.id)])
  : [[], null];
```

- Registre o assunto por `registerKnowledgeGap` no fluxo das ferramentas explícitas. A função absorve erros para preservar o turno.
- Use `approveGapAnswer` para preservar o primeiro `answeredAt` e o documento associado.
- Use `resumeAnsweredGap` para respeitar claims, janelas e impedimentos. Aviso da fila é rotina do worker.

[Módulo](../../../src/modules/knowledge-gaps/README.md) · [Worker](../../../workers/follow-up-worker/README.md#perguntas-sem-resposta-knowledge-gaps)
