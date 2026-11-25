# Conversas

Caixa de entrada para ler o atendimento, assumir uma conversa e consultar os dados do contato.

| Aspecto | Detalhe |
|---|---|
| Menu e rota | Conversas · `/conversas` |
| Acesso | Produto habilitado no painel, operações na conta da sessão |
| Dados | `Conversation`, `Message`, `Lead` |
| Entrada | [Página](../../../src/app/(dashboard)/conversas/page.tsx) |

## Arquivos desta pasta

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) · [Telas](telas.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Para mexer neste módulo, saiba que

1. Conversas de teste têm aba própria e ficam fora da lista real.
2. Envio manual registra autoria humana e pausa o agente naquela conversa.
3. A resposta sai pelo número em que o contato escreveu.
4. Resolver retira a prioridade. Reabrir devolve a prioridade e libera o agente.

[Mapa da interface](../../../src/app/(dashboard)/conversas/README.md) · [Agentes e sandbox](../agentes/_index.md)
