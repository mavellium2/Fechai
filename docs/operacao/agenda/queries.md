# Agenda — Queries

| Leitura | Contrato |
|---|---|
| `listMonthAppointments`, `listMonthAppointmentReschedules` | Buscam por conta e mês no fuso da agenda. A página monta a base local antes dos externos. |
| `listFreeSlots` | Aplica grade, pausas, antecedência e conflitos locais, do Clinicorp e do iCloud habilitados. |
| `hasConflictAnywhere` | Confere o intervalo imediatamente antes de marcar ou remarcar. Consultas externas habilitadas com resultado desconhecido geram `AvailabilityUnavailableError`. |
| `listClinicorpAgenda`, `listIcloudAgenda` | Lê itens para exibição. A deduplicação preserva o compromisso do Fechai quando também há espelho externo. |
| `GET /api/agenda/pulso?ano=…&mes=…` | Valida produto, conta e mês. `readAgendaPulse` devolve a versão para decidir se o cliente precisa recarregar. |

O calendário de exibição e a verificação de disponibilidade são leituras diferentes. Em disponibilidade, uma resposta externa `null` significa que o horário não pôde ser conferido. [Repositório da agenda](../../../src/modules/scheduling/repository.ts) · [Pulso](../../../src/modules/scheduling/agenda-pulse.ts)
