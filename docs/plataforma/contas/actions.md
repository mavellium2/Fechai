# Cadastro e onboarding — Ações

- `POST /api/register` valida os campos de cadastro e usa `createTenantWithOwner` no fluxo grátis.
- `saveOnboardingProgress` e `goToOnboardingStep` persistem o progresso do wizard.
- `completeOnboarding({ draft })` valida respostas e grava persona, ações do agente e conclusão na mesma transação.
