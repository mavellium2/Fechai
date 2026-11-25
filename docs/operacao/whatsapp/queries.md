# WhatsApp — Queries

| Leitura | Contrato |
|---|---|
| `listWhatsappChannels(tenantId)` | Lê os canais utilizáveis pela conta. Exclui Evolution bloqueada pelo admin. |
| `pickWhatsappChannel(channels, preferred)` | Escolhe somente o provedor já registrado na conversa. Sem provedor registrado, prefere a Evolution quando as duas conexões estão prontas. |
| `findWhatsappChannel`, `getWhatsappStatus` | Resolvem canal para envio pontual ou resumem o estado da conta. Uma conexão de pé basta para a conta aparecer conectada. |
| `listBlockedNumbers` | Lê os contatos bloqueados da conta. |
| `checkTenantWhatsapp`, `scanWhatsappHealth` | Consultam o estado no provedor correspondente. O monitor pula QR desativado e preserva desconexão voluntária da Meta. |
| `GET /api/whatsapp/historico` | Lê a execução de recuperação com a mesma guarda administrativa usada para iniciar o job. |

A página de integrações pode consultar a linha do QR diretamente para mostrar o aviso administrativo. Para decidir se o canal pode enviar, use os seletores operacionais. [Seleção de canais](../../../src/modules/whatsapp/instances.ts) · [Saúde](../../../src/modules/whatsapp/health.ts)
