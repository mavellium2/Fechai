# Bitrix24 — Queries

| Leitura | Contrato |
|---|---|
| `getBitrixStatus(tenantId)` | Retorna estado e opções seguras, contagens e avisos do destino atual. A URL do webhook permanece no servidor. |
| `verifyBitrix(webhook, appointments)` | Consulta modo de CRM e verifica acesso a leituras relevantes. Permissão de escrita é verificada no envio real. |
| `workerClient(tenantId, connectionKey, kind, canceled)` | Valida conta ativa, revisão e destino antes de autorizar a próxima chamada. Uso interno do servidor. |
| Resolução de entidades | Procura por referência do Fechai e por telefone. Correspondências ambíguas bloqueiam a criação. |

O Bitrix24 recebe espelhos. A agenda continua consultando disponibilidade na base do Fechai, no Clinicorp e no iCloud quando configurados. [Integração](../../../src/modules/bitrix/integration.ts) · [Cliente Bitrix24](../../../src/modules/bitrix/client.ts)
