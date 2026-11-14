# campaign-override — Queries (leitura)

## isCampaignLead(tenantId, leadId, now?) → boolean
- **Nunca lança.** Sem chamador de produção.
- Filtros: regra em `startsAt..endsAt` e lead em `leadIds`, ou `LeadAdOrigin` (código/`sourceId`), ou destinatário real de disparo da lista.

## resolveCampaignLeadMatches(tenantId, leadIds, now) → Map<leadId, { override, origin }>
- Só os leads da campanha. **Lança** em erro. Prioridade: anúncio > disparo > manual.

## getCampaignOverrideForLead / …ForLeadStrict(tenantId, leadId, now?) → CampaignOverride | null
- Sem `Strict`: erro vira `null` (marcação manual). Com `Strict`: **lança** (agenda, Clinicorp).

## overrideAsLeadCampaign(tenantId, leadId, now?) → LeadCampaign | null
- Campanha sintética (`agent.ts`); **lança**. `findLeadCampaign` (`campaigns/active.ts`) chama sem `Campaign` real.

## loadReminderOverrides(tenantIds, now?) → Map<leadId, CampaignRules>
- Em `campaigns/active.ts`: reais + `loadOverrideReminderRules` (lembretes `off`, consultas futuras). **Lança**; o worker espera.

## overrideSuppressesReminder(tenantId, leadId, startsAt, now?) → boolean
- Consulta só do Clinicorp: `true` se o lead é da regra e a consulta é até `endsAt`. **Nunca lança**; falha vira `true`.

## listRescheduleCandidates(tenantId, now?, timeZone?, { includeEvent? }) → RescheduleRow[]
- Consultas `scheduled`, futuras, de lead não teste da campanha, fora do evento. `includeEvent` inclui as do encaixe (`inEvent`). Ordem: `startsAt`.
- **Campos:** `name` (paciente, senão contato), `phone`, `date`, `time`, `origin`, `clinicorpAppointmentId`, `reminder`.

## reminderPlan(appt, cfg, campaign, now) → { status, pending }
- Regra do worker (`remindersFor`): override da consulta (`[]` ganha), depois campanha, depois conta.

## isInEventSlot, buildRescheduleWorkbook(rows, { withEvent? }), rescheduleFileName(now)
- Dia e hora locais, nunca UTC. Aba "Reagendar", telefone como texto, nome sem dado pessoal.
