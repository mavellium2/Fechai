import Link from "next/link";
import { phoneLabel } from "@/lib/format";
import type { listMonthAppointmentReschedules } from "@/modules/scheduling/repository";
import { dayKeyInZone, formatInZone, timeInZone } from "@/modules/scheduling/time";

type History = Awaited<ReturnType<typeof listMonthAppointmentReschedules>>[number];

/** Registro do horário liberado; nunca oferece ações de uma consulta ativa. */
export function AppointmentRescheduleItem({ history, timezone }: { history: History; timezone: string }) {
  const [ano, mes, dia] = dayKeyInZone(history.nextStartsAt, timezone).split("-");
  return (
    <li className="relative rounded-surface border border-white/10 bg-white/[0.03] p-3.5 pl-5">
      <span aria-hidden className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-warn" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs text-white/70">{timeInZone(history.startsAt, timezone)}–{timeInZone(history.endsAt, timezone)}</span>
        <span className="text-sm font-semibold text-white">{history.appointment.patientName || history.appointment.title}</span>
        <span className="font-mono text-micro uppercase tracking-wider text-warn">Remarcado</span>
      </div>
      <p className="mt-1.5 text-xs text-white/75">
        Horário original preservado. Nova data escolhida: {" "}
        <Link className="text-iris hover:underline" href={`/agenda?ano=${ano}&mes=${mes}&dia=${dia}`}>
          {formatInZone(history.nextStartsAt, timezone)}
        </Link>.
      </p>
      <p className="mt-1 text-xs text-white/50">Remarcação registrada em {formatInZone(history.createdAt, timezone)}. Horário liberado; sem lembretes.</p>
      {history.appointment.lead && <p className="mt-1 text-xs text-white/60">
        Contato: {history.appointment.lead.name ? `${history.appointment.lead.name} · ` : ""}{phoneLabel(history.appointment.lead.phone)}
      </p>}
      {history.notes && <p className="mt-1.5 whitespace-pre-line text-xs text-white/60">{history.notes}</p>}
    </li>
  );
}
