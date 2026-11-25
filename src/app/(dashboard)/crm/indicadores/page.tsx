import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireCrmAccess } from "@/modules/crm/access";
import { handoffIndicators } from "@/modules/crm/handoff-indicators";
import { crmDurationLabel } from "@/modules/crm/sla";

export const metadata: Metadata = { title: "Indicadores do transbordo" };

const PERIODS = [7, 30, 90] as const;

function seconds(value: number | null) {
  if (value === null) return "—";
  return value < 60 ? "menos de 1 min" : crmDurationLabel(Math.floor(value / 60));
}

/** Indicadores do transbordo por pessoa (CRM-11), lidos da trilha do CRM. */
export default async function HandoffIndicatorsPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const tenantId = await requireCrmAccess();
  const { dias } = await searchParams;
  const days = PERIODS.find((period) => String(period) === dias) ?? 30;
  const to = new Date();
  const from = new Date(+to - days * 86_400_000);
  const rows = await handoffIndicators(tenantId, from, to);

  const assumed = rows.reduce((sum, row) => sum + row.assumed, 0);
  const returned = rows.reduce((sum, row) => sum + row.returned, 0);
  const people = rows.filter((row) => row.assumed > 0).length;
  // "Mais rápido" só entre quem tem mediana: sem assumir não existe tempo.
  const fastest = rows.filter((row) => row.medianAssumeSeconds !== null)
    .sort((x, y) => (x.medianAssumeSeconds ?? 0) - (y.medianAssumeSeconds ?? 0))[0];

  return (
    <div className="w-full min-w-0 space-y-5">
      <PageHeader
        eyebrow="CRM"
        title="Indicadores do transbordo"
        hint="Quem assumiu os atendimentos transferidos pela IA, quanto tempo levou e quantos voltaram para a IA."
        actions={<ButtonLink href="/crm" variant="action"><ArrowLeft size={16} aria-hidden />Voltar ao CRM</ButtonLink>}
      />
      <FilterTabs accent="signal" label="Período" active={String(days)} href={(key) => `/crm/indicadores?dias=${key}`}
        options={PERIODS.map((period) => ({ key: String(period), label: `Últimos ${period} dias` }))} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat compact label="Atendimentos assumidos" value={assumed.toLocaleString("pt-BR")} hint={`nos últimos ${days} dias`} />
        <Stat compact label="Pessoas que assumiram" value={people.toLocaleString("pt-BR")} hint="da equipe ou não identificadas" />
        <Stat compact label="Devolvidos para a IA" value={returned.toLocaleString("pt-BR")}
          hint={assumed > 0 ? `${Math.round((returned / assumed) * 100)}% dos assumidos` : "nenhum assumido"}
          about="Atendimentos que voltaram para a IA, pela equipe ou pela devolução automática." />
        <Stat compact label="Assume mais rápido" value={fastest ? fastest.name : "—"}
          hint={fastest ? `mediana de ${seconds(fastest.medianAssumeSeconds)}` : "sem tempo medido no período"} />
      </div>

      <Card className="p-0">
        <div className="px-4 pt-4 sm:px-5">
          <CardTitle hint={<>Tempo até assumir conta do transbordo até alguém assumir pelo painel, pelo grupo ou respondendo pelo celular.
            A 1ª resposta é a primeira mensagem humana depois do transbordo. &quot;Não identificado&quot; é quem assumiu sem estar
            ligado a um usuário (número não vinculado no grupo ou resposta pelo celular sem responsável).</>}>Por pessoa</CardTitle>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum transbordo assumido no período" description="Os números aparecem quando alguém da equipe assume ou devolve um atendimento." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Indicadores do transbordo por pessoa, últimos {days} dias</caption>
              <thead>
                <tr className="border-y border-ink/10 text-left text-neutral panel:border-white/10 panel:text-white/60">
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Pessoa</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Assumidos</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Mediana até assumir</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Mediana até a 1ª resposta</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">Devolvidos para a IA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-ink/5 last:border-0 panel:border-white/5">
                    <th scope="row" className="px-4 py-3 text-left font-medium [overflow-wrap:anywhere] sm:px-5">{row.name}</th>
                    <td className="px-4 py-3 text-right tabular-nums">{row.assumed}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{seconds(row.medianAssumeSeconds)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{seconds(row.medianFirstReplySeconds)}</td>
                    <td className="px-4 py-3 text-right tabular-nums sm:px-5">{row.returned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
