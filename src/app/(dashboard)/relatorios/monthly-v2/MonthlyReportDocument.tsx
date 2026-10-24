import type { ReactNode } from "react";
import type { MonthlyReport } from "@/modules/reports/monthly";
import { monthlyFinancialPresentation } from "@/modules/reports/monthly-data";
import type { Metric, MetricStatus, MonthlyReportData, Split } from "@/modules/reports/monthly-data";
import { AGENT_CHANGE_LABELS } from "@/modules/reports/monthly-agent-changes";
import { ACTION_STATUS_LABEL, type ActionStatus } from "@/modules/reports/monthly-previous-actions";
import { caseFactItems } from "@/modules/reports/monthly-case";
import { NO_PROBLEMS, STATUS_SEAL, attendanceSummary, deltaLabel, formatCount, formatPercent, formatReais, formatSpan, hoursLabel, humanClosedDatesLabel, openingSentence, periodLabel, problemText } from "@/modules/reports/monthly-format";
import { SUGGESTION_DISCLAIMER } from "@/modules/lead-insights/summary";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

/*
 * O relatório mensal v2, como o decisor da clínica recebe: uma folha só, na
 * ordem em que ele lê. É a MESMA árvore no painel e no PDF (a rota de
 * impressão renderiza este componente e o Chromium imprime), então o que a
 * Mavellium aprova é exatamente o que chega.
 *
 * Regras: nenhum número é calculado aqui (tudo vem de `report.data`, as
 * larguras das barras são só proporção para desenhar); nada de componente de
 * admin nem de nota interna; a folha é sempre clara, mesmo dentro do painel
 * escuro, por isso não usa os primitivos com variante `panel:`.
 */

const OWNER_ROLE: Record<string, string> = { owner: "dono", partner: "sócio" };

function Seal({ status }: { status: MetricStatus }) {
  const label = STATUS_SEAL[status];
  if (!label) return null;
  return <span className="ml-1.5 inline-block rounded-full bg-warn/15 px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-amber-800">{label}</span>;
}

/** "126 no expediente · 88 fora"; sem expediente cadastrado, nada (só o total vale). */
const splitLine = (s: Split) => s.inside.value === null || s.outside.value === null ? null
  : `${formatCount(s.inside.value)} no expediente · ${formatCount(s.outside.value)} fora`;

function Block({ number, title, tag, className, children }: { number: string; title: string; tag?: string; className?: string; children: ReactNode }) {
  return <section className={cn("space-y-4", className)}>
    {/* O título nunca fica sozinho no fim de uma página. */}
    <div className="flex items-baseline gap-3 border-b border-ink/15 pb-2 break-after-avoid">
      <span className="font-mono text-xs font-medium text-iris">{number}</span>
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      {tag && <span className="ml-auto font-mono text-micro uppercase tracking-[0.15em] text-neutral">{tag}</span>}
    </div>
    {children}
  </section>;
}

function Kpi({ label, value, sub, delta, anchor }: { label: string; value: string; sub?: string | null; delta?: string | null; anchor?: boolean }) {
  return <div className={cn("space-y-1 p-4", anchor ? "bg-iris text-white" : "bg-white")}>
    <p className={cn("font-mono text-micro font-medium uppercase tracking-[0.12em]", anchor ? "text-white/80" : "text-neutral")}>{label}</p>
    <p className="font-display text-4xl font-bold leading-none tabular-nums">{value}</p>
    {sub && <p className={cn("text-xs", anchor ? "text-white/85" : "text-neutral")}>{sub}</p>}
    {delta && <p className={cn("text-xs font-semibold", anchor ? "text-white" : "text-iris")}>{delta}</p>}
  </div>;
}

function Figure({ value, label }: { value: string; label: string }) {
  return <div className="border-l-[3px] border-iris pl-3">
    <p className="font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
    <p className="text-sm text-neutral">{label}</p>
  </div>;
}

