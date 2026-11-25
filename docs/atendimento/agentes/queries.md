# Agentes — Queries

| Leitura | Retorno, escopo e ordenação |
|---|---|
| `listAgents(tenantId)` | Agentes não arquivados da conta, principal primeiro e criação mais antiga em seguida. Inclui contagens e chaves de habilidades ligadas. |
| `getAgentUsage(tenantId)` | Total de agentes não arquivados, limite do plano, saldo e condição para criar. |
| `getAgentOwned(tenantId, agentId)` | Agente pelo par conta e id. A página de edição responde 404 se a busca não encontra agente. |
| `getAgentsNavigation(tenantId)` | Em `AgentsFrame.tsx`, reúne diretório e capacidade para o mesmo ciclo de renderização. |
| Página `/agentes/[id]` | Depois da verificação de posse, lê metadados dos documentos, habilidades, configuração de agenda, follow-up, transferência e disponibilidade das integrações. |

[Consultas de agentes](../../../src/modules/agent-engine/agents.ts) · [Frame de Agentes](../../../src/app/(dashboard)/agentes/AgentsFrame.tsx)
