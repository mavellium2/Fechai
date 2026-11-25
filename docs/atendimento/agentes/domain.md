# Agentes — Domínio

| Modelo | Campos e relações relevantes |
|---|---|
| `Agent` | `tenantId`, `isPrimary`, `enabled`, `archived`, `personaDraft`, `systemPrompt`, `variableDefinitions` e opções de voz. Reúne documentos, ações e conversas do agente. |
| `TenantAction` | `tenantId`, `agentId`, `key`, `enabled`, `config` (JSON). Uma linha por `[agentId, key]`. |

## Regras

- `runAgentTurn` monta persona, histórico e trechos recuperados da base, executa até três rodadas de ferramentas e passa a saída pelo sanitizador.
- `ACTION_CATALOG` em `actions.ts` define as habilidades. Cada configuração tem leitor tolerante a dados antigos. Agendamento, follow-up e transferência são exemplos.
- A configuração de transferência pertence a `handoff_human`. `transferToHuman` marca `needsHuman` e, com "Enquanto aguarda humano, a IA: pausa" (`whileWaiting: "pause"`), liga `agentPaused` na mesma escrita. Todo transbordo registra a espera em `HandoffNotice`, mesmo sem grupo. A opção de avisar envia ao grupo interno nome, número, origem, resumo, motivo, o link do card no CRM e a linha de comandos, uma vez por espera, com o QR da conta. No grupo, "assumo" ou 👍 citando o aviso faz a pessoa responsável e "#ia" devolve para a IA (CRM-08, `crm/handoff-group.ts`). [Transbordo](../../../src/modules/agent-engine/README.md#transferir-para-humano-e-o-grupo-do-whatsapp-handoffts)
- Valores de variáveis vêm da conversa. O sistema preenche só `numero` a partir da identidade no WhatsApp. O resumo pode completar campos sem valor usando o histórico, preservando o que já foi registrado.
- `report_unanswered` aplica a regra de consultar a equipe e alimenta [Perguntas sem resposta](../perguntas-sem-resposta/_index.md). É ferramenta interna, sem vaga no plano.

[Schema](../../../prisma/schema.prisma) · [Regras do motor](../../../src/modules/agent-engine/README.md)
