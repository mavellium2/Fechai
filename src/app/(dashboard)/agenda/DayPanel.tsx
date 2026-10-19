import { AppointmentConfirmation } from "./AppointmentConfirmation";
import type { ReminderStatus } from "@/modules/scheduling/reminder-status";
import type { ComponentProps } from "react";
import Link from "next/link";
import { CalendarX2, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { phoneLabel } from "@/lib/format";
import type { ClinicorpAgendaItem } from "@/modules/scheduling/clinicorp";
import type { ReminderRule } from "@/modules/scheduling/config";
import type { listMonthAppointments, listMonthAppointmentReschedules } from "@/modules/scheduling/repository";
import { parseReminderOverride } from "@/modules/scheduling/reminder-override";
import { timeInZone } from "@/modules/scheduling/time";
import {
  ATTENDANCE_LABELS,
  KIND_LABELS,
  ORIGIN_HOURS_LABELS,
  SITUATION_LABELS,
  SOURCE_LABELS,
  attendanceOf,
  canConfirm,
  canMarkAttendance,
  parseKind,
  situationOf,
  sourceOf,
  type OriginHours,
} from "@/modules/scheduling/dimensions";
import { AppointmentActions } from "./AppointmentActions";
import { AppointmentClassification } from "./AppointmentClassification";
import { AppointmentReminders } from "./AppointmentReminders";
import { ClinicorpAppointmentItem } from "./ClinicorpAppointmentItem";
import { AppointmentRescheduleItem } from "./AppointmentRescheduleItem";
import { NewAppointmentDialog } from "./NewAppointmentDialog";

type MonthAppointment = Awaited<ReturnType<typeof listMonthAppointments>>["rows"][number];

/** Um item da lista do dia: compromisso do fechai ou consulta lida do Clinicorp. */
export type DayEntry =
  | { kind: "fechai"; at: Date; appointment: MonthAppointment }
  | { kind: "reschedule"; at: Date; history: Awaited<ReturnType<typeof listMonthAppointmentReschedules>>[number] }
  | { kind: "clinicorp"; at: Date; item: ClinicorpAgendaItem };

/**
 * O dia escolhido, à direita do calendário.
 *
 * Separado da página porque é desenhado duas vezes na troca de mês: primeiro
 * só com o que está no nosso banco (`clinicorpLoading`), na hora, e de novo
 * quando a agenda do Clinicorp chega por streaming — ver `page.tsx`.
 */
export function DayPanel({
  label,
  isToday,
  entries,
  clinicorpLoading,
  timezone,
  clinicorpEnabled,
  agentReminders,
  location,
  reminderSentAt,
  confirmationStatuses,
  originByAppointment,
  now,
  dialog,
}: {
  label: string | null;
  isToday: boolean;
  entries: DayEntry[];
  /** A agenda do Clinicorp ainda está chegando: a lista pode crescer. */
  clinicorpLoading: boolean;
  timezone: string;
  clinicorpEnabled: boolean;
  /** Lembretes gerais da conta, já vazios quando a ação está desligada. */
  agentReminders: ReminderRule[];
  location: string;
  /** "id|início" → quando o lembrete saiu (consultas do Clinicorp). */
  reminderSentAt: Map<string, Date>;
  confirmationStatuses: Map<string, ReminderStatus>;
  /** Horário de origem por compromisso, calculado na leitura (`originHours`). */
  originByAppointment: Map<string, OriginHours>;
  /** Um relógio só para a lista inteira: o que é "passado" não muda no meio do desenho. */
  now: Date;
  dialog: Omit<ComponentProps<typeof NewAppointmentDialog>, "triggerLabel">;
}) {
  const dayStatuses = entries.filter((entry) => entry.kind !== "reschedule").map((entry) => {
    const source = entry.kind === "clinicorp" ? `clinicorp:${entry.item.id}` : entry.appointment.clinicorpAppointmentId ? `clinicorp:${entry.appointment.clinicorpAppointmentId}` : `appointment:${entry.appointment.id}`;
    return confirmationStatuses.get(`${source}|${entry.at.getTime()}`);
  });
  const handledCount = dayStatuses.filter((s) => s?.state === "sent" || s?.state === "manual").length;
  const attentionCount = dayStatuses.filter((s) => s?.state === "unknown" || s?.state === "blocked" || s?.deliveryStatus === "failed").length;
  const clinicorpCount = entries.filter((e) => e.kind === "clinicorp").length;

  return (
    <Card className="flex flex-col p-5 lg:p-6 lg:col-span-5 xl:col-span-5 max-h-[33rem]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3.5 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold capitalize text-white">
              {label ?? "Escolha um dia"}
            </h2>
            {isToday && (
              <span className="rounded-control bg-iris/20 px-2 py-0.5 font-mono text-micro uppercase tracking-wider text-iris">
                Hoje
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-micro uppercase tracking-wider text-white/45">
            {entries.length} {entries.length === 1 ? "registro na agenda" : "registros na agenda"}
            {clinicorpCount > 0 && ` · ${clinicorpCount} no Clinicorp`}
            {clinicorpLoading && " · buscando no Clinicorp…"}
          </p>
        </div>

        {entries.length > 0 && <NewAppointmentDialog {...dialog} triggerLabel="+ Agendar" />}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <EmptyState
              icon={CalendarX2}
              title={clinicorpLoading ? "Buscando consultas do Clinicorp" : "Nenhum horário marcado"}
              description={
                clinicorpLoading
                  ? "Nada marcado pelo fechai neste dia. As consultas do Clinicorp aparecem aqui em instantes."
                  : "Quando o agente agendar no WhatsApp, o horário aparece aqui automaticamente."
              }
              action={<NewAppointmentDialog {...dialog} triggerLabel="Marcar horário neste dia" />}
              className="py-2"
            />
          </div>
        ) : (
          <>
          {agentReminders.length > 0 && <p className="mb-3 text-xs text-white/60">Confirmações: {handledCount} tratadas · {attentionCount} exigem conferência. Os demais aguardam o horário ou a seleção de categoria.</p>}
          <ul className="space-y-3">
            {entries.map((entry) => {
              if (entry.kind === "reschedule") return <AppointmentRescheduleItem key={`reschedule-${entry.history.id}`} history={entry.history} timezone={timezone} />;
              if (entry.kind === "clinicorp") {
                return (
                  <ClinicorpAppointmentItem
                    key={`clinicorp-${entry.item.id}`}
                    item={entry.item}
                    timezone={timezone}
                    confirmationsEnabled={agentReminders.length > 0}
                    confirmationStatus={confirmationStatuses.get(`clinicorp:${entry.item.id}|${entry.item.startsAt.getTime()}`)}
                    // Pelo horário também: remarcada lá, o envio da data antiga não vale.
                    reminderSentAt={reminderSentAt.get(`${entry.item.id}|${entry.item.startsAt.getTime()}`) ?? null}
                  />
                );
              }
              const { appointment } = entry;
              const leadDisplayName = appointment.patientName || appointment.lead?.name || appointment.lead?.phone || appointment.title;
              const avatarInitial = leadDisplayName.slice(0, 1).toUpperCase();

              // Cada dimensão é uma pergunta própria (ver modules/scheduling/dimensions.ts):
              // a faixa segue o que mais importa agora — cancelada, faltou, compareceu, de pé.
              const situation = situationOf(appointment);
              const attendance = attendanceOf(appointment);
              const kind = parseKind(appointment.kind);
              const origin = originByAppointment.get(appointment.id) ?? "unclassified";
              const past = appointment.startsAt.getTime() <= now.getTime();
              const statusConfig =
                situation === "canceled"
                  ? { text: SITUATION_LABELS.canceled, color: "text-danger", bar: "bg-danger" }
                  : attendance === "no_show"
                    ? { text: SITUATION_LABELS[situation], color: "text-warn", bar: "bg-warn" }
                    : attendance === "attended"
                      ? { text: SITUATION_LABELS[situation], color: "text-white/50", bar: "bg-white/25" }
                      : { text: SITUATION_LABELS[situation], color: "text-success", bar: "bg-success" };
              const dimensions = [
                { label: "Tipo", value: kind ? KIND_LABELS[kind] : "Não classificado", muted: !kind },
                ...(appointment.procedure ? [{ label: "Procedimento", value: appointment.procedure, muted: false }] : []),
                ...(situation !== "canceled" && !past
                  ? [{ label: "Confirmação", value: appointment.confirmedAt ? "Confirmado" : "Não confirmado", muted: !appointment.confirmedAt }]
                  : []),
                // Comparecimento só existe depois do horário (ou se alguém já marcou).
                ...(situation !== "canceled" && (past || attendance !== "unknown")
                  ? [{ label: "Comparecimento", value: ATTENDANCE_LABELS[attendance], muted: attendance === "unknown" }]
                  : []),
                { label: "Origem", value: SOURCE_LABELS[sourceOf(appointment.source)], muted: false },
                { label: "Horário de origem", value: ORIGIN_HOURS_LABELS[origin], muted: origin === "unclassified" },
              ];

              return (
                <li
                  key={appointment.id}
                  className="relative flex flex-col gap-3 rounded-surface border border-white/10 bg-white/5 p-3.5 transition-all duration-150 hover:border-white/20 hover:bg-white/[0.08]"
                >
                  {/* Faixa indicadora de urgência/status na borda esquerda */}
                  <span
                    aria-hidden
                    className={cn("absolute left-0 top-3 bottom-3 w-1 rounded-full", statusConfig.bar)}
                  />

                  <div className="flex min-w-0 flex-1 items-start gap-3 pl-1.5">
                    {/* Avatar / Inicial do Lead */}
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-xs font-semibold uppercase text-white/80"
                    >
                      {avatarInitial}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-control border border-iris/30 bg-iris/15 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-iris">
                          {timeInZone(appointment.startsAt, timezone)}–
                          {timeInZone(appointment.endsAt, timezone)}
                        </span>
                        <span className="truncate font-semibold text-white text-sm">{appointment.title}</span>

                        {/* Situação como texto discreto (padrão conversas) */}
                        <span className={cn("font-mono text-micro uppercase tracking-wider font-medium ml-1", statusConfig.color)}>
                          {statusConfig.text}
                        </span>
                      </div>

                      <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                        {dimensions.map((d) => (
                          <div key={d.label} className="flex items-baseline gap-1 text-xs">
                            <dt className="font-mono text-micro uppercase tracking-wider text-white/40">{d.label}</dt>
                            <dd className={d.muted ? "text-white/45" : "text-white/80"}>{d.value}</dd>
                          </div>
                        ))}
                      </dl>

                      {appointment.lead && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
                          <span className="flex items-center gap-1 font-mono text-micro uppercase tracking-wider text-white/70">
                            <User size={12} aria-hidden className="text-white/40" />
                            Contato: {appointment.lead.name ? `${appointment.lead.name} · ` : ""}{phoneLabel(appointment.lead.phone)}
                          </span>
                          <Link
                            href={`/conversas?q=${encodeURIComponent(appointment.lead.phone)}`}
                            className="font-mono text-micro uppercase tracking-wide text-iris hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris"
                          >
                            Ver conversa →
                          </Link>
                        </div>
                      )}

                      {appointment.notes && (
                        <p className="mt-1.5 whitespace-pre-line rounded-control border border-white/5 bg-black/20 px-2.5 py-1 text-xs leading-relaxed text-white/70">
                          {appointment.notes}
                        </p>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        {appointment.googleEventId && (
                          <span className="inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-wide text-white/40">
                            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                            Google Agenda
                          </span>
                        )}

                        {appointment.status === "scheduled" && clinicorpEnabled && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-wide",
                              appointment.clinicorpAppointmentId ? "text-success" : "text-warn"
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                appointment.clinicorpAppointmentId ? "bg-success" : "bg-warn"
                              )}
                            />
                            {appointment.clinicorpAppointmentId
                              ? "Clinicorp enviado"
                              : appointment.clinicorpSync && ["queued", "processing", "retry"].includes(appointment.clinicorpSync.state)
                                ? "Enviando ao Clinicorp"
                                : "Envio ao Clinicorp não confirmado"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Legado `done` também entra: é uma consulta de pé com comparecimento marcado. */}
                  {situation !== "canceled" && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 pt-2 sm:border-t-0 sm:pt-0">
                      <AppointmentClassification
                        id={appointment.id}
                        title={appointment.title}
                        kind={kind}
                        procedure={appointment.procedure}
                      />
                      {!past && (parseReminderOverride(appointment.reminderOverride) ?? agentReminders).length > 0 && <AppointmentConfirmation timezone={timezone} id={appointment.id} source="appointment" startsAt={appointment.startsAt.toISOString()} status={confirmationStatuses.get(`${appointment.clinicorpAppointmentId ? `clinicorp:${appointment.clinicorpAppointmentId}` : `appointment:${appointment.id}`}|${appointment.startsAt.getTime()}`)} />}
                      {!past && <AppointmentReminders
                        id={appointment.id}
                        title={appointment.title}
                        override={parseReminderOverride(appointment.reminderOverride)}
                        agentReminders={agentReminders}
                        location={location}
                        lastSentAt={appointment.reminderSentAt}
                        closedCount={appointment.remindersSent.length}
                      />}
                      <AppointmentActions
                        id={appointment.id}
                        title={appointment.title}
                        confirmed={Boolean(appointment.confirmedAt)}
                        attendance={attendance}
                        canConfirm={canConfirm(appointment, now)}
                        canMarkAttendance={canMarkAttendance(appointment, now)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </>
        )}
      </div>
    </Card>
  );
}
