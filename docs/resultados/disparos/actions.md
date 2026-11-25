# Disparos — Ações

| Ação | Comportamento |
| --- | --- |
| `prepareBroadcast` e `prepareBroadcastFromList` | Normalizam telefones, mapeiam variáveis, removem duplicados e salvam o rascunho após validar a lista inteira. |
| `uploadBroadcastMedia` | Recebe arquivo para o cabeçalho do modelo com mídia. Links da CDN precisam pertencer à conta. |
| `sendBroadcastTest` | Envia teste explícito a um número conferido. Uma nova tentativa reaproveita o resultado anterior, com exceção de teste pulado que pode ser reavaliado. |
| `startBroadcast` | Reconfere destinatários recentes, consentimento, modelos, conexão, agenda e rascunho antes de habilitar a fila. |
| `pauseBroadcast`, `resumeBroadcast`, `cancelBroadcast` | Pausa preserva pendentes, retomada exige o remetente e os modelos originais e cancelamento encerra pendentes. |
| `confirmBroadcastRetry` | Confirma outro disparo, após revisão e novo consentimento. Reconfere a elegibilidade das falhas da campanha encerrada. |
| `exportBroadcast` | Exporta CSV com estados, datas e dados de confirmação, protegido contra fórmulas de planilha. |
| `createMessageTemplate` | Valida a proposta e encaminha à aprovação da Meta. |

As chamadas repetem a guarda de acesso e usam a conta da sessão. `discardBroadcastDraft` apaga rascunho quando nenhum teste saiu. Com teste enviado, preserva o histórico como cancelado.

[Ações de disparos](../../../src/app/(dashboard)/disparos/actions.ts) · [Ações de modelos](../../../src/app/(dashboard)/disparos/modelos/actions.ts)
