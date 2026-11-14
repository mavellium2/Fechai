# campaign-override — Entidades e Domínio

## Entidade: CampaignOverride (Prisma, 1 por conta e `key`)
- **Campos:** `tenantId`, `key` (hoje `implantes-2026-11`), `adCodes[]` ("AD27"), `adSourceIds[]`, `broadcastCampaignIds[]`, `leadIds[]`, `startsAt`, `endsAt`, `rules` (Json), `createdById?`, `updatedById?`.
- **Invariantes:** `@@unique([tenantId, key])`; vale só em `startsAt..endsAt`; fim = `IMPLANTES_ENDS_AT` (2026-11-20T02:59:59Z).

## Regras (`config.ts`)
- Dias 18 e 19/11 e hora "09:00", locais (America/Sao_Paulo).
- `OverrideRules` = `{ dates, time, capacityPerDay?, offerText? }`. `capacityPerDay` e `offerText` só são guardados neste PR.
- `parseOverrideRules` e `normalizeAdCode` **nunca lançam**.

## Tipos
- `CampaignLeadOrigin` = `{ kind: "anuncio" | "disparo" | "manual", label }`, sem dado pessoal.
- `OverrideUpdate` (`update.ts`), `ScriptActor` (`actor.ts`), `RescheduleRow`, `ReminderPlan = { status: "yes" | "no" | "unknown", pending }`.

## Falhas
- `isCampaignLead`, `campaignLeadMatches`, `getCampaignOverrideForLead`, `campaignLeadOrigin`: erro vira `false` / `null` / mapa vazio.
- `resolveCampaignLeadMatches` e `listRescheduleCandidates` **lançam** (falha de banco não vira lista vazia).
- Config de lembrete ou campanha ilegível: `status: "unknown"` ("não sei"), nunca `"no"`.
