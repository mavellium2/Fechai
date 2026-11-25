# Widget do site — Queries

| Leitura | Uso |
|---|---|
| Integrações | A página consulta a habilitação e a aparência da conta da sessão para mostrar o card. |
| `WIDGET_CONFIG_SELECT` | Define os campos de configuração usados ao gerar uma publicação. `widgetDeployedAt` decide se a publicação automática é necessária. |
| Mensagens | A rota confere `Tenant.status` e `widgetEnabled` antes de abrir a conversa. |

O script tem a aparência embutida. O navegador usa o script já publicado e consulta a API para enviar uma mensagem. [Página de integrações](../../../src/app/(dashboard)/integracoes/page.tsx) · [Publicação](../../../src/lib/widget/deploy.ts)
