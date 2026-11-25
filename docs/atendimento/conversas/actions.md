# Conversas — Server Actions

`src/app/(dashboard)/conversas/actions.ts` deriva o tenant da sessão com `requireTenant`. Mutação e envio trabalham na conversa da conta.

| Função | Efeito |
|---|---|
| `resolveConversation(id)` | Retira `needsHuman` e fecha a espera de transbordo aberta como assumida pelo painel (`closeHandoffNotices`). Havendo espera aberta, avisa o grupo: "✅ Fulana resolveu pelo Fechai". |
| `reopenConversation(id)` | Sinaliza `needsHuman` e limpa a pausa. |
| `setConversationAgentPaused(id, paused)` | `true`: assume (`assumeConversation`), com a pessoa como responsável, com ou sem CRM; conversa de teste só pausa. `false`: devolve para a IA (`returnToAiAndReply`), tirando a responsável. |
| `transferConversation(id, toUserId, expectedUserId)` | Passa o atendimento a outra pessoa da equipe (`transferCrmConversation`), só se a responsável ainda é a que a tela mostrava. |
| `sendManualMessage(conversationId, text)` | Envia texto pelo núcleo `sendManualReply`, que distingue atendimento real de teste. |
| `sendManualAudioMessage(conversationId, text)` | Sintetiza o texto com a voz do agente. Falha mantém o texto disponível para nova escolha de envio. |
| `sendRecordedAudioMessage` | Processa áudio gravado pela equipe no composer. |
| `generateConversationSummary(conversationId)` | Resume o histórico sob demanda e devolve data e contagem de mensagens. |
| `sendTestClientMessage`, `deleteTestConversation` | Simulam uma fala do contato ou excluem uma conversa. O alvo deve ser de teste. |

[Actions](../../../src/app/(dashboard)/conversas/actions.ts) · [Núcleo de conversa](../../../src/modules/agent-engine/conversation.ts)

Responder pelo painel faz quem respondeu assumir, se ninguém estava com a conversa, e fecha a espera como assumida por essa pessoa. Reativar o agente devolve para a IA; se a resposta pendente falhar, a conversa volta a pedir a equipe com uma espera nova. Cada passo que encerra ou muda o atendimento em curso responde no grupo citando o aviso (CRM-07, ver [CRM › ações](../../painel/crm/actions.md#transferir-e-devolver-para-a-ia)). Ver [transbordo](../../../src/modules/agent-engine/README.md#transferir-para-humano-e-o-grupo-do-whatsapp-handoffts).
