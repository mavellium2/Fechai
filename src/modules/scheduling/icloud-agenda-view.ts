import type { IcloudAgendaItem } from "./icloud";
import { appointmentIdFromUid } from "./ical";
import { dayKeyInZone, partsInZone, zonedTimeToUtc } from "./time";

/**
 * Como os eventos do iPhone entram na `/agenda`. Funções puras: a página só
 * monta os dados e chama aqui.
 */

/**
 * Os dias locais em que um evento aparece. Evento com hora entra no dia em que
 * começa; dia inteiro (férias de 3 dias) entra em cada dia que cobre.
 */
export function icloudDayKeys(item: Pick<IcloudAgendaItem, "startsAt" | "endsAt" | "allDay">, timeZone: string): string[] {
  const keys = [dayKeyInZone(item.startsAt, timeZone)];
  if (!item.allDay || !item.endsAt) return keys;
  const p = partsInZone(item.startsAt, timeZone);
  for (let k = 1; k <= 31; k++) {
    const start = zonedTimeToUtc(p.year, p.month, p.day + k, 0, 0, timeZone);
    if (start >= item.endsAt) break;
    keys.push(dayKeyInZone(start, timeZone));
  }
  return keys;
}

export type OwnAppointment = { id: string; status: string; startsAt: Date; endsAt: Date };

/**
 * Separa o que o iPhone tem em três coisas:
 *
 * - **eventos de fora**, agrupados por dia, que a tela mostra como só leitura
 *   (só o título — o módulo nem entrega descrição ou local);
 * - **os que o próprio fechai enviou** (`fechai-<id>`), que NÃO repetem: a
 *   consulta ativa, ou a que mudou de horário neste mês, já aparece como o nosso
 *   compromisso. UID do fechai sem consulta correspondente aparece normal;
 * - **consultas cujo evento está em outro horário no iPhone** (`movedOnPhone`):
 *   alguém arrastou o evento lá. O fechai continua sendo a fonte da verdade —
 *   nada volta para o iPhone nem para a consulta; só vira um aviso.
 *
 * `ownIds` são as consultas do mês e as do histórico de remarcação do mês;
 * `rows` as consultas do mês (as únicas que podem ter o evento comparado).
 */
export function placeIcloudItems(
  items: IcloudAgendaItem[],
  ownIds: Set<string>,
  rows: OwnAppointment[],
  timeZone: string,
): { byDay: Map<string, IcloudAgendaItem[]>; movedOnPhone: Map<string, Date> } {
  const byDay = new Map<string, IcloudAgendaItem[]>();
  const ours = new Map<string, IcloudAgendaItem[]>();
  for (const item of items) {
    const id = appointmentIdFromUid(item.uid);
    if (id && ownIds.has(id)) {
      ours.set(id, [...(ours.get(id) ?? []), item]);
      continue;
    }
    for (const key of icloudDayKeys(item, timeZone)) byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }

  const movedOnPhone = new Map<string, Date>();
  for (const row of rows) {
    const found = ours.get(row.id);
    if (!found || row.status !== "scheduled") continue;
    const same = found.some(
      (i) => i.startsAt.getTime() === row.startsAt.getTime() && (!i.endsAt || i.endsAt.getTime() === row.endsAt.getTime()),
    );
    if (!same) movedOnPhone.set(row.id, found[0].startsAt);
  }
  return { byDay, movedOnPhone };
}
