import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        eyebrow="CRM"
        title="Indicadores do transbordo"
        description="Quem assumiu os atendimentos transferidos pela IA, quanto tempo levou e quantos voltaram para a IA."
        actions={<ButtonLink href="/crm" variant="outline"><ArrowLeft size={16} aria-hidden />Voltar ao CRM</ButtonLink>}
      />
      <nav aria-label="Período" className="flex flex-wrap gap-2 text-sm">
        {PERIODS.map((period) => (
          <Link key={period} href={`/crm/indicadores?dias=${period}`} aria-current={period === days ? "page" : undefined}
            className={`rounded-control border px-3 py-1 ${period === days ? "border-iris bg-iris/10 font-medium" : "border-ink/15 panel:border-white/15"}`}>
            Últimos {period} dias
          </Link>
        ))}
      </nav>
      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <EmptyState title="Nenhum transbordo assumido no período" description="Os números aparecem quando alguém da equipe assume ou devolve um atendimento." />
        ) : (
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Indicadores do transbordo por pessoa, últimos {days} dias</caption>
            <thead>
              <tr className="border-b border-ink/10 text-left text-neutral panel:border-white/10 panel:text-white/60">
                <th scope="col" className="px-4 py-3 font-medium">Pessoa</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Assumidos</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Mediana até assumir</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Mediana até a 1ª resposta</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Devolvidos para a IA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-ink/5 last:border-0 panel:border-white/5">
                  <th scope="row" className="px-4 py-3 text-left font-medium [overflow-wrap:anywhere]">{row.name}</th>
                  <td className="px-4 py-3 text-right tabular-nums">{row.assumed}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{seconds(row.medianAssumeSeconds)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{seconds(row.medianFirstReplySeconds)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.returned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="text-sm text-neutral panel:text-white/60">
        Tempo até assumir conta do transbordo até alguém assumir pelo painel, pelo grupo ou respondendo pelo celular.
        A 1ª resposta é a primeira mensagem humana depois do transbordo. &quot;Não identificado&quot; é quem assumiu sem estar
        ligado a um usuário (número não vinculado no grupo ou resposta pelo celular sem responsável).
      </p>
    </div>
  );
}
