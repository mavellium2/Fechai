# Integrações de calendário — Telas

| Local | Componente | Configuração |
|---|---|---|
| `/integracoes?aba=calendarios` | `CalendarFeatureToggles` | Habilita cada provedor e apresenta o formulário no próprio card pela prop `panels`. |
| Google Agenda | `GoogleCalendarCard` | Conectar por OAuth, ligar ou pausar envio e desconectar. |
| Clinicorp | `ClinicorpCard` | Autenticar com usuário e token de API, selecionar clínica, profissional e categoria e configurar envio e disponibilidade. |
| Calendário da Apple | `IcloudCalendarCard` | Informar Apple ID e senha de app, escolher calendário de envio e calendários ocupados. Exibe falhas e estado da conexão. |
| `/agenda` | `CalendarSyncStatus`, `ClinicorpAppointmentItem`, `IcloudEventItem` | Estado com link para gerenciamento, itens externos e avisos de leitura. |

[Página de integrações](../../../src/app/(dashboard)/integracoes/page.tsx) · [Página da agenda](../../../src/app/(dashboard)/agenda/page.tsx)
