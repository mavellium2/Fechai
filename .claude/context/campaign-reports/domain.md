# campaign-reports — Entidades e Domínio

## LeadAdOrigin (Prisma, uma por lead)
- **Campos:** `leadId @unique`, `tenantId`, `sourceId?` (id do anúncio na Meta, chave estável), `code?` ("AD27"), `name?`, `sourceUrl?`, `platform?` (facebook | instagram), `capturedVia` (webhook | history), `firstAdAt`.
- **Invariantes:** o primeiro anúncio vence; sem nome, telefone, texto de conversa ou `ctwaClid`.

## CampaignReportSettings (Prisma, uma por conta; sem linha = desligado)
- **Campos:** `enabled` (padrão false), `weekday` (0=domingo, padrão 5), `hour` (0–23, padrão 8), `timezone`, `lastSentAt`, `lastStatus` (sent | no_group | no_phone | no_channel | no_data | refused | failed).
- **Destino:** `destination` (`group` padrão | `phone`), `groupId`/`groupName` e `phone` (só dígitos com 55). Os dois ficam guardados. Sem `groupId` próprio vale `KnowledgeGapSettings.groupId`.
- **Importação do histórico:** `historyImportStatus` (requested | running | done | failed), `historyImportAt`, `historyImportSummary` (só contagens).

## Tipos
- `AdOrigin` = `{ sourceId, code, name, sourceUrl, platform }` — saída dos extratores; `IncomingMessage.adOrigin?` só em mensagem recebida.
- `CampaignRow` = `LeadRow` (lead-insights) + `origin`. `CampaignSummary` = `{ leads, adLeads, otherLeads, adScheduled, otherScheduled, lines[] }`; cada `CampaignLine` tem `leads/scheduled/handoff/lost/open`.
- `CampaignReport` = `{ current, previous, trackedSince }`.

## Regras puras
- `parseAdCode("[AD27 - Nome]")` → `{ code: "AD27", name }` | null.
- `currentSlot(now, settings)` → instante marcado de hoje se estamos no dia/hora e dentro da tolerância (`SEND_GRACE_MS` = 6 h, sem atravessar a meia-noite).
- `weekWindow(now, tz)` → `{ from, to, prevFrom }`: 7 dias até a meia-noite de hoje (hoje fora) + a semana anterior.
