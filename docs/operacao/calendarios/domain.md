# Integrações de calendário — Domínio

| Provedor | Modelo e comportamento |
|---|---|
| Google Agenda | `CalendarIntegration` guarda vínculo OAuth, `calendarId` e estado do envio. `Appointment.googleEventId` liga o evento espelhado ao compromisso. |
| Clinicorp | `ClinicorpIntegration` guarda credenciais HTTP Basic, clínica, profissional, categoria, `syncEnabled` e `checkAvailability`. `ClinicorpAppointmentSync` controla a reconciliação. `ClinicorpReminder` controla avisos de consultas externas. |
| Calendário da Apple | `IcloudCalendarIntegration` guarda Apple ID, senha de app cifrada, calendário de gravação, calendários de disponibilidade e estado de saúde. `Appointment.icloudEventUrl` identifica o evento. |

`CalendarFeatures` guarda a disponibilidade de cada integração na conta. A agenda local segue responsável pelo compromisso. As consultas criadas no Clinicorp e os eventos criados no iCloud chegam à grade como itens externos, sem virar `Appointment` ou entrar nos relatórios como agendamento local. As consultas do Clinicorp podem receber lembretes pela fila própria. Eventos externos do iCloud trazem só o título como dado descritivo e ficam fora da régua de lembretes.

[Schema Prisma](../../../prisma/schema.prisma) · [Contrato da agenda externa](../../../src/modules/scheduling/README.md)
