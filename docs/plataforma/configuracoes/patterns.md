# Configurações — Padrões

- Obtenha a conta da sessão em cada operação. Reutilize a política compartilhada de senha ao trocar credenciais.
- Formulários do painel com `useActionState` usam o padrão de feedback definido no [guia de toasts](../../../src/components/ui/toast/TOASTS.md).
- Confirmação por WhatsApp sem primeiro contato: a pessoa escreve para a clínica, nunca o contrário. Não responda no privado a um comando da equipe: o eco `fromMe` da resposta abriria cadastro e conversa para o número da pessoa ([`team-whatsapp-command.ts`](../../../src/modules/crm/team-whatsapp-command.ts)).
