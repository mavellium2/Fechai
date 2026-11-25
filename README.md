# fechai

SaaS multi-tenant onde qualquer negócio configura um **agente de IA** para atender, qualificar e agendar pelo WhatsApp — sem suporte humano no onboarding.

> O produto é **genérico**: persona, base de conhecimento e ações são configuráveis por tenant. A "escola de esportes" do seed é só um exemplo.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Prisma 6 + PostgreSQL/pgvector · Auth.js v5 · Gemini (trocável em `/admin/ia`) · Stripe · BullMQ/Redis

## Rodando local

```bash
cp .env.example .env      # preencha GEMINI_API_KEY (https://aistudio.google.com/apikey)
npm run db:up              # Postgres (5433) + Redis (6379) via Docker
npm install
npx prisma db push
npm run db:seed
npm run dev               # http://localhost:3001
```

> A porta do Postgres no host é **5433** de propósito, para não colidir com uma instalação local na 5432.

### Contas do seed

| Papel | E-mail | Senha | Cai em |
|---|---|---|---|
| Superadmin | `superadmin@saas.local` | `password123` | `/admin/contas` |
| Cliente (owner) | `demo@escola.local` | `password123` | `/inicio` |

## Documentação

Comece pelo **[índice de funcionalidades](./docs/README.md)**. Cada área do painel tem um guia com regras, telas, consultas, ações e histórico.

Deploy em produção (Docker, servidor Linux) → **[README.docker.md](./README.docker.md)**.
Backup do banco em produção (diário 02:00 mantém 3, mensal dia 1 04:00 mantém 1) → **[deploy/BACKUP_SERVICE.md](./deploy/BACKUP_SERVICE.md)**.
Laboratório administrativo com banco isolado → **[docs/plataforma/ambientes/ambiente-de-testes-admin.md](docs/plataforma/ambientes/ambiente-de-testes-admin.md)**.

> Push para `main` recria o app web e o worker na VPS, mas preserva o Postgres e
> seu volume. Ele não cria o banco de laboratório nem aplica mudanças do Prisma
> automaticamente; veja a seção "O que acontece ao fazer push" no guia Docker.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | App em desenvolvimento |
| `npm run dev:test` | App na porta 3002 usando o banco isolado `TEST_DATABASE_URL` |
| `npm run test:db:prepare` | Cria, atualiza e popula o banco do laboratório administrativo |
| `npm run build` | Build de produção |
| `npm run db:seed` | Popula superadmin + tenant de exemplo |
| `npm run worker` | Worker de follow-up (BullMQ) |
| `npm run backup:now` | Backup manual imediato (`pg_dump` streaming + gzip em `backups/`) |
| `npm run backup:daemon` | Daemon de backup: diário 02:00 (mantém 3) + mensal dia 1 04:00 (mantém 1) |
| `npm run db:restore backups/arquivo.sql.gz` | Restaura um dump (aceita `.sql.gz`, `.sql`, `.dump`) |
