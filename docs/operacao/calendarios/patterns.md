# Integrações de calendário — Padrões de código

## Clinicorp

- Use `saveClinicorpCredentials` para gravar e a leitura interna `getIntegration` para decifrar. IDs externos de 64 bits ficam como `String`. Envie `date` como dia local e `fromTime`/`toTime` em hora local, com as conversões de `time.ts`.
- Um HTTP bem-sucedido sem confirmação não prova a criação. A fila relê a agenda sem cache e procura a referência da operação antes de considerar novo envio. Se a leitura falhar ou for ambígua, aguarda conferência.
- Para confirmar consultas diretas do Clinicorp, preserve categoria elegível, consentimento aplicável ao QR, bloqueios e claim em `ReminderDispatch`. Pela Meta, use template aprovado. Primeiro contato pelo QR só cabe na modalidade de confirmação do Clinicorp habilitada com aceite, para as categorias autorizadas e demais regras da fila.

## Calendário da Apple

- A credencial é gravada por `saveIcloudCredentials` e só é lida pelo adaptador. `PUT` com `If-None-Match: *` usa endereço estável `fechai-<id>.ics`. Resposta HTTP 412 indica que o evento já foi enviado.
- O worker mantém espelhos de consultas futuras. Para disponibilidade, `null` do CalDAV vira `AvailabilityUnavailableError` na agenda. Use a deduplicação própria na grade e preserve o horário do Fechai quando alguém altera o evento pelo iPhone.

## Google Agenda

- Use `pushEventToGoogle` e `deleteEventFromGoogle` para espelhar e remover. O adaptador renova o token quando necessário. O compromisso local permanece se o envio falhar.

[Guia técnico de calendários](../../../src/modules/scheduling/README.md) · [Diagnóstico Clinicorp](DIAGNOSTICO-CLINICORP.md) · [Regras da confirmação](../../../workers/follow-up-worker/clinicorp-reminders.ts)
