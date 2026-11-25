# Contatos — Ações

- `addContact(prev, formData)` valida o telefone, normaliza os dígitos e reutiliza o registro existente da conta. A criação nova gera `lead.created`.
- `sendMessageToContact(leadId, text)` lê o lead da conta, recusa sandbox e usa `getOrCreateConversation` e `sendManualReply`. O limite do texto é 4.096 caracteres.
