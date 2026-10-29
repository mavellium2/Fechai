# campaign-reports — Escritas e envios

## recordLeadAdOrigin
- **Assinatura:** `({ tenantId, leadId, origin, at, via }) => { status: "created" | "exists" | "failed" }` — **nunca lança**.
- **Fluxo:** `createMany skipDuplicates` → se já existia e a nova mensagem traz o código do **mesmo** `sourceId`, completa o que faltava.
- **Chamado em:** `whatsapp/process-incoming.ts` (ramo recebido, depois da deduplicação, só se `!isGroup && !lead.isTest`).

## deliverCampaignReport(tenantId, now?)
- **Retorno:** `"sent" | "no_group" | "no_channel" | "no_data" | "failed"`; grava `lastStatus` (e `lastSentAt` se enviou).
- **Fluxo:** grupo (`KnowledgeGapSettings.groupId`) → `loadCampaignReport` (semana + anterior) → sem `trackedSince` = `no_data` → `formatCampaignMessage` → `sendToInternalGroup`.

## scanCampaignReports(now?) — worker
- Roda na volta de 2 min do worker de perguntas (`workers/follow-up-worker/index.ts`).
- **Claim:** `updateMany lastSentAt null | < slot` antes de enviar. `no_group/no_channel/no_data` **devolvem** o horário (tenta de novo até a tolerância); `failed` **não** (nunca repete sozinho).

## backfillAdOrigins({ tenantId, since, apply })
- Lê `/chat/findMessages` da Evolution em fatias de 7 dias, liga ao lead pelo telefone (`readHistoryMessage` + `contactPhoneAliases`), grava com `via: "history"`. Sem `apply` só conta. Script: `scripts/backfill-lead-ad-origin.ts`.

## Server Actions (`relatorios/actions.ts`, `requireProductAccess`)
- `saveCampaignSettingsAction` — Zod `campaignSettingsFormSchema` (enabled, weekday 0–6, hour 0–23, timezone); audita `campaign_report.settings_updated`.
- `sendCampaignReportNowAction` — chama `deliverCampaignReport`; erro por status; audita `campaign_report.sent_now`.
