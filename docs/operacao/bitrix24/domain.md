# Bitrix24 — Domínio

| Modelo | Contrato |
|---|---|
| `BitrixIntegration` | Uma conexão por tenant, com webhook cifrado, portal, `connectionKey`, revisão, opções, responsável e cursores. Pausar preserva credenciais e referências. Desconectar remove a credencial. |
| `BitrixSyncJob` | Uma linha por conta, destino, tipo e entidade, com versão do payload, estado, tentativas, claim e IDs externos. |
| `Lead.updatedAt` | Com o ID, sustenta a captura incremental de mudanças no contato. |

O worker reutiliza contato existente encontrado por telefone sem sobrescrever seus campos. O modo clássico cria lead e o simples cria negócio. Reuniões espelham compromissos com contato real, atualizam o mesmo ID ao remarcar e ficam identificadas como canceladas ao encerrar. Testes, texto de conversa e áudio ficam fora das exportações.

[Modelos Prisma](../../../prisma/schema.prisma) · [Contratos de CRM e calendário](../../../src/modules/bitrix/README.md#crm-e-calendário)
