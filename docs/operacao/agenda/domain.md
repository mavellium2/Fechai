# Agenda — Domínio

| Conceito | Contrato |
|---|---|
| `Appointment` | Compromisso por conta, com início e fim, contato opcional, origem e referências de espelhos externos. |
| `AppointmentReschedule` | Histórico da remarcação, exibido junto da agenda do mês. |
| `ScheduleConfig` | Fuso, grade semanal, feriados, antecedência, duração e lembretes na chave `schedule_meeting` de `TenantAction.config`. |
| `ReminderDispatch` | Controle do envio, confirmação manual, resultado incerto e recibo de cada aviso. |

| Dimensão da consulta | Campo e regra |
|---|---|
| Tipo e procedimento | `kind` guarda avaliação, retorno ou procedimento. `procedure` guarda texto. Ambos dependem de informação explícita. |
| Situação | `status` define se a consulta segue de pé (`scheduled`) ou foi cancelada (`canceled`). Remarcação usa `rescheduledAt`. |
| Confirmação | `confirmedAt`, para consulta futura e de pé. Remarcar remove a confirmação anterior. |
| Comparecimento | `attendance` inicia `unknown`. Marcação só depois do horário. `attendanceOf` ainda reconhece o legado `done`. |
| Origem | `source` distingue agente, manual e integração. O expediente de origem é calculado na leitura. |

`reminderOverride: null` segue a configuração do agente principal. `[]` dispensa os lembretes da consulta. Uma lista preenchida usa os próprios avisos do compromisso. `remindersSent` guarda as antecedências já enviadas para aquela consulta.

Veja [dimensões e lembretes no módulo de agenda](../../../src/modules/scheduling/README.md) e [schema Prisma](../../../prisma/schema.prisma).
