# Configurações — Telas

- `ProfileForm`, `PasswordForm` e `RolesForm` cuidam de perfil, senha e papéis.
- Para quem usa o produto, a página inclui uso atual, checagens de saúde e `ServiceAreaForm`.
- **Seu WhatsApp na equipe** (`TeamWhatsappForm`, só para quem usa o produto) liga o celular da pessoa ao usuário. Ela digita o número, gera o código e manda `#vincular 123456` do próprio WhatsApp para o número da clínica conectado por QR, no privado ou no grupo de transbordo. O código aparece uma vez só, na resposta que o gerou, e vale 15 min. Enquanto ele vale, a tela consulta `GET /api/configuracoes/whatsapp` a cada 5 s com a aba visível e se atualiza quando a confirmação chega ou o código vence. Confirmado, mostra o número e a data, com **Trocar número** (o atual vale até o novo ser confirmado) e **Desligar**. Sem QR conectado, avisa que a confirmação depende dele.
