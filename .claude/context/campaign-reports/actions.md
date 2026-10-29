# campaign-reports — Escritas e envios

## recordLeadAdOrigin
- **Assinatura:** `({ tenantId, leadId, origin, at, via }) => { status: "created" | "exists" | "failed" }` — **nunca lança**.
- **Fluxo:** `createMany skipDuplicates` → se já existia e a nova mensagem traz o código do **mesmo** `sourceId`, completa o que faltava.
- **Chamado em:** `whatsapp/process-incoming.ts` (ramo recebido, depois da deduplicação, só se `!isGroup && !lead.isTest`).

## deliverCampaignReport(tenantId, now?)
- **Retorno:** `"sent" | "no_group" | "no_phone" | "no_channel" | "no_data" | "refused" | "failed"`; grava `lastStatus` (e `lastSentAt` se enviou).
- **Fluxo:** destino (grupo próprio → grupo de `KnowledgeGapSettings`; ou número) → número: `isPhoneRefused` (`phone.ts`) → `buildCampaignDocument` (semana + anterior; sem `trackedSince` = `no_data`) → PDF como documento com legenda via `sendDocumentToInternalGroup` | `sendDocumentToInternalPhone` (só QR, nunca Meta); sem PDF, texto via `sendToInternalGroup` | `sendToInternalPhone`.

## scanCampaignReports(now?) — worker
- Roda na volta de 2 min do worker de perguntas (`workers/follow-up-worker/index.ts`).
- **Claim:** `updateMany lastSentAt null | < slot` antes de enviar. `no_group/no_phone/no_channel/no_data` **devolvem** o horário (tenta de novo até a tolerância); `failed` e `refused` **não** (nunca repete sozinho).

## backfillAdOrigins({ tenantId, since, apply })
- Lê `/chat/findMessages` da Evolution em fatias de 7 dias, liga ao lead pelo telefone (`readHistoryMessage` + `contactPhoneAliases`), grava com `via: "history"`. Sem `apply` só conta. Script: `scripts/backfill-lead-ad-origin.ts`.

## requestHistoryImport(tenantId) / runPendingHistoryImports() — `history-import.ts`
- A tela só marca `historyImportStatus = requested` (exige QR conectado, recusa se já há uma na fila/rodando). O **worker** (volta de 2 min) pega **uma por vez**, marca `running`, roda `backfillAdOrigins` (últimos 60 dias, `apply`) em segundo plano e grava `done`/`failed` + resumo só com contagens. `running` há >30 min libera pedir de novo.

## Server Actions (`relatorios/actions.ts`, `requireProductAccess`)
- `saveCampaignSettingsAction` — Zod `campaignSettingsFormSchema` (enabled, weekday, hour, timezone, destination, groupId/groupName, phone via `normalizeBrazilianPhone`); `destinationProblem` recusa ligar sem destino completo; audita `campaign_report.settings_updated` (nunca o número: só `hasPhone`).
- `sendCampaignReportNowAction` — chama `deliverCampaignReport`; erro por status; audita `campaign_report.sent_now`.
- `requestCampaignHistoryImportAction` — chama `requestHistoryImport`; audita `campaign_report.history_import_requested`.
