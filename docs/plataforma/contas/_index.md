# Cadastro e onboarding

Cria a conta e conduz a primeira configuração do agente do Fechai.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/cadastro` e `/onboarding` |
| Acesso | Cadastro público e onboarding para a pessoa dona da conta que usa o produto. |
| Código | [Provisionamento](../../../src/modules/tenants/provision.ts), [wizard](../../../src/app/onboarding) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- O provisionamento cria conta, usuário dono e configuração inicial numa transação.
- O roteiro de onboarding gera os mesmos dados que podem ser editados depois em Agentes.

## Referências

- [Guia técnico](../../../src/modules/tenants/README.md)
- [Configurações](../configuracoes/_index.md)
- [Início](../../painel/inicio/_index.md)
