import { BarChart3, Download } from "lucide-react";
import { requireTenant, requireOwner } from "@/lib/session";
import { redirect } from "next/navigation";
import { requireProductAccess } from "@/lib/require-product";
import { publishedMonthlyMonths, selectPublishedMonth } from "@/modules/reports/monthly-publication";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { MonthlyView } from "./MonthlyView";
import { MonthlyReportDocument } from "./monthly-v2/MonthlyReportDocument";
import { MonthlyReportEvidence } from "./monthly-v2/MonthlyReportEvidence";
import { MonthPicker } from "@/components/ui/month-picker";
import { prisma } from "@/lib/prisma";
import {
  computeFinancialSummary,
  computePeriodReport,
  resolveRange,
  type PeriodKey,
} from "@/modules/reports/service";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/FadeIn";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { getAffiliateByUser, approveMaturedCommissions } from "@/modules/affiliates/service";
import { getAccountRoles, isAffiliateOnly } from "@/modules/affiliates/roles";
import { getAffiliateOverview } from "@/modules/affiliates/stats";
import { AfiliadoView } from "./AfiliadoView";
import { ChartPanel } from "./ChartPanel";
import { FinancialView } from "./FinancialView";
import { TriagePanel } from "./TriagePanel";
import { LeadQualityView } from "./LeadQualityView";
import { loadLeadQuality } from "@/modules/lead-insights/queries";
import { RangePicker } from "./RangePicker";
import { StatusBreakdown } from "./StatusBreakdown";
import { ContactContextSummary } from "./ContactContextSummary";
import { SatisfactionView } from "./SatisfactionView";
import { loadSatisfaction } from "@/modules/satisfaction/queries";
import { getSurveySettings } from "@/modules/satisfaction/settings-store";

