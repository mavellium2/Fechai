# Widget do site

Instala um botão de chat no site do cliente e encaminha as mensagens do visitante ao agente da conta.

| Aspecto | Onde fica |
|---|---|
| Menu | Integrações → Canais (`/integracoes?aba=canais`) |
| Configuração | Campos `widget*` do `Tenant` |
| Script público | `widget/{tenantId}/widget.js` na CDN |
| Mensagens | `POST /api/widget/{tenantId}/message` |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Queries](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

1. O snippet aponta para o mesmo caminho após salvar a aparência. As alterações republicam o script da conta.
2. A rota pública exige conta ativa, widget habilitado e limites por visitante e por IP.
3. O visitante tem identidade web própria (`web:<visitorId>`) para manter a conversa entre visitas.
