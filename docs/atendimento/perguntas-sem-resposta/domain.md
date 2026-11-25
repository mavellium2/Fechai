# Perguntas sem resposta — Domínio

| Modelo | Campos e relações relevantes |
|---|---|
| `KnowledgeGap` | Assunto por conta e agente, com texto normalizado, vetor opcional, `status`, contagem e datas da primeira e última ocorrência, resposta e `documentId`. |
| `KnowledgeGapOccurrence` | Conversa e mensagem que levaram ao assunto. Única por `[gapId, conversationId]`. Guarda estado da retomada. |
| `KnowledgeGapSettings` | Configuração por conta, com `onUnanswered`, avisos, grupo, fuso e `responders`. |

- `report_unanswered` e `handoff_human` com `unanswered: true` registram o desconhecimento. O agente diz que confirmará a resposta com a equipe.
- Assuntos em aberto do mesmo agente são agrupados primeiro por texto normalizado e depois por similaridade conservadora. `keep` mantém o agente atendendo; `handoff` transfere pelo mesmo fluxo da habilidade de transferência.
- Aprovação cria ou reescreve um documento e preserva o primeiro `answeredAt`. A janela de retomada é de 24h na Meta e sete dias no QR. Bloqueios, pedido de parar e resposta humana posterior impedem esse envio.
- A retomada reivindica cada ocorrência antes do envio. Falha vira estado terminal e o envio registrado tem autoria humana, sem pausa do agente.

[Schema](../../../prisma/schema.prisma) · [Detalhes de agrupamento, avisos e métricas](../../../src/modules/knowledge-gaps/README.md)
