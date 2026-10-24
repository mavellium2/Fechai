import { monthRangeUtc } from "@/modules/scheduling/time";
import type { ReminderStatus } from "@/modules/scheduling/reminder-status";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { after } from "next/server";
import { Clock, UsersRound } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { describeSchedule, parseScheduleConfig } from "@/modules/scheduling/config";
import { isGoogleCalendarConfigured } from "@/modules/scheduling/google";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import {
  getClinicorpStatus,
  listClinicorpAgenda,
  type ClinicorpAgenda,
  type ClinicorpAgendaItem,
} from "@/modules/scheduling/clinicorp";
import { AGENDA_MAX_OCCURRENCES, getIcloudStatus, listIcloudAgenda, type IcloudAgenda, type IcloudAgendaItem } from "@/modules/scheduling/icloud";
import { placeIcloudItems } from "@/modules/scheduling/icloud-agenda-view";
import { listMonthAppointments, listMonthAppointmentReschedules } from "@/modules/scheduling/repository";
import { loadAppointmentOriginHours } from "@/modules/reports/origin-hours";
import { clockInZone, dayKeyInZone, todayInZone } from "@/modules/scheduling/time";
import { agendaVersion, monthDays, warmNeighborMonths } from "@/modules/scheduling/agenda-pulse";
import { AgendaLiveRefresh } from "./AgendaLiveRefresh";
import { leadStatusLabel } from "../conversas/leadStatus";
import { CalendarMonth } from "./CalendarMonth";
import { DayPanel, type DayEntry } from "./DayPanel";
import { NewAppointmentDialog, type ContactOption } from "./NewAppointmentDialog";
import { CalendarSyncStatus, type CalendarSyncItem } from "./CalendarSyncStatus";

/** As agendas de fora que a página espera juntas: Clinicorp e Calendário da Apple. */
type ExternalAgendas = [ClinicorpAgenda, IcloudAgenda];

/** Quantos contatos mostrar no painel lateral — o resto fica em /contatos. */
const SIDEBAR_CONTACTS = 6;

/** Espera uma promessa dentro de um `<Suspense>` e desenha com o valor. */
async function Await<T>({ promise, children }: { promise: Promise<T>; children: (value: T) => ReactNode | Promise<ReactNode> }) {
  return children(await promise);
}

