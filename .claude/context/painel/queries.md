# Painel — leituras
- listAgents(tenantId): não arquivados, principal primeiro, contagens/ações; dados completos ficam no servidor.
- getAgentOwned: id + tenant; getAgentUsage: plano e contagem.
- getAgentsNavigation: React.cache na renderização da página; não mover a lista para layout persistente.
- AgentsFrame agora é contêiner/guard; Directory projeta nome, status e descrição.
- Conversas: tenant + isTest + situação/agente/busca, take 30–300; selecionada sempre id/tenant. Próxima consulta scheduled/futura por lead/tenant.
- searchSimilarChunks: tenant/agente, título e id da origem; exclui documento substituído pelo rascunho, que recebe vetores temporários no teste. Inspeção vem da mesma recuperação usada no prompt.
