# Gestão de contas — Ações

- `createAccount`, `suspendTenant`, `deleteTenantAccount`, `changePlan`, `setTenantUsageLimit`, `setTenantPriceOverride` e `setTenantTrial` ficam em `(admin)/actions.ts`.
- `setTenantMetaWhatsappEnabled` e `setTenantEvolutionWhatsappEnabled` ajustam a disponibilidade das conexões de WhatsApp. `impersonateUser` e `stopImpersonation` gerenciam a personificação.
- `setTenantCrmEnabled` exige a sessão real do superadmin. A liberação provisiona e classifica os leads antes de ligar a flag e a mudança efetiva fica no evento `admin.crm_access_changed`. Consulte os [resultados e a concorrência da ativação](../../painel/crm/actions.md).
