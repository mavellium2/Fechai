# Disparos — Consultas

| Função | Uso |
| --- | --- |
| `listBroadcastPage` | Filtra e pagina campanhas por conta, situação, busca e janela. |
| `getBroadcastSummary`, `getBroadcastCampaign` | Devolvem números e detalhe, com estados de execução e entrega, conversa da conta quando houver e candidatos a reenvio elegíveis. |
| `getBroadcastReview` | Devolve o rascunho com a preparação para confirmar ou enviar teste. |
| `loadBroadcastTemplates` | Carrega templates aprovados e compatíveis, inclusive modelos com cabeçalho de mídia. |
| `loadBroadcastCampaignReport` | Agrega disparos confirmados na janela. Usa `broadcastFunnel` e exclui destinatários de teste. |

`recordBroadcastResponse` atribui a resposta ao último envio aceito antes do horário original da mensagem, na mesma conta e número, dentro de sete dias. Se o último envio foi um teste, a resposta fica fora da atribuição. Agendamento conta com nova resposta, dentro da janela de atribuição, uma vez por destinatário. Comparecimento depende de presença marcada.

[Consultas e filtros](../../../src/modules/broadcasts/queries.ts) · [Atribuição de resultados](../../../src/modules/broadcasts/outcomes.ts)
