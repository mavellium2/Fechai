# Agenda — Telas

| Entrada | Componentes e comportamento |
|---|---|
| `/agenda?ano=…&mes=…&dia=…` | `CalendarMonth` mostra a grade. `DayPanel` apresenta as consultas do dia e `AgendaLiveRefresh` atualiza quando a versão do mês muda. |
| Novo compromisso | `NewAppointmentDialog` recebe data, hora, duração, contato, classificação e notas. O Clinicorp com envio ativo exige contato com telefone. |
| Consulta do Fechai | Os controles de classificação, confirmação, comparecimento, cancelamento e lembretes dependem da situação e do horário da consulta. |
| Consulta externa | `ClinicorpAppointmentItem` e `IcloudEventItem` mostram itens externos. Confirmação do Clinicorp pode ter uma ação própria com as regras da fila. |
| Conexões | `CalendarSyncStatus` exibe o estado da integração e leva à configuração em `/integracoes?aba=calendarios`. |

O feedback de cadastro em diálogo modal usa `FormFeedback` no próprio formulário. [Página da agenda](../../../src/app/(dashboard)/agenda/page.tsx) · [Convenções de toast](../../../src/components/ui/toast/TOASTS.md)
