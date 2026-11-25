# Widget do site — Ações

| Entrada | Comportamento |
|---|---|
| `updateWidgetConfig` | Valida aparência e arquivo de ícone. Publica o script com a nova configuração e grava os valores após sucesso da CDN. |
| `setWidgetEnabled` | Republica com o novo estado e persiste o estado após o sucesso. |
| `ensureTenantWidgetDeployed` | Na visita a Integrações, publica o script da conta que ainda não tem `widgetDeployedAt`. |
| `POST /api/widget/{tenantId}/message` | Valida requisição, conta e limites. Resolve conversa e executa `runAgentTurn`. |
| `OPTIONS /api/widget/{tenantId}/message` | Responde ao preflight CORS dos sites que instalam o script. |

[Ações de integrações](../../../src/app/(dashboard)/integracoes/actions.ts) · [Rota de mensagens](../../../src/app/api/widget/%5BtenantId%5D/message/route.ts)
