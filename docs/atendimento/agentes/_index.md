# Agentes

Configure os agentes que atendem no WhatsApp e teste as respostas antes de publicar.

| Aspecto | Detalhe |
|---|---|
| Menu e rotas | Agentes · `/agentes`, `/agentes/[id]` |
| Acesso | Produto habilitado no painel, operações na conta da sessão |
| Dados | `Agent`, `TenantAction` |
| Entrada no motor | [orchestrator.ts](../../../src/modules/agent-engine/orchestrator.ts) |

## Arquivos desta pasta

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) · [Telas](telas.md) · [Padrões](patterns.md) · [Histórico](changelog.md) · [Follow-up](follow-up.md)

## Para mexer neste módulo, saiba que

1. O agente principal é o que atende novas conversas no WhatsApp. Agente ligado e agente principal são estados distintos.
2. Habilidades ocupam vagas por agente e usam `TenantAction.config`. O catálogo define as chaves.
3. A transferência marca a conversa para a equipe, registra a espera e avisa o grupo interno quando configurada. A clínica escolhe se a IA continua respondendo ou pausa enquanto aguarda.
4. O sandbox roda sem cota de atendimento, funciona com o agente desligado e simula os efeitos de agenda.

[Motor e contratos completos](../../../src/modules/agent-engine/README.md) · [Base de conhecimento](../base-de-conhecimento/_index.md)

[Estudo histórico sobre respostas por áudio](viabilidade-agente-responde-com-audio.md) · [Implementação de voz](../../../src/modules/voice/README.md)
