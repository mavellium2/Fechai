# Agenda

A equipe e o agente consultam horários, marcam compromissos e acompanham confirmação, comparecimento e lembretes por consulta.

| Aspecto | Onde fica |
|---|---|
| Tela | `/agenda` |
| Configuração do agente | Habilidade de agendamento em `/agentes` (`schedule_meeting`) |
| Dados | `Appointment`, `AppointmentReschedule`, `TenantAction.config`, `ReminderDispatch` |
| Lógica | [Módulo de agenda](../../../src/modules/scheduling/README.md) e [worker](../../../workers/follow-up-worker/README.md) |
| Conexões externas | [Calendários](../calendarios/_index.md) e [WhatsApp](../whatsapp/_index.md) |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Queries](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

1. A agenda do Fechai é a fonte da verdade. Consulte `hasConflictAnywhere` para validar o horário, incluindo calendários externos habilitados.
2. Confirmação, comparecimento e situação são dimensões independentes. Remarcar limpa a confirmação do horário anterior.
3. Os lembretes gerais vêm do agente principal. Cada consulta pode substituí-los ou dispensá-los.
