# WhatsApp — Ações

| Entrada | Efeito |
|---|---|
| `connectWhatsapp`, `refreshWhatsappStatus` | Criam ou atualizam o QR após validar a liberação da Evolution. |
| `saveMetaWhatsapp`, `reconnectMetaWhatsapp` | Validam e atualizam a conexão Meta. O Cadastro Incorporado usa `/api/integrations/meta/signup`. |
| `disconnectWhatsapp` | Desconecta o provedor solicitado e fecha o incidente aberto dele. |
| `setWhatsappAgentEnabled`, `setWhatsappIgnoreGroups`, `setWhatsappAgentReplies` | Controlam pausa da conta, grupos e respostas automáticas por provedor. |
| `blockWhatsappNumber`, `unblockWhatsappNumber` | Alteram os bloqueios da conta autenticada. |
| `setTenantEvolutionWhatsappEnabled` | Altera a liberação administrativa sem descartar a sessão do aparelho. |
| `recoverWhatsappHistory` | Inicia uma varredura persistente dos últimos 30 dias retidos pela Evolution, com autorização do superadmin e escopo da conta personificada. |

O webhook Evolution entra em `/api/webhooks/whatsapp`. A Meta usa `/api/webhooks/whatsapp/meta`, com callback por conta ainda disponível. [Ações de integrações](../../../src/app/(dashboard)/integracoes/actions.ts) · [Ações administrativas](../../../src/app/(admin)/actions.ts) · [Webhook Meta](../../../src/modules/whatsapp/meta-webhook-handler.ts)
