# Agentes — Server Actions

As actions de `src/app/(dashboard)/agentes/actions.ts` derivam o tenant da sessão. Operações sobre um agente verificam a posse com `requireAgent`; criação, duplicação e importação verificam a capacidade do plano.

| Função | Efeito e validação |
|---|---|
| `createAgentAction(prev, formData)`, `duplicateAgent(agentId)`, `importAgentAction(prev, formData)` | Criam agente conforme o plano. Importação valida o pacote. |
| `renameAgent(agentId, name)`, `setAgentEnabled(agentId, enabled)`, `setPrimaryAgent(agentId)`, `deleteAgent(agentId)` | Gerenciam identificação, estado e agente principal. A exclusão verifica quantos agentes restam. |
| `savePersona(prev, formData)`, `saveRules(prev, formData)`, `saveAgentVariables(agentId, definitions)` | Validam e gravam persona, regras e definições de variáveis. |
| `setActionEnabled(agentId, key, enabled)` | Verifica catálogo e teto das ações por agente ao ligar uma habilidade. |
| `saveScheduleConfigAction`, `saveFollowUpConfigAction`, `saveHandoffConfigAction` | Recebem `prev` e `FormData`, validam a configuração e persistem na ação correspondente. |
| `setAgentBehavior`, `setAgentVoiceStyle`, `saveVoicePrompt`, `saveSpeechBlocklist` | Atualizam comportamento e regras de fala. |
| `saveAgentVoice`, `setAgentCatalogVoice`, `previewCatalogVoice`, `deleteAgentVoice` | Gerenciam voz gravada, voz de catálogo e prévia. |

`GET /api/agents/[id]/export` exporta o pacote do agente. O endpoint `/api/sandbox` é a entrada do teste. As operações de documentos estão em [Base de conhecimento](../base-de-conhecimento/actions.md).

[Actions](../../../src/app/(dashboard)/agentes/actions.ts) · [Pacotes de agente](../../../src/modules/agent-engine/agent-package.ts) · [Sandbox](../../../src/app/api/sandbox/route.ts)

- `saveHandoffConfigAction` valida o formulário com `handoffConfigSchema` (`agent-engine/handoff-form.ts`, o mesmo usado nos testes) e grava `TenantAction.config`, inclusive `whileWaiting`. Sem o campo, a IA continua respondendo.
