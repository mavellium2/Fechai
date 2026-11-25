# Widget do site — Padrões de código

- Gere o script com `deployTenantWidget`. O caminho da CDN é estável e as opções entram no template como dados serializados. A origem pública da API vem de `NEXTAUTH_URL`.
- A publicação precisa funcionar para persistir as mudanças do painel. O endpoint valida a ativação na conta mesmo que o navegador ainda tenha uma cópia anterior do script.
- Preserve os limites atuais de mensagens da rota pública, 20 por minuto para cada visitante e 120 por hora para cada IP, ambos por conta. O escopo da conversa vem do tenant da rota e do identificador web.
- Use o motor de atendimento para registrar a conversa e produzir a resposta. O identificador web é sintético e fica separado dos contatos resolvidos por telefone.

[Publicação](../../../src/lib/widget/deploy.ts) · [Template](../../../src/lib/widget/widget-template.js) · [Rota de mensagens](../../../src/app/api/widget/%5BtenantId%5D/message/route.ts)
