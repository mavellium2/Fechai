/**
 * Pausa dos lembretes da conta por campanha (`CampaignRules.pauseAllReminders`).
 *
 * Pedido da clínica num evento: "nos dias da campanha não manda lembrete para
 * ninguém, nem para quem eu remarcar; no dia seguinte volta ao normal". A regra
 * comum de lembretes da campanha só alcança os leads dela — paciente marcado
 * direto no Clinicorp, ou de fora da campanha, seguiria recebendo. A pausa vale
 * para a conta inteira e acaba sozinha no fim da campanha.
 *
 * Duas regras, e as duas são necessárias:
 *
 * - **Nada sai durante a pausa** (`activePause`): nem o lembrete do horário,
 *   nem o da consulta remarcada (que, sem a pausa, sai na hora porque o horário
 *   do disparo já passou).
 * - **O que venceu dentro da pausa não sai depois** (`pausedDue`): o "1 dia
 *   antes" de uma consulta do dia seguinte ao fim da campanha vence no último dia
 *   dela; terminar a pausa às 23:59 não pode liberar esse envio às 23:59:30.
 *   Fica suspenso até perder a janela e então é fechado sem envio, como sempre.
 *
 * Puro: sem banco e sem relógio escondido. Quem lê as campanhas é
 * `loadReminderPauses` (`active.ts`). Envio explícito da equipe (botão da
 * Agenda) não passa por aqui: é escolha de uma pessoa.
 */

export type ReminderPause = {
  campaignId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
};

function within(pause: ReminderPause, at: Date): boolean {
  return pause.startsAt.getTime() <= at.getTime() && at.getTime() <= pause.endsAt.getTime();
}

/** A pausa que vale neste instante, ou null. */
export function activePause(pauses: readonly ReminderPause[], now: Date): ReminderPause | null {
  return pauses.find((pause) => within(pause, now)) ?? null;
}

/** O disparo venceu dentro de uma pausa? Então não sai — nem depois que ela acaba. */
export function pausedDue(pauses: readonly ReminderPause[], dueAt: Date): ReminderPause | null {
  return pauses.find((pause) => within(pause, dueAt)) ?? null;
}

/** As duas regras juntas: a pausa que barra este disparo agora, ou null. */
export function reminderPausedBy(pauses: readonly ReminderPause[], dueAt: Date, now: Date): ReminderPause | null {
  return activePause(pauses, now) ?? pausedDue(pauses, dueAt);
}
