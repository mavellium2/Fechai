# Agenda — Ações

| Entrada | Efeito |
|---|---|
| `createManualAppointment` | Valida dados, fuso, conflito e contato da própria conta. Permite agendamento fora do expediente cadastrado. |
| `cancelAppointmentAction` | Cancela compromisso da conta pelo repositório. A integração cuida das referências externas associadas. |
| `setConfirmedAction` | Registra ou remove confirmação de consulta futura, mantendo a dimensão de comparecimento. |
| `setAttendanceAction` | Confere consulta de pé e horário já ocorrido antes de gravar comparecimento ou falta. |
| `setClassificationAction` | Grava tipo declarado e procedimento, aceitando classificação vazia. |
| `saveAppointmentRemindersAction` | Valida a régua da consulta e mantém o que já foi enviado. |
| `appointmentConfirmationAction` | Envia ou registra confirmação manual com validação de conta ativa, consulta, data, janela e regras de envio. Reutiliza a fila e seu controle de duplicação. |
| Tools do agente | `list_available_slots` verifica vagas antes de oferecer horários. `schedule_meeting`, `reschedule_meeting` e `cancel_meeting` usam as regras da habilidade e do repositório. |

[Ações da agenda](../../../src/app/(dashboard)/agenda/actions.ts) · [Confirmação](../../../src/app/(dashboard)/agenda/confirmation-actions.ts) · [Tools](../../../src/modules/agent-engine/scheduling-tools.ts)
