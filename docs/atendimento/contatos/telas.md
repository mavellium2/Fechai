# Contatos — Telas

- `ContatoSearch` atualiza a busca por nome ou telefone. `AddContactDialog` recebe telefone e nome opcional.
- **Editar** em cada contato abre `EditContactDialog` com `ContactProfileFields` (o mesmo do card do CRM): original do WhatsApp em cima, só leitura, e nome e variáveis editáveis embaixo. O formulário só monta ao abrir. Quando o nome que vale difere do perfil, a lista mostra "· no WhatsApp: …" ao lado do telefone. Por ser diálogo modal, mantém `FormFeedback` junto do toast.
- A seção Continuar conversa mostra até três conversas reais recentes. A lista exibe status, resumo quando disponível e o atalho de envio em `SendMessageDialog`.
- A página sinaliza WhatsApp indisponível quando nenhum canal está pronto e configurado.
