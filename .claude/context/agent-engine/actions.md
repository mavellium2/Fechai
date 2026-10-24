# Agent-engine — Escrita

## Módulo
- `runAgentTurn(input)`: turno completo; grava msg do contato e resposta. Entradas extras: áudio (`incomingAudioUrl/Seconds/WasAudio/MessageKeyId`), `agentId?`, `skipUsageCheck`, `skipEnabledCheck` e `dryRunScheduling` (só sandbox; agenda simulada, ver README).
- `appendMessage(conversationId, role, content, ...)`: grava `Message`.
- `sendManualReply(tenantId, conversationId, text, audio?)`: humano responde; `sentBy: "human"`, grava `needsHuman: false, agentPaused: true`.
- `summarizeConversation(tenantId, conversationId)`: resumo + variáveis; mínimo `MIN_MESSAGES_TO_SUMMARIZE = 4`.
- `rememberConversationVariables(...)`: grava `Conversation.variables`.
- `saveHandoffConfig(tenantId, agentId, config)`; `notifyHandoffGroup(...)` nunca lança.
- `createAgent`, `buildAgentPackage`, `createAgentFromPackage`: criar/exportar/importar agente.
- `runToolHandler(name, ctx, args)`: executa tool; retorna texto para o LLM.

## Server Actions (UI)
`agentes/actions.ts`: `savePersona`, `saveRules`, `setActionEnabled`, `saveScheduleConfigAction`, `saveFollowUpConfigAction`, `saveHandoffConfigAction`, `setAgentEnabled`, `setAgentBehavior`, voz (`saveAgentVoice`, `setAgentCatalogVoice`, `deleteAgentVoice`...), base (`addDocument`, `removeDocument`, `updateDocumentAction`), `createAgentAction`, `duplicateAgent`, `importAgentAction`, `deleteAgent`.

`conversas/actions.ts`: `sendManualMessage`, `sendManualAudioMessage`, `sendRecordedAudioMessage`, `setConversationAgentPaused`, `resolveConversation`, `reopenConversation`, `generateConversationSummary`, `sendTestClientMessage`, `deleteTestConversation`.

## Regras
- Ligar voz exige `speakReplies` + `voiceId`.
- Resposta manual pausa a IA (`agentPaused`).
