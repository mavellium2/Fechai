# campaign-reports — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-11-01] — Gráfico de leads por anúncio na aba e bloco no relatório mensal

**Arquivos:**
- `summary.ts`: `campaignBars` (10 maiores + "Outros N" + "Sem anúncio identificado" por último), `campaignKey`, `NO_AD_LABEL`
- `queries.ts`: `loadCampaignRows` (uma linha por lead, com `leadId`), `loadCampaignTrackedSince`; `loadCampaignSummary`/`loadCampaignReport` passam por elas
- `../reports/monthly-campaigns.ts` (novo), `monthly-data.ts` (`MonthlyReportData.campaigns?`), `monthly-evidence.ts` (`evidence.campaigns`), `monthly.ts` (leitura no escopo de agentes, agendamentos até o fim do mês), `monthly-validate.ts`, `monthly-limitations.ts`
- `relatorios/CampaignView.tsx` (gráfico em largura cheia e tabela com Total; saem as colunas equipe/perdeu/em andamento), `monthly-v2/MonthlyReportDocument.tsx` (parte 04), `components/charts/HorizontalBars.tsx` (`colorClass` por ponto)

**Razão:** a aba mostrava barras cortadas em 12 e duas tabelas; o cliente quer ver de uma vez o volume por anúncio e o total. O mesmo recorte entrou no relatório mensal, que não mostrava de qual anúncio vinham os leads.

**Impacto:** sem mudança de schema. O bloco do mensal é opcional e congelado no snapshot: meses fechados antes não o têm e o documento não muda. Validador bloqueia soma que não fecha. Não entra em receita, economia nem ROI.

### [2026-10-29] — Relatório semanal em PDF, com prévia na aba

**Arquivos:**
- novos `campaign-reports/pdf.ts`, `document.ts`, `relatorios/campanhas/pdf/route.ts`; `send.ts`, `message.ts` (`adTrend`, `formatCampaignCaption`)
- `whatsapp/provider.ts` + `evolution.ts` (`sendDocument`, via `sendMedia`); `knowledge-gaps/group.ts` (envio de documento ao grupo e ao número)
- `relatorios/CampaignView.tsx` (card "Prévia do relatório semanal", `<iframe>`), `next.config.ts` (exceção `SAMEORIGIN` só para a rota do PDF; `frame-src 'self'`)
- `ui/unsaved-form-state.ts` (`[data-unsaved-ignore]`): a lista de grupos que carrega sozinha não marca mais o formulário como alterado

**Razão:** o cliente quer o relatório em PDF, no padrão dos relatórios, e ver na página como vai chegar.

**Impacto:** sem mudança de schema. O envio passa a ser documento + legenda; se o PDF falhar, sai em texto. Só QR code (Evolution `sendMedia`).

### [2026-10-29] — Destino do envio (grupo ou número) e importação do histórico pela tela

**Arquivos:**
- `prisma/schema.prisma`: `CampaignReportSettings` ganhou `destination`, `groupId`, `groupName`, `phone` e `historyImport*` (só colunas opcionais/com padrão: `db push` sem `--accept-data-loss`)
- `campaign-reports/settings.ts`, `settings-store.ts`, `send.ts`, novos `phone.ts` e `history-import.ts`; `knowledge-gaps/group.ts` (`sendToInternalPhone`); `whatsapp/contact-phone.ts` (`normalizeBrazilianPhone`, a regra do número agora é uma só com a pesquisa de satisfação)
- `relatorios/CampaignSettingsForm.tsx`, `CampaignView.tsx`, `actions.ts`, `page.tsx`; `workers/follow-up-worker/index.ts`; `audit/events.ts`; `ui/radio-cards.tsx` (tema escuro do painel)

**Razão:** a aba aparecia vazia em contas que já tinham anúncio (a captura só vale para contatos novos, e o script de importação exigia terminal), e o cliente quer escolher entre um grupo ou o próprio número.

**Impacto:** `db push` + `generate` em web e worker; reiniciar o worker. O número só sai pelo QR e é primeiro contato: a tela orienta mandar um "oi" antes, e `isPhoneRefused` barra bloqueado, "pare" e contato da Meta.

### [2026-10-29] — Documentação inicial + captura do anúncio, aba Campanhas e envio semanal

**Arquivos:**
- `prisma/schema.prisma`: `LeadAdOrigin`, `CampaignReportSettings` (só tabelas novas; `Lead.adOrigin`, relações em `Tenant`)
- `whatsapp/ad-origin.ts`, `evolution.ts` (`parseWebhook`), `meta-events.ts`, `provider.ts`, `process-incoming.ts`
- `campaign-reports/*`, `knowledge-gaps/group.ts` (envio ao grupo extraído de `notify.ts`)
- `relatorios/CampaignView.tsx`, `CampaignSettingsForm.tsx`, `actions.ts`, `page.tsx`; `workers/follow-up-worker/index.ts`
- `scripts/backfill-lead-ad-origin.ts`, `scripts/diagnostico-anuncio-evolution.mjs`; `audit/events.ts`

**Razão:** cliente pediu relatório semanal com o nome do anúncio de cada conversa; o Fechai ignorava o dado do anúncio. Testado em produção (somente leitura) que a Evolution guarda o dado de anúncio.

**Impacto:** `db push` + `generate` em web e worker; reiniciar o worker; rodar o backfill uma vez por conta (simula antes). Envio semanal nasce desligado.
