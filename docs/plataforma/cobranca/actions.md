# Planos e cobrança — Ações

- `POST /api/checkout` cria uma sessão da Stripe com `price_data` inline. `POST /api/plan/free` atende ao fluxo grátis.
- `POST /api/webhooks/stripe` verifica o evento e aplica a atualização de plano. `setTenantPlan` é idempotente e mantém o prazo coerente com o plano.
