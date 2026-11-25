# Widget do site — Domínio

| Conceito | Contrato |
|---|---|
| `Tenant.widgetEnabled` | Ativa o botão e o processamento de mensagens públicas. A conta recebe o widget desabilitado por padrão. |
| Campos de aparência | Cor, saudação, ícone por emoji ou imagem, formato e cor opcional da borda. |
| `Tenant.widgetDeployedAt` | Marca a última publicação bem-sucedida do script. |
| `WidgetConfig` | Contrato entre a configuração da conta e o gerador do script público. |
| Visitante | `visitorId` no navegador. O servidor usa `web:<visitorId>` para localizar ou criar lead e conversa dentro da conta. |

Limites da rota de mensagens são mantidos no Redis por conta e visitante ou IP. O turno usa o motor do agente, com resposta de indisponibilidade quando o atendimento automático está pausado ou atingiu o limite. [Schema](../../../prisma/schema.prisma) · [Rota de mensagens](../../../src/app/api/widget/%5BtenantId%5D/message/route.ts)
