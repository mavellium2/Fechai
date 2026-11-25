# Disparos

Envia mensagens em lote pelo WhatsApp oficial da Meta, com revisão, agenda, recibos e resultados.

| Aspecto | Detalhe |
| --- | --- |
| Rotas | `/disparos`, `/disparos/novo`, `/disparos/[id]`, `/disparos/modelos` |
| Acesso | Produto, conta ativa e `metaWhatsappEnabled`. Envio exige Meta conectada. |
| Modelos | `BroadcastCampaign`, `BroadcastRecipient`, `BroadcastReceipt`, `WorkerHeartbeat` |
| Servidor | `src/modules/broadcasts/`, worker de follow-up |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Consultas](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

- Importar cria rascunho. A confirmação registra consentimento e libera a fila.
- O worker reconfere remetente, modelos aprovados e elegibilidade antes do envio. Desconexão pausa pendentes até retomada.
- Execução e entrega têm estados próprios. Resultado incerto exige conferência. Reenvio de falhas elegíveis cria outro disparo.

[Operação e passo a passo](../../../src/modules/broadcasts/README.md) · [Decisão técnica](../../decisions/ADR-003-disparos-meta.md)
