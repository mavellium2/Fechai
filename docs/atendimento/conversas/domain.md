# Conversas — Domínio

| Modelo | Campos e relações relevantes |
|---|---|
| `Conversation` | Pertence a tenant e lead; `agentId` pode faltar em registros antigos. `isTest` separa a simulação. `needsHuman` controla a fila e `agentPaused` controla a atuação automática. `whatsappProvider` indica o canal do contato. |
| `Message` | Linha do histórico com `conversationId`, `role`, `sentBy`, `content`, `whatsappMessageId` e metadados opcionais de áudio. |
| `Lead` | Contato da conta, com nome, número, situação e vínculo às conversas. |

- A entrada real e a recuperação de histórico usam o mesmo lock por conta e telefone para evitar duplicação. O histórico preserva a data e a autoria, sem mover `lastInboundAt` ou disparar um turno.
- Resumo sob demanda usa `summaryAt` e `summaryMsgCount` para reaproveitar o resultado enquanto o conjunto de mensagens é o mesmo. Também pode preencher variáveis ausentes.
- Pesquisa de satisfação fica em `SatisfactionSurvey` e aparece como cartão da linha do tempo. [Pesquisa de satisfação](../satisfacao/_index.md)

[Schema](../../../prisma/schema.prisma) · [Contratos de conversa](../../../src/modules/agent-engine/README.md)
