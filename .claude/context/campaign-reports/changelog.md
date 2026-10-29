# campaign-reports — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-10-29] — Documentação inicial + captura do anúncio, aba Campanhas e envio semanal

**Arquivos:**
- `prisma/schema.prisma`: `LeadAdOrigin`, `CampaignReportSettings` (só tabelas novas; `Lead.adOrigin`, relações em `Tenant`)
- `whatsapp/ad-origin.ts`, `evolution.ts` (`parseWebhook`), `meta-events.ts`, `provider.ts`, `process-incoming.ts`
- `campaign-reports/*`, `knowledge-gaps/group.ts` (envio ao grupo extraído de `notify.ts`)
- `relatorios/CampaignView.tsx`, `CampaignSettingsForm.tsx`, `actions.ts`, `page.tsx`; `workers/follow-up-worker/index.ts`
- `scripts/backfill-lead-ad-origin.ts`, `scripts/diagnostico-anuncio-evolution.mjs`; `audit/events.ts`

**Razão:** cliente pediu relatório semanal com o nome do anúncio de cada conversa; o Fechai ignorava o dado do anúncio. Testado em produção (somente leitura) que a Evolution guarda o dado de anúncio.

**Impacto:** `db push` + `generate` em web e worker; reiniciar o worker; rodar o backfill uma vez por conta (simula antes). Envio semanal nasce desligado.
