# WhatsApp

Recebe e envia mensagens pelo QR da Evolution e pela API oficial da Meta, com conexão e comportamento configuráveis por conta.

| Aspecto | Onde fica |
|---|---|
| Menu | Integrações → Canais (`/integracoes?aba=canais`) |
| Liberação por conta | `/admin/contas` |
| Modelos | `WhatsappInstance`, `Conversation.whatsappProvider`, `WhatsappBlockedNumber`, `WhatsappIncident` |
| Lógica | [Módulo WhatsApp](../../../src/modules/whatsapp/README.md) |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Queries](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

1. Há uma instância por conta e provedor. A conversa guarda o canal que recebeu o contato. Se ele ficar indisponível, o envio espera.
2. Para atender nos dois provedores, use dois números. Para o mesmo número, deixe a Meta só para Disparos e atenda pelo QR.
3. Grupos operam pelo QR. Disparos usam a Meta. Pausa, ignorar grupos e bloqueados são controles da conta.

[Guia de conexão e coexistência da Meta](META_COEXISTENCIA.md)
