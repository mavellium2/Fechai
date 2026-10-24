import { Apple } from "lucide-react";
import type { IcloudAgendaItem } from "@/modules/scheduling/icloud";
import { timeInZone } from "@/modules/scheduling/time";

/**
 * Evento marcado direto no Calendário da Apple (iPhone), na lista do dia.
 *
 * **Só leitura e só o título**: DESCRIPTION e LOCATION nunca chegam aqui (são do
 * dono do calendário, e podem ter coisa pessoal). Não é `Appointment` — sem
 * relatório, ação ou lembrete —, e por isso o item diz que não há lembrete
 * automático: quem lê "iPhone" na lista não pode supor que o paciente será avisado.
 */
export function IcloudEventItem({ item, timezone }: { item: IcloudAgendaItem; timezone: string }) {
  return (
    <li className="relative flex flex-col gap-3 rounded-surface border border-white/10 bg-white/[0.03] p-3.5">
      <span aria-hidden className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-white/30" />

      <div className="flex min-w-0 flex-1 items-start gap-3 pl-1.5">
        <span
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80"
        >
          <Apple size={14} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-control border border-iris/30 bg-iris/15 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-iris">
              {item.allDay ? "Dia inteiro" : (
                <>
                  {timeInZone(item.startsAt, timezone)}
                  {item.endsAt && `–${timeInZone(item.endsAt, timezone)}`}
                </>
              )}
            </span>
            <span className="truncate text-sm font-semibold text-white">{item.title}</span>
            <span className="ml-1 font-mono text-micro font-medium uppercase tracking-wider text-white/55">
              • no iPhone · {item.calendarName}
            </span>
            {item.free && (
              <span className="font-mono text-micro uppercase tracking-wider text-white/45">livre</span>
            )}
          </div>

          <p className="mt-1.5 text-xs text-white/45">
            Para alterar, use o Calendário do iPhone. Sem lembrete automático.
            {item.free ? " Marcado como livre: não bloqueia horário do agente." : ""}
          </p>
        </div>
      </div>
    </li>
  );
}
