# Configurações — Consultas

- `getAccountRoles(userId)` fornece papéis e a condição de conta só afiliada.
- `tenantChecks`, `getUsageSummary` e `getServiceArea` leem saúde, cota e cobertura da conta.
- `getTeamWhatsapp(tenantId, userId)` devolve o número confirmado, a data e o pendente, sem o hash do código. `GET /api/configuracoes/whatsapp` devolve só a situação (`none`, `pending` ou `verified`) para a tela acompanhar a confirmação.
