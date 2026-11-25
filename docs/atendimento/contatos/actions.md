# Contatos — Ações

- `addContact(prev, formData)` valida o telefone, normaliza os dígitos e reutiliza o registro existente da conta. A criação nova gera `lead.created`.
- `saveContactProfile(prev, formData)` edita nome e variáveis do contato da conta (`isTest: false`) por `editContactProfile` com `via: "contatos"`. Não exige o CRM ligado. Grava `crm.contact_edited` quando algo mudou e revalida `/contatos`, `/conversas`, `/inicio` e `/crm`.
- `sendMessageToContact(leadId, text)` lê o lead da conta, recusa sandbox e usa `getOrCreateConversation` e `sendManualReply`. O limite do texto é 4.096 caracteres.
