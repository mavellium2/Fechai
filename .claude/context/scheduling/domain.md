# Scheduling — domínio

- ScheduleConfig: JSON em TenantAction/schedule_meeting; parse seguro/legado.
- ReminderRule: minutesBefore/template/sendTime; horário local, sem LLM.
- Público: all/selected_types + reminderTypes, independente da duração; desconhecido excluído.
- Appointment: override null segue conta, [] não envia; serviceType e remindersSent.
- ClinicorpAgendaItem: só leitura; categoryId/category; não cria Appointment.
- ClinicorpReminder: controle legado por tenant/id/horário.
- ReminderDispatch: tenant/origem/horário/antecedência; queued/blocked/sending/sent/manual/unknown/skipped; token de posse.
- ReminderReceipt: tenant/provedor/messageId/status; avanço monotônico.
- IcloudCalendarIntegration: 1 por tenant; appleId/appPassword cifrados; calendarUrl + busyCalendarUrls; syncEnabled (envio) e checkAvailability (leitura) separados; authFailedAt para tudo; lastError = envio/leitura, connectionError = saúde.
- Appointment (iCloud): icloudEventUrl null = não enviado; icloudSyncAttempts/icloudNextAttemptAt = recuo 2–60 min.
- IcloudAgendaItem: só leitura, só título (sem DESCRIPTION/LOCATION); não é Appointment.
- CalendarFeatures.icloudEnabled: liga o espelho; cancelamento ignora a flag.

QR: clinicorpQrEnabled só true com QrRiskAcceptance atual e íntegro. Prova:
version, termsText, responsibleName, acceptedByUserId, acceptedAt; nome 3–120
caracteres com letras. Guarda no JSON, sem schema novo. Categorias por ID e
clinicorpQrConsentAt continuam exigidos para envio. Aceite não elimina bloqueio.
Meta exige template; canal conhecido não troca. AvailabilityUnavailableError
impede reservar sem disponibilidade; IDs externos strings, credenciais cifradas.
