# Índice do Projeto

> Leia este arquivo primeiro em qualquer nova sessão. Ele te diz onde encontrar o resto — não leia o repositório inteiro.

## O que é este projeto

**fechai** — SaaS multi-tenant onde qualquer negócio configura um agente de IA para atendimento comercial via WhatsApp, sem suporte humano no onboarding. Produto **genérico** (persona, base de conhecimento e ações configuráveis); a "escola de esportes" é apenas um seed de exemplo.

> Nomenclatura: **fechai** é o nome do produto (wordmark, títulos, copy). "Agente" segue sendo o termo de domínio para a IA que atende o lead — `agent-engine`, `AgentConfig`, `runAgentTurn` e frases como "o agente responde" **não** mudam.

## Estado atual

Ver [CHANGELOG.md](./CHANGELOG.md) para o último milestone concluído.

## Onde encontrar cada coisa

- Arquitetura geral → [ARCHITECTURE.md](../ARCHITECTURE.md)
- Convenções de código → [CONVENTIONS.md](../CONVENTIONS.md)
- Primitivos de UI, superfícies e regras de interação → [CONVENTIONS.md](../CONVENTIONS.md) (seções "Superfícies" e "Regras de interação")
- Navegação tenant/admin, temas, Agentes v7 e teste com rascunho → [contexto compacto do painel](../.claude/context/painel/_index.md); [mapa e validação de Agentes](../src/app/(dashboard)/agentes/README.md)
- Conversas v1, filtros, histórico e contato → [mapa de Conversas](../src/app/(dashboard)/conversas/README.md)
- Revisão de UI do painel (diagnóstico, decisões e pendências) → [revisao-ui-painel-2026-07.md](./revisao-ui-painel-2026-07.md)
- SEO e GEO (metadata, sitemap, JSON-LD, llms.txt + passos fora do código) → [SEO.md](./SEO.md)
- Decisões técnicas (ADRs) → [decisions/](./decisions/)
- Auth (Auth.js v5) → `src/auth.ts`, guards em `src/lib/session.ts`
- Cliente Prisma (singleton) → `src/lib/prisma.ts`
- Schema do banco → `prisma/schema.prisma`
- Seed (superadmin + tenant demo) → `prisma/seed.ts`
- Módulo tenants (provisionamento + onboarding) → `src/modules/tenants/README.md`
- Onboarding guiado da conta nova (`/onboarding`) → `src/app/onboarding/` + seção no README de tenants
- Módulo billing → `src/modules/billing/README.md`
- Módulo affiliates (programa de indicação, comissão progressiva, papéis da conta) → `src/modules/affiliates/README.md`
- Papéis da conta (cliente · afiliado) e painel enxuto de quem só afilia → seção "Os dois papéis" em `src/modules/affiliates/README.md`
- Módulo agent-engine (ações + persona; motor no M5) → `src/modules/agent-engine/README.md`
- Prioridade e transferência para humano (aviso no grupo interno, nunca inclusão do lead) → [regras, formato e testes](../src/modules/agent-engine/README.md#transferir-para-humano-e-o-grupo-do-whatsapp-handoffts)
- Duplicação, exportação, importação e réplica administrativa de agentes → seção "Duplicar, exportar, importar e replicar agentes" no README do agent-engine
- Resumo de conversa gerado por IA (sob demanda, com cache) → seção "Resumo da conversa" em `src/modules/agent-engine/README.md`
- Módulo agent-mcp (`/api/mcp`, tokens emitidos pelo superadmin, leitura da configuração do agente; partes B e C pendentes) → `src/modules/agent-mcp/README.md`
- Módulo ai (providers de LLM/embeddings, catálogo, modelo ativo) → `src/modules/ai/README.md`
- Módulo knowledge-base (RAG) → `src/modules/knowledge-base/README.md`
- Módulo whatsapp (provider Evolution) → `src/modules/whatsapp/README.md`
- Disparos pela Meta (`/disparos`, Excel/JSON, testes, agenda, entrega e resultados) → [passo a passo e operação](../src/modules/broadcasts/README.md)
- Módulo scheduling (agenda, Google Agenda, Clinicorp, lembretes de consulta) → `src/modules/scheduling/README.md`
- Agenda com o Clinicorp (consultas de lá na `/agenda`, ao vivo, troca de mês rápida, lembretes para esses pacientes) → [ADR-005](./decisions/ADR-005-agenda-clinicorp.md) + seções do README de scheduling
- Plano das confirmações de avaliações do Clinicorp (relato da cliente, público, QR e duplicação) → [plano de 09/10/2026](./plans/2026-10-09-confirmacoes-avaliacoes-clinicorp.md)
- Módulo reports → `src/modules/reports/README.md`
- Relatório mensal v2: SDD original, fases e progresso da continuação → [SDD-relatorio-mensal-v2.md](./SDD-relatorio-mensal-v2.md)
- ROI mensal (P-79): revisão administrativa, correções manuais, fórmulas, publicação no tenant e PDF → [contrato e operação](./P-79-relatorio-mensal-roi.md); [mapa da área de relatórios](../src/app/(dashboard)/relatorios/README.md)
- Perguntas sem resposta (P-87): regra "nunca inventar", fila `/perguntas`, aprovação na base, retomada do contato, avisos, máscara LGPD e métricas → [contrato e operação](./P-87-perguntas-sem-resposta.md); [módulo](../src/modules/knowledge-gaps/README.md); decisões em [ADR-004](./decisions/ADR-004-fila-perguntas-sem-resposta.md)
- Módulo admin → `src/modules/admin/README.md`
- Laboratório do administrador com banco isolado → [ambiente-de-testes-admin.md](./ambiente-de-testes-admin.md)
- Worker de follow-up → `workers/follow-up-worker/README.md`
- Deploy em produção (Docker, servidor Linux) → [README.docker.md](../README.docker.md)

## Como rodar localmente

```bash
cp .env.example .env      # preencha os secrets necessários
npm install
npm run db:up             # sobe Postgres (pgvector) + Redis via Docker
npm run db:push           # aplica o schema Prisma
npm run db:seed           # cria superadmin + tenant demo
npm run dev               # http://localhost:3001
```

Para testar mudanças administrativas sem tocar nessa base, prepare o banco
isolado com `npm run test:db:prepare` e abra o laboratório com
`npm run dev:test` em `http://localhost:3002`.

Contas de teste (após seed): `superadmin@saas.local` / `demo@escola.local` — senha `password123`.