const PERIODS: PeriodKey[] = ["hoje", "7", "30", "mes", "ano", "tudo"];
// A aba "Afiliados" só existe para quem está no programa — o filtro abaixo
// remove a opção de quem não é afiliado, e a página cai na visão padrão se
// alguém digitar ?visao=afiliados na URL sem ter cadastro.
const VIEWS = ["operacional", "financeiro", "leads", "satisfacao", "mensal", "afiliados"] as const;
type View = (typeof VIEWS)[number];

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string; visao?: string; mes?: string; nota?: string; agente?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const session = await requireOwner();
  const { periodo, de, ate, visao, mes, nota, agente } = await searchParams;
  const period = (PERIODS as string[]).includes(periodo ?? "") ? (periodo as PeriodKey) : "30";

  // O afiliado é do USUÁRIO, não do tenant: a mesma pessoa pode ser cliente e
  // afiliada, e é o login dela que define quais abas existem.
  const [affiliate, roles] = await Promise.all([
    getAffiliateByUser(session.user.id),
    getAccountRoles(session.user.id),
  ]);
  const affiliateOnly = isAffiliateOnly(roles);

  // Quem só afilia tem uma aba só — as outras medem o agente, que essa conta
  // não usa. É também o padrão ao abrir /relatorios sem `?visao=`.
  const requested = (VIEWS as readonly string[]).includes(visao ?? "")
    ? (visao as View)
    : affiliateOnly
      ? "afiliados"
      : "operacional";
  const publishedMonths = affiliateOnly ? [] : await publishedMonthlyMonths(tenantId);
  const month = selectPublishedMonth(publishedMonths, mes);
  const view: View = affiliateOnly
    ? "afiliados"
    : (requested === "afiliados" && !affiliate) || (requested === "mensal" && !month)
      ? "operacional"
      : requested;

  const range = resolveRange(period, de, ate);
  if (view === "mensal") await requireProductAccess();
  const monthlyReport = view === "mensal" && month ? await computeMonthlyReport(tenantId, month) : null;
  // Uma revisão reaberta durante esta leitura não pode aparecer ao cliente.
  if (view === "mensal" && monthlyReport?.status !== "ready") redirect("/relatorios");

  if (view === "afiliados" && affiliate) {
    // Amadurece as comissões antes de somar, para o card bater com o painel.
    await approveMaturedCommissions(affiliate.id);
  }

  const ratingFilter = /^[1-5]$/.test(nota ?? "") ? Number(nota) : null;
  const agentFilter = agente && agente.length <= 40 ? agente : null;
  // Para quem não é da clínica (Mavellium personificando), o comentário chega mascarado.
  const [satisfaction, surveySettings] =
    view === "satisfacao"
      ? await Promise.all([
          loadSatisfaction(
            tenantId,
            { from: range.from, to: new Date(range.to.getTime() + 1), rating: ratingFilter, agentId: agentFilter },
            { maskComments: session.user.impersonating === true },
          ),
          getSurveySettings(tenantId),
        ])
      : [null, null];

  const [hasAnyData, report, financial, leadQuality, affiliateOverview] = await Promise.all([
    affiliateOnly ? 1 : prisma.lead.count({ where: { tenantId, isTest: false } }),
    view === "operacional" ? computePeriodReport(tenantId, range) : null,
    view === "financeiro" ? computeFinancialSummary(tenantId, range) : null,
    view === "leads" ? loadLeadQuality(tenantId, { from: range.from, to: new Date(range.to.getTime() + 1) }) : null,
    view === "afiliados" && affiliate ? getAffiliateOverview(affiliate.id) : null,
  ]);

  // Conta sem nenhuma conversa: a grade de zeros não informa nada e ainda dá a
  // impressão de que o relatório quebrou. Estado vazio com o próximo passo.
  //
  // A aba de afiliados escapa dessa saída de propósito: os ganhos não dependem
  // de a conta ter conversas — um afiliado que nunca usou o agente ainda
  // precisa ver o que indicou.
  if (hasAnyData === 0 && publishedMonths.length === 0 && view !== "afiliados" && view !== "mensal") {
    return (
      <div className="w-full space-y-8">
        <PageHeader
          eyebrow="relatórios"
          title="Números da sua conta"
          description="Gráficos e indicadores aparecem assim que seu agente tiver a primeira conversa."
        />
        <Card>
          <EmptyState
            icon={BarChart3}
            title="Ainda não há o que medir"
            description="Conecte o WhatsApp ou faça um teste no sandbox para começar — os números passam a aparecer aqui a cada carregamento."
            action={<ButtonLink href="/conversas">Testar no sandbox</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  const prev = report?.kpis.prev ?? null;

  const viewHref = (key: string) => {
    const qs = new URLSearchParams();
    if (de) qs.set("de", de);
    if (ate) qs.set("ate", ate);
    if (!de) qs.set("periodo", period);
    qs.set("visao", key);
    if (month) qs.set("mes", month);
    return `/relatorios?${qs.toString()}`;
  };

  // Filtros da lista de satisfação; mantém visão e período.
  const satisfactionHref = ({ nota: n, agente: a }: { nota?: string | null; agente?: string | null }) => {
    const qs = new URLSearchParams();
    if (de) qs.set("de", de);
    if (ate) qs.set("ate", ate);
    if (!de) qs.set("periodo", period);
    qs.set("visao", "satisfacao");
    if (n) qs.set("nota", n);
    if (a) qs.set("agente", a);
    return `/relatorios?${qs.toString()}`;
  };

  const exportQs = new URLSearchParams();
  if (de) exportQs.set("de", de);
  if (ate) exportQs.set("ate", ate);
  if (!de) exportQs.set("periodo", period);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="relatórios"
        title="Números da sua conta"
        description={
          view === "afiliados"
            ? "Seus ganhos como afiliado, mês a mês."
            : view === "mensal"
              ? "O que o Fechai fez no mês: atendimento, avaliações agendadas e comparecimento. Revisado pela Mavellium."
            : view === "financeiro"
              ? `Retorno estimado do investimento no projeto — ${range.label}.`
            : view === "leads"
              ? `De onde vêm os leads, o que perguntam e por que não fecham — ${range.label}.`
            : view === "satisfacao"
              ? `O que os contatos acharam do atendimento — ${range.label}.`
              : `Acompanhe a evolução da conta — ${range.label}.`
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Uma visão só (conta de afiliado puro) não precisa de seletor. */}
          {!affiliateOnly && (
            <FilterTabs
              label="Visão dos relatórios"
              options={[
                { key: "operacional", label: "Operacional" },
                { key: "financeiro", label: "Financeiro" },
                { key: "leads", label: "Qualidade dos leads" },
                { key: "satisfacao", label: "Satisfação" },
                ...(publishedMonths.length ? [{ key: "mensal", label: "Relatório mensal" }] : []),
                ...(affiliate ? [{ key: "afiliados", label: "Afiliados" }] : []),
              ]}
              active={view}
              href={viewHref}
            />
          )}
          {/* A série de afiliados é sempre mensal (competência da comissão),
              então um seletor de período aqui prometeria um recorte que o
              gráfico não faz. */}
          {view !== "afiliados" && view !== "mensal" && (
            <RangePicker active={de ? "custom" : period} de={de} ate={ate} visao={view} />
          )}
        </div>
        {view === "operacional" && (
          <ButtonLink href={`/relatorios/export?${exportQs.toString()}`} variant="outline" size="sm">
            <Download size={14} aria-hidden />
            Exportar CSV
          </ButtonLink>
        )}
        {view === "mensal" && monthlyReport && <ButtonLink href={`/relatorios/mensal/pdf?mes=${month}`} variant="outline" size="sm"><Download size={14} aria-hidden />Exportar PDF</ButtonLink>}
      </div>

      {view === "mensal" && month && <MonthPicker value={month} href={viewHref("mensal")} availableMonths={publishedMonths} />}

      {/* Meses fechados antes do relatório v2 não têm `data` e seguem na visão antiga. */}
      {view === "mensal" && monthlyReport ? (monthlyReport.data ? <><MonthlyReportDocument report={monthlyReport} /><MonthlyReportEvidence report={monthlyReport} /></> : <MonthlyView report={monthlyReport} />) : view === "operacional" && report ? (
        <>
          <FadeIn>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
              <Stat
                label="Contatos que escreveram"
                about="Contatos com ao menos uma mensagem recebida no período, mesmo que a conversa tenha começado antes."
                value={String(report.kpis.conversations)}
                delta={prev ? report.kpis.conversations - prev.conversations : undefined}
              />
              <Stat
                label="Contatos atendidos"
                value={String(report.kpis.attendedContacts)}
                delta={prev ? report.kpis.attendedContacts - prev.attendedContacts : undefined}
                about="Contatos que escreveram e receberam resposta do agente ou da equipe no período. Mesma regra do relatório mensal, respeitando os agentes selecionados nele."
              />
              <Stat
                label="Leads novos"
                about="Registros de contato criados no período, inclusive os criados por uma abordagem da clínica. Não representa aquisição por tráfego."
                value={String(report.kpis.leads)}
                delta={prev ? report.kpis.leads - prev.leads : undefined}
              />
              <Stat
                label="Agendamentos criados"
                about="Agendamentos não cancelados criados no período, de todos os tipos e origens. O mensal destaca avaliações criadas pelo agente."
                value={String(report.kpis.scheduled)}
                delta={prev ? report.kpis.scheduled - prev.scheduled : undefined}
              />
              <Stat
                label="Avaliações agendadas pelo agente"
                value={String(report.kpis.evaluations)}
                delta={prev ? report.kpis.evaluations - prev.evaluations : undefined}
                about="Avaliações não canceladas criadas pelo agente no período. No mês completo, usa as mesmas regras de tipo e seleção de agentes da revisão mensal."
              />
              <Stat
                label="Mensagens recebidas"
                value={String(report.kpis.inbound)}
                delta={prev ? report.kpis.inbound - prev.inbound : undefined}
              />
              <Stat
                label="Mensagens enviadas"
                value={String(report.kpis.outbound)}
                delta={prev ? report.kpis.outbound - prev.outbound : undefined}
              />
              <Stat
                label="Taxa de resposta"
                value={`${Math.round(report.kpis.responseRate * 100)}%`}
                hint={prev ? `antes ${Math.round(prev.responseRate * 100)}%` : undefined}
                about="Dos contatos que escreveram no período, quantos receberam resposta do agente ou da equipe depois da mensagem."
              />
              <Stat label="Leads quentes" value={String(report.kpis.hotLeads)} hint="agora" />
              <Stat label="Precisam de você" value={String(report.kpis.needsHuman)} hint="agora" />
            </div>
          </FadeIn>

          <FadeIn>
            <ContactContextSummary summary={report.contexts} />
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartPanel
                variant="flow"
                title="Fluxo de mensagens"
                hint="Mensagens recebidas e enviadas ao longo do período."
                flow={report.flow}
              />
              <ChartPanel
                variant="results"
                title="Resultados"
                hint="O que as conversas geraram, período a período."
                results={report.results}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartPanel
                variant="attendance"
                title="Atendimento: IA x humano"
                hint="Contatos que a IA atendeu sozinha contra os que precisaram de uma pessoa."
                attendance={report.attendance}
              />
              <ChartPanel
                variant="closed"
                title="Agendamentos: IA x humano"
                hint="Agendamentos fechados pela IA contra os marcados manualmente."
                closed={report.closed}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-3">
              <ChartPanel
                variant="donut"
                title="Distribuição por agente"
                hint="Conversas ativas por agente."
                slices={report.byAgent}
              />
              <Card className="lg:col-span-2">
                <CardTitle hint="Status dos leads novos no período.">Leads por status</CardTitle>
                <StatusBreakdown data={report.byStatus} />
              </Card>
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-3">
              <ChartPanel
                variant="funnel"
                title="Volumes no período"
                hint="Contatos ativos, contatos com duas mensagens, status atual dos leads novos e agendamentos criados. São bases distintas, não etapas de conversão."
                funnel={report.funnel}
              />
              <ChartPanel
                variant="autonomyRate"
                title="Resolução autônoma"
                hint="Fração dos contatos atendidos só pelo agente, sem resposta humana nem transferência registrada."
                autonomyRate={report.autonomyRate}
              />
              <ChartPanel
                variant="followUpRecovery"
                title="Recuperação por follow-up"
                hint="Follow-ups automáticos enviados no período e quantos trouxeram o lead de volta."
                followUpRecovery={report.followUpRecovery}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartPanel
                variant="peakHours"
                title="Horários de pico"
                hint="Quando os leads mandam mensagem — dia da semana × hora, fuso de Brasília."
                peakHours={report.peakHours}
              />
              <ChartPanel
                variant="firstResponseTime"
                title="Tempo até a primeira resposta"
                hint="Quanto tempo passa entre a mensagem do lead e a primeira resposta."
                firstResponseTime={report.firstResponseTime}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <ChartPanel
              variant="attendanceOutcome"
              title="Comparecimento e no-show"
              hint="Consultas que já aconteceram no período, pelo comparecimento marcado."
              attendanceOutcome={report.attendanceOutcome}
            />
          </FadeIn>
        </>
      ) : view === "financeiro" && financial ? (
        <FadeIn>
          <div className="space-y-8">
            <FinancialView summary={financial} />
            {/* Triagem fica na visão Financeira, e não na Operacional, porque a
                pergunta que ela responde é de dinheiro ("o que deixei de
                gastar"), do mesmo tipo do ROI logo acima. */}
            <section className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink panel:text-white">
                  O que o agente filtrou
                </h2>
                <p className="mt-1 max-w-prose text-sm text-neutral panel:text-white/55">
                  Contatos que não eram clientes em potencial e o agente
                  encerrou sozinho — sem ocupar ninguém da equipe.
                </p>
              </div>
              <TriagePanel triage={financial.triage} />
            </section>
          </div>
        </FadeIn>
      ) : view === "leads" && leadQuality ? (
        <FadeIn>
          <LeadQualityView quality={leadQuality} period={range.label} />
        </FadeIn>
      ) : view === "satisfacao" && satisfaction && surveySettings ? (
        <FadeIn>
          <SatisfactionView
            overview={satisfaction}
            settings={surveySettings}
            period={range.label}
            ratingFilter={ratingFilter}
            agentFilter={agentFilter}
            hrefFor={satisfactionHref}
            linkConversations={session.user.impersonating !== true}
          />
        </FadeIn>
      ) : view === "afiliados" && affiliateOverview ? (
        <AfiliadoView overview={affiliateOverview} />
      ) : null}
    </div>
  );
}
