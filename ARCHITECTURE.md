# Arquitetura

## Stack

- **App:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn-style UI
- **ORM/DB:** Prisma 6 + PostgreSQL (pgvector) — ver [ADR-001](./docs/decisions/ADR-001-prisma-v6.md)
- **Auth:** Auth.js v5 (NextAuth) — Credentials, sessão JWT (`role`/`tenantId` no token)
- **Pagamento:** Stripe (Checkout + Webhooks, modo teste) — `price_data` inline ([ADR-002](./docs/decisions/ADR-002-stripe-inline-price.md))
- **IA:** cadeia configurável de provedores via painel `/admin/ia` (Gemini, Grok, Groq, OpenAI e compatíveis)
- **WhatsApp:** Evolution API via interface `WhatsAppProvider`
- **Jobs:** BullMQ + Redis (worker de follow-up)
- **RAG:** pgvector + embeddings OpenAI (`text-embedding-3-small`)

> Estado e entregas recentes: [docs/CHANGELOG.md](./docs/CHANGELOG.md).

## Quatro camadas (isoladas por `tenantId`)

1. **Onboarding & Billing** — cadastro → checkout Stripe → webhook → provisiona tenant + instância WhatsApp.
2. **Agentes** — persona (prompt), base de conhecimento (RAG), ações (toggle), conexão WhatsApp.
3. **Motor de execução** — recebe msg → monta contexto (RAG + persona + histórico) → LLM com tools → executa ação → responde → agenda follow-up. O que não está na base não é inventado: vira pergunta na fila `/perguntas`, e a resposta aprovada volta para a base (ciclo P-87, [`knowledge-gaps`](src/modules/knowledge-gaps/README.md)).
4. **Dados & Relatórios** — conversas, leads, métricas, logs.

## Regra de ouro do multi-tenant

**Toda query no Prisma filtra por `tenantId`.** O acesso à sessão/tenant passa sempre pelos guards de `src/lib/session.ts` (`requireSession`, `requireTenant`, `requireSuperadmin`). Nunca fazer query solta na camada de UI sem antes obter o `tenantId` por um guard.

## Abstrações que protegem trocas futuras

- `LLMProvider` (`src/modules/agent-engine/llm.ts`) — troca OpenAI por outro provedor sem tocar no motor.
- `WhatsAppProvider` (`createInstance`, `getQrCode`, `sendMessage`, `parseWebhook`) — troca Evolution API por WhatsApp Cloud API só na factory `src/modules/whatsapp/index.ts`.
- `EmbeddingProvider` implícito em `src/modules/knowledge-base/embeddings.ts`.

Todas degradam com graça quando a env não está configurada (respostas canned / avisos na UI), permitindo rodar o app sem todos os serviços externos.

## Saúde e operação

- `/configuracoes` (dashboard) mostra a saúde da config do tenant (checklist "Sua configuração"). A checagem de integrações externas (env vars) não é mais exibida ao tenant — `integrationChecks()` (`src/lib/health.ts`) segue disponível para um eventual painel admin.
- `GET /api/health` verifica o banco (200/503) para monitoramento de deploy.
- Tenant `suspended` é bloqueado no layout do dashboard.

## Deploy

- **Self-hosted via Docker** (implementado) — `web` e `worker` na mesma imagem, Postgres+Redis
  em containers, e a **Evolution API (WhatsApp)** também roda no compose (`evolution` +
  `evolution-postgres`, gateway self-hosted). O HTTPS de `fechai.januscms.com.br` é feito pelo
  **Traefik** do servidor (rede externa `traefik-public` + labels no `web`; mesmo padrão do projeto
  janus). Ver [README.docker.md](./README.docker.md). Localmente, só a Evolution pode subir isolada
  via `docker-compose.evolution.yml`.
- **Laboratório administrativo local** — `npm run dev:test` usa o banco lógico
  separado `saas_test`. Ele não é criado na VPS por commit/push e não substitui
  uma implantação de homologação; ver
  [docs/ambiente-de-testes-admin.md](./docs/ambiente-de-testes-admin.md).
- **Vercel (app) + Railway/Fly.io (worker + Redis)** (compatível, não implementado) — alternativa
  gerenciada; o worker roda com `npm run worker` em qualquer um dos dois casos. Neste cenário a
  Evolution continua externa: use um host gerenciado da Evolution API e aponte
  `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`.
