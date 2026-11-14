# campaign-override — Queries (leitura)

## isCampaignLead(tenantId, leadId, now?)
- **Retorna:** `boolean`. **Nunca lança.**
- **Filtros:** regra com `startsAt <= now <= endsAt` e lead em `leadIds`, ou `LeadAdOrigin` por código/`sourceId`, ou destinatário real (não teste, `sent`/`unknown`) de disparo da lista.
- **Uso:** ainda sem chamador de produção.

## resolveCampaignLeadMatches(tenantId, leadIds, now) → Map<leadId, { override, origin }>
- **Retorna:** só os leads da campanha. **Lança** em erro de banco. Prioridade: anúncio > disparo > manual.

## listRescheduleCandidates(tenantId, now?, timeZone?) → RescheduleRow[]
- **Retorna:** consultas `scheduled`, futuras, com `leadId`, de lead não teste e da campanha, fora do dia/hora do evento. Ordem: `startsAt`.
- **Campos:** `name` (paciente, senão contato), `phone`, `date`, `time`, `origin`, `clinicorpAppointmentId`, `reminder`.

## reminderPlan(appt, cfg, campaign, now) → { status, pending }
- Regra do worker (`remindersFor`, `staleReminders`): override da consulta, depois campanha, depois conta; menos `remindersSent` e janelas já perdidas.

## isInEventSlot(startsAt, rules, timeZone?), buildRescheduleWorkbook(rows), rescheduleFileName(now)
- Dia e hora locais, nunca UTC. Planilha: aba "Reagendar", telefone como texto. Nome do arquivo sem dado pessoal.
