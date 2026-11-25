# Conversas — Queries

Leituras em `src/app/(dashboard)/conversas/page.tsx` são escopadas por tenant.

| Leitura | Filtros e retorno |
|---|---|
| Lista | `status`, `q` (nome ou número) e `agent`. Registro atualizado mais recente primeiro. Lote de 30, com `take` limitado a 300 e uma linha extra para detectar continuação. |
| Contadores | Total real, total com `needsHuman` e total de testes são globais na conta. A contagem do resultado segue o filtro atual. |
| Conversa selecionada | `id` + tenant. Inclui lead, agente, mensagens em ordem cronológica e pesquisa de satisfação mais recente entre os estados exibíveis. |
| Painel do contato | Lê as campanhas da conta, as variáveis e o próximo `Appointment` futuro com `status: "scheduled"` no Fechai. |
| Disponibilidade de voz | Requer Fish Audio configurada e voz no agente atribuído. Quando a conversa não tem agente, consulta a voz do principal. |

[Consulta da página](../../../src/app/(dashboard)/conversas/page.tsx)
