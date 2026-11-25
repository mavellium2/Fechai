# Configurações — Ações

- `updateProfile` e `changePassword` validam os formulários e atualizam dados da conta ou credencial.
- `updateAccountRoles` aplica as escolhas e recusa uma conta sem nenhum papel.
- `saveServiceAreaAction` valida e salva as cidades da área de atendimento.
- `startTeamWhatsappAction` exige `requireProductAccess`, limita a 10 códigos por hora por pessoa e chama `startTeamWhatsappLink`. Recusa número inválido, número já confirmado por outra pessoa da conta e o mesmo número já confirmado. Devolve o código em `linkCode`, que não é gravado (no banco fica o SHA-256). `cancelTeamWhatsappAction` desiste do pendente; `removeTeamWhatsappAction` apaga o vínculo. Os eventos `account.whatsapp_link_started`, `account.whatsapp_verified` e `account.whatsapp_removed` não levam o número.
