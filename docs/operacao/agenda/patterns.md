# Agenda — Padrões de código

## Disponibilidade e tempo

- Use `time.ts` para converter dados locais e definir o intervalo do mês. Para gravar, valide o intervalo com `hasConflictAnywhere` mesmo que `listFreeSlots` já tenha mostrado o horário.
- A leitura externa indisponível impede propor ou confirmar vaga. Uma consulta local já combinada é preservada quando o espelho falha. Na remarcação do Clinicorp, uma recusa do novo horário pode restaurar a reserva anterior, inclusive a confirmação.
- Tools no chat de teste usam `dryRun`. Conferem as regras e a disponibilidade com dados reais, preservando agenda e espelhos.

## Navegação e lembretes

- Mantenha a leitura mensal do Clinicorp atrás de `Suspense` com chave do mês e o aquecimento dos vizinhos via `after()`. O pulso (15 s) é um `fetch` comum e chama `router.refresh()` apenas quando a versão muda.
- Use `validateReminders` e `renderReminder`. As regras antigas com `reminderMinutesBefore` e `reminderTemplate` ainda são lidas. A fila ignora consultas passadas e, se vários avisos vencerem juntos, envia o mais próximo da consulta.
- Preserve `ReminderDispatch` na confirmação automática e manual, inclusive no espelho Clinicorp. Resultado incerto pede conferência, sem reenvio automático. Envio aceito e entrega têm registros próprios.

[Helpers de tempo](../../../src/modules/scheduling/time.ts) · [Testes da agenda](../../../tests/agenda-pulse.test.ts) · [Worker de lembretes](../../../workers/follow-up-worker/reminders.ts)
