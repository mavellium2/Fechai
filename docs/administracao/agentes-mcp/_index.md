# Agentes no admin e MCP

Oferece manutenção de agentes entre contas, acesso controlado pelo MCP e propostas de alteração para aprovação humana.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/admin/agentes`, `/admin/agentes/mcp`, `/admin/agentes/propostas/[id]` e `/api/mcp` |
| Acesso | Superadmin no painel. A API usa token com escopo de conta, agente e operação. |
| Código | [Módulo agent-mcp](../../../src/modules/agent-mcp), [rota da API](../../../src/app/api/mcp/route.ts) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- Use apenas o escopo concedido pelo token. As propostas são aplicadas pelo superadmin na interface de revisão.
- A simulação pelo MCP segue o fluxo de teste do agente.

## Referências

- [Guia técnico do MCP](../../../src/modules/agent-mcp/README.md)
- [Agentes no painel do cliente](../../atendimento/agentes/_index.md)
