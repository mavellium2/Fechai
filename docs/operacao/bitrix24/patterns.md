# Bitrix24 — Padrões de código

- Leia conexões e envie pelo cliente do módulo. Armazene o webhook cifrado e valide configuração e destino a cada chamada. Aceite a URL HTTPS original do Bitrix24 Cloud, conforme a validação existente.
- `BitrixSyncJob` preserva IDs externos. Marque `uncertain` antes de criar e salve o ID confirmado assim que a resposta chegar. Em timeout ou resposta ambígua, procure a referência em vez de repetir a criação.
- A fila usa cursores por data e ID, claim condicional, sobreposição na leitura incremental e recuo para limites do portal. Mantenha o escopo de tenant e destino ao capturar e processar.
- Atualize a reunião existente em remarcações. Encerre a atividade com o registro de cancelamento preservado. Mantenha a agenda local durante falhas do Bitrix24.
- Para mudança de schema, aplique `db push` e `generate` no web e no worker. Os testes `bitrix-*.test.ts` e o smoke com REST simulado exercitam os contratos locais.

[Motor de espelhamento](../../../src/modules/bitrix/mirror.ts) · [Fila e falhas](../../../src/modules/bitrix/README.md#fila-concorrência-e-falhas) · [Smoke local](../../../scripts/smoke-bitrix.ts)
