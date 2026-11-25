# Planos e cobrança — Domínio

- `Tenant.planKey` seleciona o plano. `messageLimitOverride` substitui a cota padrão e `trialEndsAt` determina o prazo do teste.
- `getUsageSummary` conta `Message` com `role: "assistant"` e `sentBy: "agent"` em conversas reais desde o início do mês.