function Table({ head, rows, strongLast }: { head: string[]; rows: (ReactNode | string)[][]; strongLast?: boolean }) {
  return <table className="w-full border-collapse text-sm break-inside-avoid">
    <thead><tr>{head.map((h, i) => <th key={h} scope="col" className={cn("border-b border-ink/15 px-2 py-2 font-mono text-micro font-medium uppercase tracking-[0.1em] text-neutral", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((row, r) => <tr key={r} className={cn(strongLast && r === rows.length - 1 && "font-semibold")}>
      {row.map((cell, i) => <td key={i} className={cn("border-b border-ink/10 px-2 py-2 align-top", i ? "text-right tabular-nums" : "text-left")}>{cell}</td>)}
    </tr>)}</tbody>
  </table>;
}

const valued = (m: Metric, format: (v: number) => string = formatCount) => m.value === null ? "—" : format(m.value);
const shown = (m: Metric) => m.status !== "unavailable" && m.value !== null;

function HourBands({ data }: { data: MonthlyReportData }) {
  const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const arrivals = data.service.arrivalsByWeekday;
  return <figure className="space-y-3 break-inside-avoid">
    <figcaption className="text-sm font-semibold text-ink">Quando os contatos chegaram</figcaption>
    {arrivals ? <Table head={["Dia", "Dentro", "Fora", "Não class."]}
      rows={arrivals.map((row) => [weekdays[row.weekday], formatCount(row.inside), formatCount(row.outside), formatCount(row.unclassified)])} />
      : <Table head={["Hora local", "Contatos"]} rows={data.service.hourBands.map((row) => [`${row.from}–${row.to}h`, formatCount(row.contacts)])} />}
    <p className="text-xs text-neutral">Classificação pelo dia da semana e expediente cadastrado, incluindo pausas e dias sem recepção. Sem expediente informado, a chegada permanece sem classificação.</p>
  </figure>;
}

function Funnel({ data }: { data: MonthlyReportData }) {
  const steps: [string, Split][] = [["Contatos", data.service.contacts], ["Qualificados", data.schedule.qualified],
    ["Agendaram", data.schedule.cohort.total], ["Compareceram", data.schedule.cohort.attended]];
  const base = Math.max(1, data.service.contacts.total.value ?? 0);
  const width = (n: number | null) => `${Math.max(0, (n ?? 0) / base * 100)}%`;
  const split = data.meta.hoursConfigured;
  return <div className="space-y-2 break-inside-avoid">
    {steps.map(([label, s]) => <div key={label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
      <span>{label}<Seal status={s.total.status} /></span>
      <div className="flex h-5 overflow-hidden rounded-sm bg-ink/10">
        {split ? <><span className="block h-full bg-iris" style={{ width: width(s.inside.value) }} /><span className="block h-full bg-ink" style={{ width: width(s.outside.value) }} /></>
          : <span className="block h-full bg-iris" style={{ width: width(s.total.value) }} />}
      </div>
      <span className="text-right font-mono tabular-nums">{valued(s.total)}</span>
    </div>)}
    {split && <p className="flex flex-wrap gap-4 pt-1 text-xs text-neutral"><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-iris align-[-1px]" />chegou no expediente</span><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-ink align-[-1px]" />chegou com a recepção fechada</span></p>}
  </div>;
}

// Seta e texto, nunca só a cor: o status tem que sobreviver à impressão em preto e branco.
const ACTION_CHIP: Record<ActionStatus, string> = { worked: "bg-success/15 text-emerald-800", partial: "bg-warn/15 text-amber-800", failed: "bg-danger/10 text-red-800" };

const CHIP: Record<string, string> = { added: "bg-success/15 text-emerald-800", rule: "bg-iris/10 text-iris", fixed: "bg-success/15 text-emerald-800" };

/**
 * `print`: a página 1 do PDF é o que o decisor lê primeiro (cabeçalho, frase,
 * os quatro números); o documento flui na mesma ordem do painel, com
 * as próximas ações depois dos resultados e problemas.
 */
export function MonthlyReportDocument({ report: r }: { report: MonthlyReport; print?: boolean }) {
  const d = r.data;
  if (!d) return null;
  const s = d.service, a = d.schedule, c = d.comparison;
  const monthName = r.label.split(" de ")[0];
  const previousName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${r.previousMonth}-01T12:00:00Z`));
  const hours = hoursLabel(r.assumptions.humanHours);
  const closedDates = humanClosedDatesLabel(r.assumptions.humanClosedDates);
  const split = d.meta.hoursConfigured;
  const cohortRow = (label: ReactNode, x: Split) => split ? [label, valued(x.inside), valued(x.outside), valued(x.total)] : [label, valued(x.total)];
  const upcoming = a.cohort.upcoming.total.value ?? 0, unverified = a.cohort.unverified.total.value ?? 0;
  const earlier = (a.fromEarlierMonths.attended.value ?? 0) + (a.fromEarlierMonths.noShow.value ?? 0);
  const changes = (r.agentChanges ?? []).filter((change) => change.date && change.purpose?.trim());
  // Só as já avaliadas: ação sem status é pendência da revisão, não conteúdo do relatório.
  const reviewed = (r.previousActions ?? []).filter((item) => item.status);
  const actions = r.nextActions ?? [];
  const leads = d.leads;
  const sat = d.satisfaction;
  const satReliable = Boolean(sat && !sat.smallSample);
  const { estimatedReturn: er, financialSummary: financial } = monthlyFinancialPresentation(d, r.assumptions);
  const hasLeads = leads.firstDoubts.length > 0 || leads.reasons.length > 0 || shown(leads.outOfArea);
  const role = OWNER_ROLE[r.decisionMakerRole ?? ""];
  const meeting = r.meetingAt ? new Intl.DateTimeFormat("pt-BR", { timeZone: d.meta.timezone, day: "2-digit", month: "2-digit" }).format(new Date(r.meetingAt)) : null;

  const nextMonth = <Block number="06" title="Próximo mês">
      {actions.length ? <ol className="space-y-2.5">{actions.map((item, i) => <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 rounded-control border border-ink/10 p-3 break-inside-avoid">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-iris font-mono text-xs font-medium text-white">{i + 1}</span>
        <div><p className="font-semibold">{item.action}</p><p className="mt-0.5 text-sm text-neutral">{item.owner} · meta: {item.indicator}</p>{item.reason && <p className="mt-1 text-sm text-neutral">Motivo: {item.reason}</p>}</div>
      </li>)}</ol> : <p className="whitespace-pre-wrap text-neutral">{r.nextMonth || "Plano do próximo mês em definição."}</p>}
    </Block>;

  return <article className="mx-auto max-w-[860px] space-y-8 rounded-surface border border-ink/10 bg-white p-6 font-sans text-[15px] leading-relaxed text-ink sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:space-y-6 print:text-sm print:leading-normal">
    <header className="space-y-4 border-b-2 border-ink pb-5">
      <div className="flex flex-wrap justify-between gap-2 font-mono text-micro font-medium uppercase tracking-[0.15em] text-neutral">
        <span><b className="text-iris">Fechai</b> · Relatório mensal</span><span>Mavellium</span>
      </div>
      <h1 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl"><span className="capitalize">{monthName}</span> de {r.label.split(" de ")[1]} · {r.tenantName}</h1>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral">
        {r.decisionMaker && <div className="flex gap-1"><dt>Para:</dt><dd><strong className="font-semibold text-ink">{r.decisionMaker}</strong>{role ? ` (${role})` : ""}</dd></div>}
        {r.operationalContact && <div className="flex gap-1"><dt>Cópia:</dt><dd>{r.operationalContact}</dd></div>}
        <div className="flex gap-1"><dt>Período:</dt><dd><strong className="font-semibold tabular-nums text-ink">{periodLabel(r.month)}</strong></dd></div>
        {hours && <div className="flex gap-1"><dt>Expediente humano:</dt><dd>{hours}</dd></div>}
      </dl>
      {hours && closedDates && <p className="text-sm text-neutral">Dias sem recepção cadastrados: {closedDates}. Contados como fora do expediente humano.</p>}
      <p className="max-w-[62ch] text-lg leading-normal">{openingSentence(monthName, d)}</p>
      {r.highlights && <p className="max-w-[70ch] whitespace-pre-wrap text-sm text-neutral">{r.highlights}</p>}
    </header>

    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-ink/15 bg-ink/15 sm:grid-cols-4 break-inside-avoid">
      <Kpi label="Contatos atendidos" value={valued(s.contacts.total)} sub={splitLine(s.contacts)} delta={c && deltaLabel(s.contacts.total.value, c.contacts, previousName)} />
      <Kpi anchor label="Avaliações agendadas" value={valued(a.cohort.total.total)} sub={splitLine(a.cohort.total)} delta={c && deltaLabel(a.cohort.total.total.value, c.scheduled, previousName)} />
      <Kpi label="Compareceram" value={valued(a.cohort.attended.total)}
        sub={attendanceSummary(a)}
        delta={upcoming ? `${upcoming} ainda ${upcoming === 1 ? "vai" : "vão"} acontecer` : null} />
      <Kpi label="1ª resposta do agente" value={shown(s.agentFirstResponseSeconds) ? formatSpan(s.agentFirstResponseSeconds.value) : "—"} sub="mediana · 24h por dia"
        delta={c?.agentFirstResponseSeconds != null ? `era ${formatSpan(c.agentFirstResponseSeconds)} em ${previousName}` : null} />
    </div>

    <Block number="01" title="Atendimento">
      <div className="grid items-start gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Figure value={valued(s.aiOnly)} label="resolvidas só pelo agente" />
            <Figure value={valued(s.transferred)} label="passadas para a recepção" />
            {shown(s.availabilityPercent) && <Figure value={formatPercent(s.availabilityPercent.value)} label="do mês com o agente no ar" />}
          </div>
          <Table head={["Tempo devolvido à equipe", monthName]} strongLast rows={[
            [`Áudios ouvidos pelo agente (${valued(s.time.audios)})`, <>{formatSpan(s.time.audioSeconds.value)}<Seal status={s.time.audioSeconds.status} /></>],
            ...(shown(s.time.longestAudioSeconds) ? [["Maior áudio do mês", formatSpan(s.time.longestAudioSeconds.value)]] : []),
            ["Áudios acima de 2 minutos", valued(s.time.longAudios)],
            [<>Leitura e resposta de {valued(s.time.textMessages)} mensagens de texto<Seal status={s.time.textSeconds.status} /></>, formatSpan(s.time.textSeconds.value)],
            ["Total", formatSpan(s.time.totalSeconds.value)],
          ]} />
        </div>
        <HourBands data={d} />
      </div>
      {(s.transferred.value ?? 0) > 0 && <div className="space-y-2 break-inside-avoid"><Table head={["Conversas passadas para a recepção", monthName]} rows={[
        ["Respondidas pela recepção", `${valued(s.reception.answered)} de ${valued(s.transferred)}`],
        ...(shown(s.reception.firstResponseSeconds) ? [["1ª resposta da recepção (mediana)", formatSpan(s.reception.firstResponseSeconds.value)]] : []),
        ["Respondidas em até 1 hora (% de todas as transferidas)", s.reception.withinHourPercent ? valued(s.reception.withinHourPercent, formatPercent) : "Não medido nesta versão"],
        ...(s.reception.targetMinutes && s.reception.withinTargetPercent ? [[`Respondidas na meta da clínica (até ${s.reception.targetMinutes} min)`, valued(s.reception.withinTargetPercent, formatPercent)]] : []),
        ["Respondidas após mais de 1 hora", valued(s.reception.waitedOverHour)],
        ["Ainda sem resposta no fim do mês", valued(s.reception.unanswered)],
      ]} />
        <p className="text-xs text-neutral">Tempo corrido entre a transferência e a primeira resposta humana; sem transferência registrada, usa a última mensagem do contato antes da resposta. Respostas contabilizadas até {s.reception.countedUntil ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: d.meta.timezone }).format(new Date(s.reception.countedUntil)) : `o fim de ${monthName}`} (corte exclusivo). Quem segue sem resposta está fora do numerador e dentro da base das taxas. {s.reception.targetMinutes ? "Meta informada pela clínica." : "Meta da clínica ainda não definida; 1 hora é apenas um indicador de acompanhamento."}</p>
      </div>}
      {sat && sat.answered > 0 && <div className="space-y-3 break-inside-avoid">
        <p className="text-sm font-semibold">Satisfação dos contatos</p>
        <div className="grid grid-cols-3 gap-3">
          <Figure value={satReliable && sat.average.value !== null ? sat.average.value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}
            label={satReliable ? "nota média, de 1 a 5" : "nota média: amostra pequena"} />
          <Figure value={formatCount(sat.answered)} label={sat.answered === 1 ? "contato respondeu" : "contatos responderam"} />
          <Figure value={formatPercent(sat.responseRatePercent)} label={`responderam, de ${formatCount(sat.sent)} que receberam`} />
        </div>
        <div className="grid items-start gap-6 sm:grid-cols-2">
          <Table head={["Nota", "Respostas"]} rows={[5, 4, 3, 2, 1].map((n) => [`${n} ${n === 1 ? "estrela" : "estrelas"}`, formatCount(sat.distribution[n - 1])])} />
          {sat.improvementTopics.length > 0 && <Table head={["Pontos de melhoria mais citados", "Citações"]} rows={sat.improvementTopics.map((t) => [t.label, formatCount(t.count)])} />}
        </div>
        <p className="text-xs text-neutral">Pesquisa enviada depois da conversa a quem conversou de verdade e não passou pela equipe, uma vez a cada 30 dias. Contam as respostas dadas em {monthName}. {satReliable ? "" : "Com menos de 5 respostas a média não é mostrada. "}Os pontos de melhoria agrupam os comentários em motivos fixos; o que cada pessoa escreveu não faz parte deste relatório.</p>
      </div>}
      {split && shown(s.contacts.outside) && <p className="text-xs text-neutral">Os {valued(s.contacts.outside)} contatos com a recepção fechada incluem noites, fins de semana e qualquer horário fora do expediente cadastrado.</p>}
    </Block>

    <Block number="02" title="Agenda" tag="O número principal">
      {s.contexts ? <div className="space-y-3 break-inside-avoid">
        <p className="text-sm font-semibold">Conversão por contexto de entrada</p>
        <Table head={["Contexto", "Contatos", "Agendaram", "Conversão"]} rows={s.contexts.groups.filter((g) => g.contacts > 0)
          .map((g) => [g.label, formatCount(g.contacts), formatCount(g.scheduledContacts), formatPercent(g.conversionPercent)])} />
        <p className="text-xs text-neutral">Contatos incluem quem não respondeu. Cada pessoa que agendou entra uma vez; a taxa usa somente sua própria base, com avaliação criada pelo agente depois da entrada. Total atendido inclui novos contatos, retornos da base e respostas a abordagens.</p>
        <p className="text-xs text-neutral">Origem de aquisição não registrada: uma entrada não comprova tráfego pago, e contato antigo não comprova base qualificada. A finalidade de abordagem sem registro permanece desconhecida.</p>
        {s.contexts.unattributedEvaluations > 0 && <p className="text-xs text-neutral">{formatCount(s.contexts.unattributedEvaluations)} avaliações sem vínculo com entrada anterior nesta janela estão no total de avaliações, fora das taxas por contexto.</p>}
      </div> : <Funnel data={d} />}
      <div className="grid items-start gap-6 sm:grid-cols-2">
        <div className="break-inside-avoid">
          <Table head={split ? [`Avaliações marcadas em ${monthName}`, "Exped.", "Fora", "Total"] : [`Avaliações marcadas em ${monthName}`, "Total"]} strongLast rows={[
            cohortRow("Compareceram", a.cohort.attended),
            cohortRow("Faltaram", a.cohort.no_show),
            ...(upcoming ? [cohortRow("Aguardando consulta", a.cohort.upcoming)] : []),
            ...(unverified ? [cohortRow("Comparecimento não verificado", a.cohort.unverified)] : []),
            cohortRow("Total agendado", a.cohort.total),
          ]} />
          {earlier > 0 && <p className="mt-2 text-xs text-neutral">Além dessas, {earlier} {earlier === 1 ? "avaliação marcada" : "avaliações marcadas"} pelo agente em meses anteriores {earlier === 1 ? "aconteceu" : "aconteceram"} em {monthName}: {valued(a.fromEarlierMonths.attended)} com comparecimento e {valued(a.fromEarlierMonths.noShow)} com falta.</p>}
        </div>
        {a.procedures.length > 0 && <Table head={["Procedimento", "Agendadas"]} rows={a.procedures.map((p) => [p.name, formatCount(p.scheduled)])} />}
      </div>
    </Block>

    <Block number="03" title="O que ajustamos no agente">
      {reviewed.length > 0 && <div className="space-y-2 break-inside-avoid">
        <p className="text-sm font-semibold">Como foram as ações combinadas em {previousName}</p>
        <ul className="space-y-2.5">{reviewed.map((item, i) => <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-micro font-medium uppercase tracking-wide", ACTION_CHIP[item.status!])}>{ACTION_STATUS_LABEL[item.status!]}</span>
          <span>{item.action}{item.result ? <>: <span className="text-ink/80">{item.result}</span></> : null}</span>
        </li>)}</ul>
      </div>}
      <p>O agente travou em <strong className="tabular-nums">{valued(d.unanswered)}</strong> {d.unanswered.value === 1 ? "pergunta" : "perguntas"} este mês{c ? <> ({c.unanswered === 1 ? "era" : "eram"} <span className="tabular-nums">{c.unanswered}</span> em {previousName})</> : null}.</p>
      {changes.length > 0 ? <ul className="space-y-2.5">{changes.map((change, i) => <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-micro font-medium uppercase tracking-wide", CHIP[change.kind])}>{AGENT_CHANGE_LABELS[change.kind]}</span>
        <span><strong className="font-semibold">{change.date?.split("-").reverse().join("/")}</strong> · {change.text}<span className="mt-1 block text-sm text-neutral">Finalidade: {change.purpose}</span></span>
      </li>)}</ul> : <p className="text-sm text-neutral">Nenhuma alteração detalhada com data e finalidade foi conferida nesta revisão.</p>}
      {r.featuredCase && <figure className="space-y-1.5 rounded-control border border-ink/10 bg-paper p-4 break-inside-avoid">
        <figcaption className="font-mono text-micro font-medium uppercase tracking-[0.15em] text-neutral">Caso do mês</figcaption>
        <blockquote className="whitespace-pre-wrap">{r.featuredCase}</blockquote>
        {r.caseFacts && <p className="text-sm text-neutral">{caseFactItems(r.caseFacts).join(" · ")}</p>}
      </figure>}
    </Block>

    {hasLeads && <Block number="04" title="Qualidade dos leads">
      <div className="grid items-start gap-6 sm:grid-cols-2">
        {leads.firstDoubts.length > 0 && <Table head={["Primeira dúvida", "% dos contatos"]} rows={leads.firstDoubts.map((x) => [x.label, formatPercent(x.percent)])} />}
        {leads.reasons.length > 0 && <Table head={["Motivo principal de não agendar", "Contatos"]} strongLast rows={[
          ...leads.reasons.map((x) => [x.label, formatCount(x.contacts)]),
          ...(leads.population ? [["Total", formatCount(leads.population.notScheduled)]] : []),
        ]} />}
      </div>
      {leads.population && <p className="text-xs text-neutral">População: {formatCount(leads.population.attended)} contatos que escreveram e receberam resposta no mês, incluindo novos contatos, retornos e abordagens. Cada contato entra uma vez; {formatCount(leads.population.scheduled)} agendaram e {formatCount(leads.population.notScheduled)} não agendaram. A primeira dúvida usa os {formatCount(leads.population.withDoubt)} contatos com dúvida registrada.</p>}
      {shown(leads.outOfArea) && (leads.withCity.value ?? 0) > 0 && <p>Dos <span className="tabular-nums">{valued(leads.withCity)}</span> contatos que disseram a cidade, <span className="tabular-nums">{valued(leads.outOfArea)}</span> eram de fora da área atendida, e {leads.outOfAreaScheduled.value === 1 ? "só 1 agendou" : `${valued(leads.outOfAreaScheduled)} agendaram`}.<Seal status={leads.withCity.status} /></p>}
      {(leads.withCity.value ?? 0) > 0 && <p className="text-xs text-neutral">Amostra de cidades: {valued(leads.withCity)} respostas{leads.population ? ` de ${formatCount(leads.population.attended)} contatos (${formatPercent(leads.population.cityCoveragePercent)})` : ""}. Este recorte não caracteriza toda a base nem comprova origem em tráfego pago. {Number(leads.withCity.value) < 10 ? "Amostra inferior ao mínimo de 10 respostas para sugestões de segmentação." : ""}</p>}
      {leads.suggestions.length > 0 && <div className="space-y-1.5">
        <p className="font-semibold">Sugestões para o tráfego pago</p>
        <ul className="list-disc space-y-1 pl-5">{leads.suggestions.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="text-xs text-neutral">{SUGGESTION_DISCLAIMER}</p>
      </div>}
    </Block>}

    <Block number="05" title="O que não saiu como planejado">
      {d.problems.length ? <ul className="space-y-2 rounded-control bg-warn/10 p-4 break-inside-avoid">{d.problems.map((p, i) => {
        const text = problemText(p, d.meta.timezone);
        return <li key={i}><strong className="font-semibold">{text.title}</strong> <span className="text-ink/80">{text.detail}</span></li>;
      })}</ul> : <p className="text-neutral">{NO_PROBLEMS}</p>}
      {Boolean(r.limitations?.length) && <div className="space-y-2"><p className="font-semibold">Limitações dos dados</p><ul className="list-disc space-y-1 pl-5">{(r.limitations ?? []).map((limitation) => <li className="break-inside-avoid" key={limitation.key}>{limitation.text}</li>)}</ul></div>}
      {r.limitationsNote && <p className="whitespace-pre-wrap text-sm text-neutral">{r.limitationsNote}</p>}
    </Block>

    {nextMonth}

    {financial?.status === "incomplete" && <Block number="+" title="Retorno financeiro" tag="Cálculo incompleto">
      <div className="space-y-3 break-inside-avoid">
        <Table head={["Conta", "Valor"]} rows={[
          ["Receita potencial de tratamentos", financial.revenueCents === null ? "Não calculável" : formatBRL(financial.revenueCents)],
          ["Economia operacional estimada", financial.savingsCents === null ? "Não calculável" : formatBRL(financial.savingsCents)],
          ["Investimento mensal", financial.investmentCents === null ? "Não informado" : formatBRL(financial.investmentCents)],
          ["ROI total", "Indisponível"],
          ...(financial.operatingBalanceCents !== null ? [["Saldo operacional estimado (economia − mensalidade)", formatBRL(financial.operatingBalanceCents)]] : []),
        ]} />
        <p className="text-sm text-neutral">Receita desconhecida não significa receita zero. O saldo operacional não representa ROI total nem faturamento real. A economia depende do custo/hora e do tempo humano equivalente informados na revisão.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral">{financial.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </div>
    </Block>}

    {er && <Block number="+" title="Retorno estimado" tag="Estimativa">
      <div className="space-y-3 rounded-control border border-dashed border-ink/20 p-4 break-inside-avoid">
        <p>Com o ticket e a conversão informados pela clínica, considerando só os pacientes que chegaram <strong>com a recepção fechada</strong> e compareceram:</p>
        <Table head={["Conta", "Valor"]} strongLast rows={[
          ...er.lines.map((l) => [`${l.procedure}: ${l.attended} ${l.attended === 1 ? "compareceu" : "compareceram"} × ${(l.conversionBps / 100).toLocaleString("pt-BR")}% fecham tratamento × ${formatReais(l.ticketCents)} de ticket`, formatReais(l.revenueCents)]),
          ["Tratamentos potenciais", formatReais(er.revenueCents)],
          [`+ ${formatSpan(er.returnedSeconds)} devolvidas × ${formatReais(er.hourCents)}/h (custo informado)`, formatReais(er.savingsCents)],
          ["− Investimento no Fechai", formatReais(er.investmentCents)],
          ["Retorno", formatReais(er.netCents)],
        ]} />
        <p><span className="font-display text-3xl font-bold tabular-nums text-iris">{er.multiple.toLocaleString("pt-BR")}x</span><Seal status="estimated" /></p>
        <p className="text-sm text-neutral">Estimativa. Não usa faturamento real da clínica e não conta como receita os pacientes que chegaram no expediente.</p>
      </div>
    </Block>}

    <footer className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-ink/15 pt-4 text-xs text-neutral">
      <span>Fechai · Mavellium · {r.status === "ready" ? "relatório revisado antes do envio" : "rascunho em revisão"}</span>
      {meeting && <span>Reunião realizada em {meeting}</span>}
    </footer>
  </article>;
}
