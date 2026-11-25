# Bitrix24

Envia contatos, leads ou negócios e reuniões do Fechai ao portal Bitrix24 Cloud de cada conta.

| Aspecto | Onde fica |
|---|---|
| Menu | Integrações → CRM (`/integracoes?aba=crm`) |
| Acesso | Produto disponível e conta ativa |
| Modelos | `BitrixIntegration`, `BitrixSyncJob` |
| Lógica | [Módulo Bitrix24](../../../src/modules/bitrix/README.md) e [worker](../../../src/modules/bitrix/worker.ts) |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Queries](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

1. O fluxo é Fechai → Bitrix24. A agenda do Fechai governa horários e situação dos compromissos.
2. A fila separa conta e destino. Uma troca de portal cria `connectionKey` própria.
3. Uma criação sem confirmação só pode ser reconciliada automaticamente. Repetir a criação exige confirmação humana e nova leitura do destino.
