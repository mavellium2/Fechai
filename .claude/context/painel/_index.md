# Painel
Casca de tenant/admin e Agentes v5; documentação da interface, sem novo domínio de negócio.

| Camada | Fonte |
|---|---|
| UI | `src/components/shell/`, `src/components/ui/` |
| Agentes | `src/app/(dashboard)/agentes/` |
| Dados | `src/modules/agent-engine/agents.ts` |

- [Domínio](domain.md) · [Ações](actions.md) · [Leituras](queries.md)
- [Padrões](patterns.md) · [Histórico](changelog.md)
- [Mapa completo de Agentes](../../../src/app/(dashboard)/agentes/README.md)

Antes de alterar:
- [ ] Preservar guards, actions e rascunhos.
- [ ] Separar preferências de tenant/admin.
- [ ] Conferir ambos os temas, menu recolhido e mobile.
