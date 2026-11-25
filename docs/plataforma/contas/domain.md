# Cadastro e onboarding — Domínio

- `Tenant` isola o negócio por `tenantId`. `User` guarda dados pessoais do cadastro e o papel da sessão.
- `Tenant.onboardingStep` e `onboardingDraft` guardam o progresso. `onboardingCompleted` controla a entrada no painel.
- `src/lib/br-lead.ts` reúne regras de dados brasileiros usadas pelo formulário e pelo servidor. Os dados opcionais no schema aceitam contas de fluxos anteriores e administrativos.
