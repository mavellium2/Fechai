# Integrações de calendário — Queries

| Leitura | Uso |
|---|---|
| `getCalendarFeatures` | Carrega flags por conta. Sem registro, todos os provedores começam desabilitados. |
| `getClinicorpStatus`, `getIcloudStatus` | Estado operacional e campos de configuração da conta, sem os segredos de autenticação. |
| `listClinicorpBusinesses`, `listClinicorpProfessionals`, `listClinicorpCategories`, `listIcloudCalendars` | Opções de configuração consultadas no provedor. |
| `listClinicorpAgenda`, `listIcloudAgenda` | Leitura mensal para a grade. Erro de leitura aparece na tela e não grava `lastError`. A agenda de exibição tem cache próprio. |
| `listClinicorpBusyBlocks`, `listIcloudBusyBlocks` | Reservas externas para validar disponibilidade. O iCloud consulta sem cache. Falha devolve `null`. |

O Google funciona como espelho de envio. O calendário de disponibilidade combina a base local e os provedores de leitura habilitados. Cada leitura resolve o escopo pela conta autenticada ou pelo tenant explícito do job. [Google](../../../src/modules/scheduling/google.ts) · [Clinicorp](../../../src/modules/scheduling/clinicorp.ts) · [iCloud](../../../src/modules/scheduling/icloud.ts)
