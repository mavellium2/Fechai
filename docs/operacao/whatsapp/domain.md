# WhatsApp — Domínio

| Entidade | Contrato |
|---|---|
| `WhatsappInstance` | Uma linha por `tenantId` e `provider` (`evolution` ou `meta`). Cada conexão tem estado próprio e `agentReplies`. |
| `Conversation.whatsappProvider` | Provedor registrado pelo contato mais recente ou pela intervenção da equipe no aparelho. Saídas automáticas preservam um canal já definido. |
| `Tenant.evolutionWhatsappEnabled`, `Tenant.metaWhatsappEnabled` | Liberação administrativa independente. A Evolution nasce habilitada. Bloquear o QR preserva linha e sessão, mas tira o canal das leituras operacionais. |
| `WhatsappBlockedNumber` | Lista da conta. A comparação passa pela normalização dos números. |
| `WhatsappIncident` | Queda e volta confirmadas por provedor para apuração de disponibilidade. Desconexão voluntária encerra queda em aberto. |
| `TeamMemberWhatsapp` | WhatsApp pessoal de quem é da equipe, confirmado por `#vincular CÓDIGO` vindo do próprio número. O comando é lido antes de "ignorar grupos" e nunca abre conversa. [CRM](../../painel/crm/domain.md#whatsapp-da-equipe) |
| `WhatsappHistoryRecovery`, `WhatsappHistoryRecoveryItem` | Cursor, janela e conferência dos registros processados em recuperação administrativa do histórico da Evolution. |

Na Meta só para Disparos, textos, mídia, reações e ecos ficam fora do atendimento. O webhook ainda processa recibos e o pedido explícito para parar, preservando o canal gravado na conversa. [Duas conexões](../../../src/modules/whatsapp/README.md#duas-conexões-ao-mesmo-tempo) · [Schema](../../../prisma/schema.prisma)
