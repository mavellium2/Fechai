# campaign-override — Entidades e Domínio

## Entidade: CampaignOverride (Prisma, 1 por conta e `key`)
- **Campos:** `tenantId`, `key` (`implantes-2026-11`), `adCodes[]`, `adSourceIds[]`, `broadcastCampaignIds[]`, `leadIds[]`, `startsAt`, `endsAt`, `rules` (Json), `createdById?`, `updatedById?`.
- **Invariantes:** `@@unique([tenantId, key])`; vale só em `startsAt..endsAt`; fim = `IMPLANTES_ENDS_AT` (2026-11-20T02:59:59Z).

## Regras (`config.ts`)
- `OverrideRules` = `{ dates (18 e 19/11), time ("09:00"), capacityPerDay?, offerText? }`, locais (America/Sao_Paulo).
- `capacityPerDay` (inteiro ≥ 1) é a vaga por dia; `offerText` vai ao prompt. `parseOverrideRules` **nunca lança**.

## Campanha sintética (`agent.ts`)
- `OVERRIDE_CAMPAIGN_ID` = `override:implantes-2026-11`; `isOverrideCampaignId()` separa da `Campaign` real.
- `overrideToCampaignRules`: `times: [time]`, `capacity = capacityPerDay ?? 0` (sem vaga, recusa e transfere), `reminders: "off"`, `outside: "handoff"`.
- Frases fixas: `OVERRIDE_REFUSAL` (fora do evento) e `OVERRIDE_PROMPT_LINE` (só do lead da regra).

## Trava de vaga (`slot-lock.ts`)
- `withOverrideSlotLock`: conta e grava na mesma `$transaction`, com `pg_advisory_xact_lock` por conta e horário.
- `OverrideSlotFullError` (estende `CampaignRuleError`): lotou entre a checagem e a gravação.

## Tipos
- `CampaignLeadOrigin` = `{ kind, label }` (anuncio, disparo ou manual), sem dado pessoal.
- `RescheduleRow` (`inEvent?`), `ReminderPlan` (`status`: yes/no/unknown), `ClearRemindersResult` (contagens).

## Erros e falhas
- `isCampaignLead`, `campaignLeadMatches`, `getCampaignOverrideForLead`: erro vira `false` / mapa vazio / `null`.
- `...Strict`, `resolveCampaignLeadMatches`, `overrideAsLeadCampaign`, `loadOverrideReminderRules`, `listRescheduleCandidates`: **lançam**. A tool devolve `Falha ao executar <tool>.`; o lembrete espera.
- `overrideSuppressesReminder`: nunca lança; falha conta como suprimido.
- Config ilegível de lembrete ou campanha: `status: "unknown"`, nunca `"no"`.