/**
 * Agenda da conta: mês à esquerda, dia escolhido à direita.
 *
 * A ação "Agendar horário" existia como mock — trocava o status do lead e a
 * data combinada se perdia na conversa. Esta tela é o outro lado dela: o que o
 * agente marca no WhatsApp aparece aqui, junto do que foi marcado à mão.
 *
 * **Trocar de mês não espera o Clinicorp nem o iPhone.** A página sai com o que
 * está no nosso banco, e as agendas de lá (Clinicorp e Calendário da Apple)
 * entram juntas por streaming num `<Suspense>` com a chave do mês — chave nova
 * é o que faz o React mostrar o fallback na navegação, em vez de segurar a
 * tela antiga até um deles responder. Por isso calendário e dia são desenhados
 * duas vezes: com `agendas: null` (buscando) e com as agendas. Os meses
 * vizinhos já ficam aquecidos no cache do servidor (`after` +
 * `warmNeighborMonths`) e pré-carregados no navegador (`prefetch` em ‹ ›, ver
 * `CalendarMonth`). **Não mova a leitura de fora do Suspense.**
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; mes?: string; dia?: string; google?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { ano, mes, dia, google } = await searchParams;

  // Tudo que não depende do fuso sai junto com o agente: uma ida ao banco a
  // menos em série em cada troca de mês.
  const [primaryAgent, features, integration, clinicorp, icloud, contacts] = await Promise.all([
    // A configuração de horário do agente principal é a da conta: fuso e
    // duração padrão saem dela (ver módulo scheduling).
    prisma.agent.findFirst({
      where: { tenantId, archived: false },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        enabled: true,
        actions: { where: { key: "schedule_meeting" }, select: { enabled: true, config: true } },
      },
    }),
    getCalendarFeatures(tenantId),
    prisma.calendarIntegration.findUnique({ where: { tenantId } }),
    getClinicorpStatus(tenantId),
    getIcloudStatus(tenantId),
    prisma.lead.findMany({
      where: { tenantId, isTest: false },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, phone: true, status: true },
    }),
  ]);

  const scheduleAction = primaryAgent?.actions[0];
  const config = parseScheduleConfig(scheduleAction?.config);
  const today = todayInZone(config.timezone);

  // Parâmetros da URL são editáveis: qualquer coisa fora da faixa cai em hoje.
  const yearNum = Number(ano);
  const monthNum = Number(mes);
  const year = Number.isInteger(yearNum) && yearNum >= 1970 && yearNum <= 2999 ? yearNum : today.year;
  const month = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12 ? monthNum : today.month;

  const dayNum = Number(dia);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const selectedDay =
    Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= daysInMonth
      ? dayNum
      : year === today.year && month === today.month
        ? today.day
        : null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const { from, to } = monthDays(year, month);

  // Habilitado, com credencial legível e clínica escolhida: só então há o que
  // buscar lá. Sem isso a página nem entra no streaming.
  const clinicorpActive = Boolean(features.clinicorpEnabled && clinicorp?.businessId);
  // Começa já e NÃO é esperada aqui: entra pelo `<Suspense>` lá embaixo.
  const clinicorpAgenda: Promise<ClinicorpAgenda> = clinicorpActive
    ? listClinicorpAgenda(tenantId, from, to, config.timezone)
    : Promise.resolve({ status: "off" });
  // Calendário da Apple: habilitado, com calendário escolhido e senha ainda
  // válida (revogada, a tela já avisa e não há o que ler).
  const icloudActive = Boolean(features.icloudEnabled && icloud?.calendarUrl && !icloud.authFailedAt);
  const icloudAgenda: Promise<IcloudAgenda> = icloudActive
    ? listIcloudAgenda(tenantId, from, to, config.timezone)
    : Promise.resolve({ status: "off" });
  const externalActive = clinicorpActive || icloudActive;
  const externalAgendas: Promise<ExternalAgendas> = Promise.all([clinicorpAgenda, icloudAgenda]);
  const [{ rows: monthRows, byDay }, reschedules] = await Promise.all([
    listMonthAppointments(tenantId, year, month, config.timezone),
    listMonthAppointmentReschedules(tenantId, year, month, config.timezone),
  ]);
  const historyByDay = new Map<string, typeof reschedules>();
  for (const row of reschedules) {
    const key = dayKeyInZone(row.startsAt, config.timezone);
    historyByDay.set(key, [...(historyByDay.get(key) ?? []), row]);
  }
  const confirmationRange = monthRangeUtc(year, month, config.timezone);
  const confirmationRows = await prisma.reminderDispatch.findMany({ where: { tenantId,
    startsAt: { gte: confirmationRange.start, lt: confirmationRange.end } },
    orderBy: { updatedAt: "asc" }, select: { sourceKey: true, startsAt: true, state: true, reason: true, provider: true, deliveryStatus: true, acceptedAt: true, updatedAt: true } });
  const confirmationStatuses = new Map<string, ReminderStatus>(confirmationRows.map((r) => [`${r.sourceKey}|${r.startsAt.getTime()}`, {
    state: r.state, reason: r.reason, provider: r.provider, deliveryStatus: r.deliveryStatus, at: (r.acceptedAt ?? r.updatedAt).toISOString(),
  }]));


  // Depois da resposta: o mês anterior e o seguinte ficam no cache, e o
  // clique em ‹ › não espera as agendas externas.
  if (externalActive) after(() => warmNeighborMonths(tenantId, year, month, config.timezone));

  const hrefFor = ({
    year: y = year,
    month: m = month,
    day,
  }: {
    year?: number;
    month?: number;
    day?: number | null;
  }) => {
    const p = new URLSearchParams({ ano: String(y), mes: String(m) });
    if (day) p.set("dia", String(day));
    return `/agenda?${p}`;
  };

  // Só o ESTADO das integrações: conectar e configurar é em /integracoes.
  // Quem olha a agenda quer saber "o que eu marcar agora chega na clínica?".
  const syncItems: CalendarSyncItem[] = ([
    features.googleEnabled && isGoogleCalendarConfigured()
      ? {
          key: "google" as const,
          name: "Google Agenda",
          connected: Boolean(integration),
          sending: Boolean(integration?.syncEnabled),
          // O Google é espelho de mão única: só enviamos eventos para lá.
          receiving: false,
        }
      : null,
    features.icloudEnabled
      ? {
          key: "icloud" as const,
          name: "Calendário da Apple",
          connected: Boolean(icloud),
          sending: Boolean(icloud?.syncEnabled && icloud.calendarUrl),
          receiving: Boolean(icloud?.checkAvailability),
          // Senha revogada para tudo (inclusive a leitura); fora isso, o último erro do espelho.
          error: !icloud ? null
            : icloud.authFailedAt ? "A senha de app foi revogada ou o Apple ID mudou. Reconecte para voltar a enviar horários."
            : icloud.connectionError ?? icloud.lastError
              ?? (!icloud.calendarUrl ? "Escolha o calendário que recebe os horários em Integrações." : null),
        }
      : null,
    features.clinicorpEnabled
      ? {
          key: "clinicorp" as const,
          name: "Clinicorp",
          connected: Boolean(clinicorp),
          sending: Boolean(clinicorp?.syncEnabled),
          receiving: Boolean(clinicorp?.checkAvailability),
          error: clinicorp?.lastError ?? (clinicorp && !clinicorp.businessId ? "Escolha a clínica em Integrações." : null),
        }
      : null,
  ] as (CalendarSyncItem | null)[]).filter((x) => x !== null);

  const contactOptions: ContactOption[] = contacts.map((c) => ({
    id: c.id,
    label: c.name ? `${c.name} · ${c.phone}` : c.phone,
  }));

  const selectedKey = selectedDay ? `${year}-${pad(month)}-${pad(selectedDay)}` : null;
  // Só do dia aberto: é o único que a tela mostra, e a leitura nunca lança.
  const originByAppointment = await loadAppointmentOriginHours(tenantId, selectedKey ? byDay.get(selectedKey) ?? [] : []);
  const selectedLabel = selectedKey
    ? new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${selectedKey}T12:00:00Z`))
    : null;

  const dialog = {
    contacts: contactOptions,
    defaultDate: selectedKey ?? `${today.year}-${pad(today.month)}-${pad(today.day)}`,
    defaultDuration: config.durationMinutes,
    durations: config.durations,
    requiresContact: Boolean(features.clinicorpEnabled && clinicorp?.syncEnabled),
  };

  const local = {
    historyCount: reschedules.length,
    historyUpdate: reschedules.reduce<Date | null>((max, row) => !max || row.createdAt > max ? row.createdAt : max, null),
    reminderUpdate: confirmationRows.reduce<Date | null>((max, row) => !max || row.updatedAt > max ? row.updatedAt : max, null),
    count: monthRows.length,
    lastUpdate: monthRows.reduce<Date | null>((max, row) => (!max || row.updatedAt > max ? row.updatedAt : max), null),
  };
  const renderedDate = new Date();
  const renderedAt = renderedDate.getTime();
  const updatedAt = clockInZone(renderedDate, config.timezone);

  // `agendas: null` = as externas ainda estão chegando (fallback do Suspense).
  const liveRefresh = (agendas: ExternalAgendas | null) => {
    // Do cache, a leitura pode ser de minutos atrás: vale a mais antiga, e a tela confere na hora.
    const fetched = agendas ? agendas.filter((a) => a.status === "ok").map((a) => (a as { fetchedAt: number }).fetchedAt) : [];
    return (
      <AgendaLiveRefresh
        year={year}
        month={month}
        version={agendas ? agendaVersion(local, agendas[0], agendas[1]) : null}
        dataAsOf={agendas ? (fetched.length ? Math.min(...fetched) : renderedAt) : null}
        updatedAt={updatedAt}
      />
    );
  };

  const monthView = (agendas: ExternalAgendas | null, reminderSentAt: Map<string, Date>) => {
    const agenda = agendas?.[0] ?? null;
    const phone = agendas?.[1] ?? null;
    // O que o fechai já espelhou lá aparece uma vez só: como o nosso
    // compromisso, que tem lembretes e ações.
    const mirrored = new Set([...monthRows, ...reschedules].map((row) => row.clinicorpAppointmentId).filter(Boolean));
    const clinicorpByDay = new Map<string, ClinicorpAgendaItem[]>();
    if (agenda?.status === "ok") {
      for (const item of agenda.items) {
        if (mirrored.has(item.id)) continue;
        const key = dayKeyInZone(item.startsAt, config.timezone);
        clinicorpByDay.set(key, [...(clinicorpByDay.get(key) ?? []), item]);
      }
    }

    // Eventos do iPhone: os de fora, o que o fechai mesmo enviou (que não repete)
    // e o aviso de "horário alterado no iPhone" — ver `placeIcloudItems`.
    const { byDay: icloudByDay, movedOnPhone } = phone?.status === "ok"
      ? placeIcloudItems(
          phone.items,
          new Set([...monthRows.map((r) => r.id), ...reschedules.map((r) => r.appointmentId)]),
          monthRows,
          config.timezone,
        )
      : { byDay: new Map<string, IcloudAgendaItem[]>(), movedOnPhone: new Map<string, Date>() };

    const countByDay = new Map<string, number>();
    for (const [key, rows] of [...byDay, ...clinicorpByDay, ...icloudByDay, ...historyByDay]) {
      countByDay.set(key, (countByDay.get(key) ?? 0) + rows.length);
    }

    const entries: DayEntry[] = selectedKey
      ? [
          ...(byDay.get(selectedKey) ?? []).map((appointment) => ({ kind: "fechai" as const, at: appointment.startsAt, appointment })),
          ...(historyByDay.get(selectedKey) ?? []).map((history) => ({ kind: "reschedule" as const, at: history.startsAt, history })),
          ...(clinicorpByDay.get(selectedKey) ?? []).map((item) => ({ kind: "clinicorp" as const, at: item.startsAt, item })),
          ...(icloudByDay.get(selectedKey) ?? []).map((item) => ({ kind: "icloud" as const, at: item.startsAt, item })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime())
      : [];

    return (
      <>
        {/* Sem a leitura, o calendário mostraria dias livres que estão cheios lá. */}
        {agenda?.status === "error" && (
          <Alert tone="warn" title="Consultas do Clinicorp não carregaram">
            {agenda.error} O calendário abaixo mostra só o que foi marcado pelo fechai.
            A agenda tenta de novo sozinha a cada 15 segundos, ou clique em Atualizar.
          </Alert>
        )}
        {phone?.status === "error" && (
          <Alert tone="warn" title="Eventos do Calendário da Apple não carregaram">
            {phone.error} O calendário abaixo não mostra o que está no iPhone, e o agente só oferece horários se
            conseguir conferir lá. A agenda tenta de novo sozinha a cada 15 segundos, ou clique em Atualizar.
          </Alert>
        )}
        {phone?.status === "ok" && phone.skipped > 0 && (
          <Alert tone="info">
            {phone.skipped === 1
              ? "1 evento do Calendário da Apple não pôde ser lido e não aparece no calendário."
              : `${phone.skipped} eventos do Calendário da Apple não puderam ser lidos e não aparecem no calendário.`}{" "}
            Confira direto no iPhone.
          </Alert>
        )}
        {phone?.status === "ok" && phone.truncated && (
          <Alert tone="info">
            O iPhone tem mais de {AGENDA_MAX_OCCURRENCES} ocorrências neste mês (uma repetição sem fim, por exemplo).
            A agenda mostra só as primeiras.
          </Alert>
        )}
        {agenda?.status === "ok" && agenda.skipped > 0 && (
          <Alert tone="info">
            {agenda.skipped === 1
              ? "1 consulta do Clinicorp veio sem data ou horário legível e não aparece no calendário."
              : `${agenda.skipped} consultas do Clinicorp vieram sem data ou horário legível e não aparecem no calendário.`}{" "}
            Confira direto no Clinicorp.
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <Card className="p-4 lg:p-6 lg:col-span-7 xl:col-span-7">
            <CalendarMonth
              year={year}
              month={month}
              selectedDay={selectedDay}
              today={today}
              countByDay={countByDay}
              hrefFor={hrefFor}
              busy={agendas === null}
            />
          </Card>

          <DayPanel
            label={selectedLabel}
            isToday={selectedDay === today.day && month === today.month && year === today.year}
            entries={entries}
            externalLoading={agendas === null}
            timezone={config.timezone}
            clinicorpEnabled={features.clinicorpEnabled}
            // Mesma regra do worker: lembrete só sai com a ação ligada.
            agentReminders={scheduleAction?.enabled && config.reminderEnabled ? config.reminders : []}
            location={config.location}
            reminderSentAt={reminderSentAt}
            confirmationStatuses={confirmationStatuses}
            originByAppointment={originByAppointment}
            movedOnPhone={movedOnPhone}
            now={renderedDate}
            dialog={dialog}
          />
        </div>
      </>
    );
  };

  // A chave do mês é o que faz a navegação mostrar o fallback (o que já está
  // no banco) em vez de esperar o Clinicorp com a tela antiga congelada.
  const monthKey = `${year}-${month}`;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="agenda"
        title="Agenda"
        description={
          clinicorpActive || icloudActive
            ? `Os horários que seu agente marcou nas conversas, o que você marcar à mão${
                clinicorpActive && icloudActive ? ", as consultas do Clinicorp e os eventos do iPhone"
                  : clinicorpActive ? " e as consultas do Clinicorp" : " e os eventos do iPhone"}.`
            : "Os horários que seu agente marcou nas conversas, mais o que você marcar à mão."
        }
        actions={
          <>
            {externalActive ? (
              <Suspense key={monthKey} fallback={liveRefresh(null)}>
                <Await promise={externalAgendas}>{(agendas) => liveRefresh(agendas)}</Await>
              </Suspense>
            ) : (
              liveRefresh([{ status: "off" }, { status: "off" }])
            )}
            <NewAppointmentDialog {...dialog} />
          </>
        }
      />

      {/* Resultado da ida ao Google — a rota de callback devolve por query. */}
      {google === "conectado" && <Alert tone="success">Google Agenda conectado.</Alert>}
      {google === "cancelado" && (
        <Alert tone="info">Conexão com o Google cancelada. Nada foi alterado.</Alert>
      )}
      {google === "erro" && (
        <Alert tone="danger">
          Não conseguimos conectar ao Google Agenda. Tente de novo em alguns instantes.
        </Alert>
      )}
      {google === "indisponivel" && (
        <Alert tone="warn">
          A integração com o Google não está configurada nesta instalação.
        </Alert>
      )}

      {/* O caminho para o agente marcar sozinho, dito onde a dúvida aparece:
          quem abre a Agenda vazia precisa saber que existe um toggle a ligar. */}
      {primaryAgent && !scheduleAction?.enabled && (
        <Alert tone="info" title="Seu agente ainda não marca horários">
          A ação <strong className="font-medium">Agendar horário</strong> está desligada. Ligue no
          passo “Ações” do agente para ele combinar data e hora durante a conversa —{" "}
          <Link
            href={`/agentes/${primaryAgent.id}`}
            className="underline underline-offset-2 hover:text-white"
          >
            abrir {primaryAgent.name}
          </Link>
          .
        </Alert>
      )}

      {scheduleAction?.enabled && primaryAgent && !primaryAgent.enabled && (
        <Alert tone="warn">
          O agente está desligado, então ninguém está marcando horários pelas conversas.
        </Alert>
      )}

      {externalActive ? (
        <Suspense key={monthKey} fallback={monthView(null, new Map())}>
          <Await promise={externalAgendas}>
            {async (agendas) => monthView(agendas, await sentClinicorpReminders(tenantId, agendas[0]))}
          </Await>
        </Suspense>
      ) : (
        monthView([{ status: "off" }, { status: "off" }], new Map())
      )}

      {/* Linha de Apoio: Horário de atendimento, Sincronização e Contatos em 3 colunas */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <h2 className="font-display text-sm font-semibold text-white">
            Horário de atendimento
          </h2>
          <p className="mt-2 flex items-start gap-2 text-xs text-white/65">
            <Clock size={14} aria-hidden className="mt-0.5 shrink-0 text-white/40" />
            {describeSchedule(config)}
          </p>
          <p className="mt-1.5 font-mono text-micro text-white/45">Fuso: {config.timezone}</p>
          {primaryAgent && (
            <Link
              href={`/agentes/${primaryAgent.id}`}
              className="mt-2.5 inline-block font-mono text-micro uppercase tracking-[0.15em] text-signal underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris"
            >
              Mudar em Ações do agente →
            </Link>
          )}
        </Card>

        <CalendarSyncStatus items={syncItems} />

        <Card className="p-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold text-white">Contatos recentes</h2>
            <Link
              href="/contatos"
              className="shrink-0 font-mono text-micro uppercase tracking-wide text-iris underline underline-offset-4 hover:text-white"
            >
              Ver todos
            </Link>
          </div>

          {contacts.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="Nenhum contato ainda"
              description="Quando alguém falar com seu agente, aparece aqui."
              className="py-4"
            />
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {contacts.slice(0, SIDEBAR_CONTACTS).map((c) => {
                const status = leadStatusLabel(c.status);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/contatos?q=${encodeURIComponent(c.phone)}`}
                      className="flex items-center justify-between gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-white/85">
                          {c.name || c.phone}
                        </span>
                        {c.name && (
                          <span className="block truncate font-mono text-[10px] text-white/45">
                            {c.phone}
                          </span>
                        )}
                      </span>
                      <Badge tone={status.tone} className="shrink-0 text-[10px] px-1.5 py-0">
                        {status.label}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * "id|início" → quando saiu o lembrete de cada consulta do Clinicorp (ver
 * workers/follow-up-worker/clinicorp-reminders.ts). Só o que saiu de fato, e
 * pelo horário também: remarcada lá, o envio da data antiga não vale.
 */
async function sentClinicorpReminders(tenantId: string, agenda: ClinicorpAgenda): Promise<Map<string, Date>> {
  if (agenda.status !== "ok" || agenda.items.length === 0) return new Map();
  const rows = await prisma.clinicorpReminder.findMany({
    where: { tenantId, clinicorpAppointmentId: { in: agenda.items.map((item) => item.id) }, reminderSentAt: { not: null } },
    select: { clinicorpAppointmentId: true, reminderSentAt: true, startsAt: true },
  });
  return new Map(rows.map((r) => [`${r.clinicorpAppointmentId}|${r.startsAt.getTime()}`, r.reminderSentAt!]));
}
