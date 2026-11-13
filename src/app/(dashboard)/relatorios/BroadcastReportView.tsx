import Link from "next/link";
import { Send } from "lucide-react";
import { ReportFunnel } from "@/components/reports/ReportFunnel";
import { ReportInsights } from "@/components/reports/ReportInsights";
import { ReportKpis } from "@/components/reports/ReportKpis";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { formatInZone } from "@/modules/scheduling/time";
import { sumBroadcastCampaigns, type BroadcastCampaignReport } from "@/modules/reports/broadcast-campaigns";

type Counts = ReturnType<typeof sumBroadcastCampaigns>;
type Row = BroadcastCampaignReport["current"][number];
const number = new Intl.NumberFormat("pt-BR");
const rate = (part: number, total: number) => total > 0 ? Math.round(part / total * 100) : null;

const metrics = [
  { key: "sent", label: "Enviados", read: (c: Counts) => c.sent, about: "Mensagens aceitas pela Meta para entrega." },
  { key: "delivered", label: "Entrega", read: (c: Counts) => rate(c.delivered, c.sent), percent: true, about: "Entregues entre os envios aceitos." },
  { key: "read", label: "Leitura", read: (c: Counts) => rate(c.read, c.sent), percent: true, about: "Leituras confirmadas entre os envios aceitos." },
  { key: "replies", label: "Resposta", read: (c: Counts) => rate(c.replies, c.sent), percent: true, about: "Respostas em até sete dias entre os envios aceitos." },
  { key: "appointments", label: "Agendamentos", read: (c: Counts) => c.appointments, about: "Destinatários com agendamento atribuído ao disparo." },
  { key: "attended", label: "Compareceram", read: (c: Counts) => c.attended, about: "Comparecimentos registrados nos agendamentos atribuídos." },
];

const stages = [
  ["Enviados", "sent"], ["Entregues", "delivered"], ["Lidos", "read"], ["Responderam", "replies"],
  ["Qualificados", "opportunities"], ["Agendamentos", "appointments"], ["Compareceram", "attended"],
] as const;

const display = (value: number | null, percent?: boolean) => value === null ? "—" : `${number.format(value)}${percent ? "%" : ""}`;
function comparison(value: number | null, previous: number | null, percent?: boolean) {
  if (previous === null) return "Sem base";
  if (value === null) return "Sem taxa no período";
  const delta = value - previous;
  return delta === 0 ? "Igual ao período anterior" : `${delta > 0 ? "+" : ""}${number.format(delta)}${percent ? " p.p." : ""} vs. período anterior`;
}

export function BroadcastReportView({ report, sort, selected, hrefFor }: {
  report: BroadcastCampaignReport;
  sort?: string;
  selected?: string;
  hrefFor: (options: { sort?: string; selected?: string }) => string;
}) {
  const totals = sumBroadcastCampaigns(report.current);
  const previous = sumBroadcastCampaigns(report.previous);
  const order = metrics.find((metric) => metric.key === sort);
  const rows = order ? [...report.current].sort((a, b) => (order.read(b) ?? -1) - (order.read(a) ?? -1)) : report.current;
  const chosen = rows.find((row) => row.id === selected);
  const steps = stages.map(([name, key]) => ({ name, count: (chosen ?? totals)[key] }));
  const items = metrics.map((metric) => ({
    label: metric.label, value: display(metric.read(totals), metric.percent), about: metric.about,
    comparison: comparison(metric.read(totals), report.previous.length ? metric.read(previous) : null, metric.percent),
  }));

  if (rows.length === 0) return (
    <Card><EmptyState icon={Send} title="Nenhum disparo confirmado neste período"
      description="Troque o período para consultar disparos anteriores." action={<ButtonLink href="/disparos" variant="outline">Ver disparos</ButtonLink>} /></Card>
  );

  return (
    <div className="min-w-0 space-y-6">
      <ReportKpis items={items} />
      <div id="funil"><ReportFunnel steps={steps} description={chosen
        ? `${chosen.name}. Recibos de leitura são opcionais, então as respostas podem superar as leituras confirmadas.`
        : "Todos os disparos do período. Escolha um disparo na lista para ver suas etapas. Recibos de leitura são opcionais."} /></div>
      {chosen && <Link href={hrefFor({ sort })} className="text-sm font-medium text-iris underline panel:text-white">Mostrar funil de todos os disparos</Link>}
      <Card>
        <CardTitle>Disparos confirmados</CardTitle>
        <FilterTabs label="Ordenar disparos" active={order?.key ?? "recent"}
          options={[{ key: "recent", label: "Mais recentes" }, ...metrics.map(({ key, label }) => ({ key, label }))]}
          href={(key) => hrefFor({ sort: key === "recent" ? undefined : key, selected: chosen?.id })} className="mb-4" />
        <div className="hidden lg:block">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Resultados por disparo</caption>
            <thead><tr className="border-b border-ink/10 panel:border-white/15">
              <th scope="col" className="w-1/4 pb-2">Disparo</th>
              {metrics.map(({ key, label }) => <th key={key} scope="col" className="break-words px-1 pb-2 text-right">{label}</th>)}
            </tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-ink/10 panel:border-white/10">
              <th scope="row" className="py-3 font-medium"><BroadcastLinks row={row} funnelHref={hrefFor({ sort, selected: row.id })} /></th>
              {metrics.map((metric) => <td key={metric.key} className="px-1 text-right tabular-nums">{display(metric.read(row), metric.percent)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <ul className="divide-y divide-ink/10 panel:divide-white/10 lg:hidden">
          {rows.map((row) => <li key={row.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
            <BroadcastLinks row={row} funnelHref={hrefFor({ sort, selected: row.id })} />
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {metrics.map((metric) => <div key={metric.key}><dt className="text-neutral panel:text-white/65">{metric.label}</dt>
                <dd className="font-medium tabular-nums">{display(metric.read(row), metric.percent)}</dd></div>)}
            </dl>
          </li>)}
        </ul>
      </Card>
      <ReportInsights title="Saúde dos disparos">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          {[ ["Falhas de envio", totals.failed], ["Envios sem confirmação", totals.unknown], ["Falhas de entrega", totals.deliveryFailed] ].map(([label, value]) => (
            <div key={label}><dt className="text-neutral panel:text-white/65">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>
          ))}
        </dl>
      </ReportInsights>
      <ReportInsights title="Custos"><p className="text-sm text-neutral panel:text-white/65">Ainda não medidos.</p></ReportInsights>
    </div>
  );
}

function BroadcastLinks({ row, funnelHref }: { row: Row; funnelHref: string }) {
  return <div className="min-w-0 space-y-1 pr-2">
    <Link href={`/disparos/${row.id}`} className="block break-words font-semibold text-iris underline-offset-4 hover:underline panel:text-white">{row.name}</Link>
    {row.confirmedAt && <p className="text-xs text-neutral panel:text-white/65">{formatInZone(row.confirmedAt, "America/Sao_Paulo")}</p>}
    <Link href={`${funnelHref}#funil`} aria-label={`Ver funil de ${row.name}`} className="inline-flex min-h-11 items-center text-xs text-iris underline panel:text-white/80">Ver funil</Link>
  </div>;
}
