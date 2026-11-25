# Configurações — Domínio

- `User.usesProduct` e o estado de `Affiliate` determinam os papéis. `getAccountRoles` traduz ambos para o painel.
- `TenantServiceArea` descreve a cobertura do negócio. O estado de saúde e o uso são leituras dos módulos responsáveis.
- `TeamMemberWhatsapp` guarda o WhatsApp pessoal de cada pessoa, uma linha por usuário na conta (`@@unique([tenantId, userId])`). O número confirmado fica em `phone` e, na forma canônica (`canonicalPhone`, sem 55 e sem o nono dígito), em `phoneKey`, único na conta. O número digitado fica em `pendingPhone`/`pendingKey`, que não são únicos para um erro de digitação não travar o dono do número. Detalhes no [CRM](../../painel/crm/domain.md#whatsapp-da-equipe).
