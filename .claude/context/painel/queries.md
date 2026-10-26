# Painel — leituras
Fonte: `src/modules/agent-engine/agents.ts`.

- `listAgents(tenantId)`: archived=false, principal primeiro e createdAt asc; inclui contagens e ações ligadas. Registro completo fica no servidor.
- `getAgentOwned(tenantId,id)`: findFirst com tenantId/id, ou null.
- `getAgentUsage(tenantId)`: plano + contagem não arquivada → AgentUsage.
- `getAgentsNavigation(tenantId)` em AgentsFrame: React.cache de listAgents/getAgentUsage na mesma renderização.
- `AgentsFrame`: requireTenant e projeção para sidebar: id, nome, ligado, principal, pronto e conhecimento; sem prompt.
- Ler com a página, não no layout persistente, para atualizar a lista após criar/importar/renomear.
