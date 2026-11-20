"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { ChartActions } from "@/components/charts/ChartActions";
import { ChartTable } from "@/components/charts/ChartTable";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { HeatmapChart } from "@/components/charts/HeatmapChart";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import { MeterChart } from "@/components/charts/MeterChart";
import type {
  AiHumanPoint,
  AttendanceOutcomePoint,
  AttendancePoint,
  FlowPoint,
  FunnelStep,
  HeatmapCell,
  ResponseTimeBucket,
  ResultPoint,
} from "@/modules/reports/service";
import { BarsChart } from "./BarsChart";
import { DonutChart } from "./DonutChart";
import { FlowChart } from "./FlowChart";
import { SeriesChart } from "./SeriesChart";

type Variant =
  | "flow"
  | "results"
  | "donut"
  | "attendance"
  | "closed"
  | "funnel"
  | "peakHours"
  | "firstResponseTime"
  | "autonomyRate"
  | "followUpRecovery"
  | "attendanceOutcome";

const DESCRIPTIONS: Record<Variant, string> = {
  flow: "Mensagens gravadas em conversas reais (o sandbox de teste não conta). Recebidas são mensagens do cliente (role user); enviadas são respostas do agente e mensagens manuais do painel (role assistant). Contadas pela data em que foram gravadas.",
  results: "Leads novos são contatos criados no período, sem o sandbox. Agendamentos são horários com status marcado ou concluído que começam no período.",
  donut: "Conversas com atividade no período, agrupadas pelo agente que as atendeu. Conversas sem agente vinculado aparecem como 'Sem agente'.",
  attendance: "Só conversas que o paciente iniciou (novo contato ou contato da base que voltou a escrever), na data da chegada. Só IA: só o agente respondeu, sem pessoa nem transferência registrada. Com humano: o agente e a equipe (IA + humano) ou só a equipe (só humano). Abordagens da equipe, campanhas, lembretes e retomadas não entram: a conversa nasceu de nós. Envio automático (lembrete, disparo) não conta como resposta da equipe. O sandbox de teste não conta.",
  closed: "Leads que fecharam um horário efetivado (status 'Agendado' ou 'Concluído'), divididos por quem marcou: a IA, pela ferramenta de agendamento durante a conversa, ou o dono, manualmente no painel. Agendamentos cancelados não contam — antes contavam, o que divergia do KPI 'Agendamentos' ao lado. O sandbox de teste não conta.",
  funnel: "Conversas, leads engajados (2+ mensagens do lead), leads quentes e agendados, todos entre quem CHEGOU no período — o status é o de agora, não há histórico de quando cada lead mudou de etapa. O sandbox de teste não conta.",
  peakHours: "Mensagens do lead (role user) no período, agrupadas por dia da semana e hora, no fuso de Brasília. Mais escuro é mais mensagens. O sandbox de teste não conta.",
  firstResponseTime: "Tempo entre a mensagem do lead e a primeira resposta seguinte na mesma conversa (IA ou humano), agrupado em faixas. Conversas sem resposta no período não entram. O sandbox de teste não conta.",
  autonomyRate: "Das conversas que o paciente iniciou e foram respondidas no período, a fração que só a IA resolveu, sem uma pessoa responder nem transferência registrada. A base soma só IA, IA + humano e só humano — a mesma do gráfico 'Atendimento: IA x humano'. Abordagens da equipe, campanhas, lembretes e retomadas ficam fora; o período anterior usa a mesma regra.",
  followUpRecovery: "Conversas com um follow-up automático enviado no período e, destas, quantas tiveram uma resposta do lead depois do envio, dentro do mesmo período.",
  attendanceOutcome: "Consultas de pé cujo horário caiu no período, pelo comparecimento marcado na agenda (ou mapeado do Clinicorp): compareceu ou faltou. Agendar ou confirmar não conta como comparecimento — consulta que ninguém conferiu aparece como não verificada na tabela, e cancelada não entra.",
};

/**
 * Card de gráfico do relatório. As ações "Ampliar" e "Como é calculado" vêm do
 * `ChartActions` compartilhado (ver `src/components/charts/ChartActions.tsx`).
 */
export function ChartPanel({
  title,
  hint,
  variant,
  flow,
  results,
  slices,
  attendance,
  closed,
  funnel,
  peakHours,
  firstResponseTime,
  autonomyRate,
  followUpRecovery,
  attendanceOutcome,
}: {
  title: string;
  hint: string;
  variant: Variant;
  flow?: FlowPoint[];
  results?: ResultPoint[];
  slices?: { name: string; count: number }[];
  attendance?: AttendancePoint[];
  closed?: AiHumanPoint[];
  funnel?: FunnelStep[];
  peakHours?: HeatmapCell[];
  firstResponseTime?: ResponseTimeBucket[];
  autonomyRate?: { current: number; previous: number | null };
  followUpRecovery?: { sent: number; recovered: number };
  attendanceOutcome?: AttendanceOutcomePoint[];
}) {
  const chart = (tall: boolean) => {
    switch (variant) {
      case "flow":
        return <FlowChart points={flow ?? []} className={tall ? "h-64" : undefined} />;
      case "results":
        return <BarsChart points={results ?? []} className={tall ? "h-64" : undefined} />;
      case "donut":
        return <DonutChart slices={slices ?? []} className={tall ? "h-48 w-48" : undefined} />;
      case "attendance":
        return (
          <SeriesChart
            points={(attendance ?? []).map((p) => ({ key: p.key, label: p.label, a: p.ai, b: p.human }))}
            labelA="Só IA"
            labelB="Com humano"
            colorA="text-success"
            colorB="text-warn"
            empty="Nenhuma conversa com resposta no período."
            className={tall ? "h-64" : undefined}
          />
        );
      case "closed":
        return (
          <SeriesChart
            points={(closed ?? []).map((p) => ({ key: p.key, label: p.label, a: p.ai, b: p.human }))}
            labelA="IA"
            labelB="Humano"
            colorA="text-iris"
            colorB="text-success"
            empty="Nenhum agendamento no período."
            className={tall ? "h-64" : undefined}
          />
        );
      case "funnel":
        return <FunnelChart steps={funnel ?? []} />;
      case "peakHours":
        return <HeatmapChart cells={peakHours ?? []} />;
      case "firstResponseTime": {
        const points = firstResponseTime ?? [];
        return (
          <HorizontalBars
            points={points.map((p) => ({ key: p.label, label: p.label, value: p.ai + p.human, secondaryLabel: p.human > 0 ? `${p.ai} IA · ${p.human} humano` : undefined }))}
            empty="Nenhuma resposta registrada no período."
          />
        );
      }
      case "autonomyRate": {
        const rate = autonomyRate ?? { current: 0, previous: null };
        const delta = rate.previous !== null ? rate.current - rate.previous : null;
        return (
          <MeterChart
            value={rate.current}
            label="Resolvido sem humano"
            delta={delta}
            hint="Dos contatos atendidos no período."
          />
        );
      }
      case "followUpRecovery": {
        const r = followUpRecovery ?? { sent: 0, recovered: 0 };
        if (r.sent === 0) {
          return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhum follow-up enviado no período.</p>;
        }
        return (
          <HorizontalBars
            points={[
              { key: "sent", label: "Follow-ups enviados", value: r.sent },
              { key: "recovered", label: "Com resposta depois", value: r.recovered, secondaryLabel: `${Math.round((r.recovered / r.sent) * 100)}%` },
            ]}
            empty="Nenhum follow-up enviado no período."
            colorClass="bg-success"
          />
        );
      }
      case "attendanceOutcome":
        return (
          <SeriesChart
            points={(attendanceOutcome ?? []).map((p) => ({ key: p.key, label: p.label, a: p.attended, b: p.noShow }))}
            labelA="Compareceu"
            labelB="Faltou"
            colorA="text-success"
            colorB="text-warn"
            empty="Nenhum comparecimento marcado no período. Marque na agenda quem veio e quem faltou."
            className={tall ? "h-64" : undefined}
          />
        );
    }
  };

  // Tabela completa do gráfico + totais (o "mais informações" da tela cheia).
  const table = (() => {
    if (variant === "flow") {
      const points = flow ?? [];
      const tIn = points.reduce((s, p) => s + p.inbound, 0);
      const tOut = points.reduce((s, p) => s + p.outbound, 0);
      return {
        head: ["Período", "Recebidas", "Enviadas"],
        rows: points.map((p) => [p.label, String(p.inbound), String(p.outbound)]),
        foot: ["Total", String(tIn), String(tOut)],
      };
    }
    if (variant === "results") {
      const points = results ?? [];
      const tL = points.reduce((s, p) => s + p.leads, 0);
      const tA = points.reduce((s, p) => s + p.appts, 0);
      return {
        head: ["Período", "Leads novos", "Agendamentos"],
        rows: points.map((p) => [p.label, String(p.leads), String(p.appts)]),
        foot: ["Total", String(tL), String(tA)],
      };
    }
    if (variant === "attendance") {
      const points = attendance ?? [];
      const total = (pick: (p: AttendancePoint) => number) => String(points.reduce((s, p) => s + pick(p), 0));
      return {
        head: ["Período", "Só IA", "IA + humano", "Só humano"],
        rows: points.map((p) => [p.label, String(p.ai), String(p.aiAndHuman), String(p.humanOnly)]),
        foot: ["Total", total((p) => p.ai), total((p) => p.aiAndHuman), total((p) => p.humanOnly)],
      };
    }
    if (variant === "closed") {
      const points = closed ?? [];
      const tAi = points.reduce((s, p) => s + p.ai, 0);
      const tHuman = points.reduce((s, p) => s + p.human, 0);
      return {
        head: ["Período", "IA", "Humano"],
        rows: points.map((p) => [p.label, String(p.ai), String(p.human)]),
        foot: ["Total", String(tAi), String(tHuman)],
      };
    }
    if (variant === "funnel") {
      const steps = funnel ?? [];
      const first = steps[0]?.count ?? 0;
      return {
        head: ["Degrau", "Contagem", "Do primeiro degrau"],
        rows: steps.map((s) => [s.name, String(s.count), first > 0 ? `${Math.round((s.count / first) * 100)}%` : "—"]),
        foot: ["—", "—", "—"],
      };
    }
    if (variant === "peakHours") {
      const cells = (peakHours ?? []).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
      const weekdayLabel = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
      const totalCells = cells.reduce((s, c) => s + c.count, 0);
      return {
        head: ["Dia", "Hora", "Mensagens"],
        rows: cells.map((c) => [weekdayLabel[c.weekday], `${c.hour}h`, String(c.count)]),
        foot: ["Total", "—", String(totalCells)],
      };
    }
    if (variant === "firstResponseTime") {
      const points = firstResponseTime ?? [];
      const tAi = points.reduce((s, p) => s + p.ai, 0);
      const tHuman = points.reduce((s, p) => s + p.human, 0);
      return {
        head: ["Faixa", "IA", "Humano"],
        rows: points.map((p) => [p.label, String(p.ai), String(p.human)]),
        foot: ["Total", String(tAi), String(tHuman)],
      };
    }
    if (variant === "autonomyRate") {
      const rate = autonomyRate ?? { current: 0, previous: null };
      return {
        head: ["Período", "Resolução autônoma"],
        rows: [
          ["Atual", `${Math.round(rate.current * 100)}%`],
          ["Anterior", rate.previous === null ? "—" : `${Math.round(rate.previous * 100)}%`],
        ],
        foot: ["—", "—"],
      };
    }
    if (variant === "followUpRecovery") {
      const r = followUpRecovery ?? { sent: 0, recovered: 0 };
      return {
        head: ["Indicador", "Valor"],
        rows: [
          ["Follow-ups enviados", String(r.sent)],
          ["Com resposta depois", String(r.recovered)],
          ["Taxa de recuperação", r.sent > 0 ? `${Math.round((r.recovered / r.sent) * 100)}%` : "—"],
        ],
        foot: ["—", "—"],
      };
    }
    if (variant === "attendanceOutcome") {
      const points = attendanceOutcome ?? [];
      const sum = (pick: (p: AttendanceOutcomePoint) => number) => String(points.reduce((s, p) => s + pick(p), 0));
      return {
        head: ["Período", "Compareceu", "Faltou", "Não verificado"],
        rows: points.map((p) => [p.label, String(p.attended), String(p.noShow), String(p.unknown)]),
        foot: ["Total", sum((p) => p.attended), sum((p) => p.noShow), sum((p) => p.unknown)],
      };
    }
    const parts = slices ?? [];
    const total = parts.reduce((s, x) => s + x.count, 0);
    return {
      head: ["Agente", "Conversas", "Participação"],
      rows: parts.map((s) => [s.name, String(s.count), `${Math.round((s.count / total) * 100)}%`]),
      foot: ["Total", String(total), "100%"],
    };
  })();

  // Origem dos dados: o que compõe o resultado (a tabela resumo do diálogo).
  const sources: [string, string][] = (() => {
    if (variant === "flow") {
      const points = flow ?? [];
      return [
        ["Mensagens recebidas do cliente", String(points.reduce((s, p) => s + p.inbound, 0))],
        ["Mensagens enviadas (agente + painel)", String(points.reduce((s, p) => s + p.outbound, 0))],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "results") {
      const points = results ?? [];
      return [
        ["Leads novos", String(points.reduce((s, p) => s + p.leads, 0))],
        ["Agendamentos", String(points.reduce((s, p) => s + p.appts, 0))],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "attendance") {
      const points = attendance ?? [];
      return [
        ["Iniciadas pelo paciente, só IA", String(points.reduce((s, p) => s + p.ai, 0))],
        ["Iniciadas pelo paciente, IA + humano", String(points.reduce((s, p) => s + p.aiAndHuman, 0))],
        ["Iniciadas pelo paciente, só humano", String(points.reduce((s, p) => s + p.humanOnly, 0))],
        ["Abordagens, campanhas e lembretes", "fora da base"],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "closed") {
      const points = closed ?? [];
      return [
        ["Agendamentos fechados pela IA", String(points.reduce((s, p) => s + p.ai, 0))],
        ["Agendamentos fechados manualmente", String(points.reduce((s, p) => s + p.human, 0))],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
        ["Cancelados", "excluídos"],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "funnel") {
      const steps = funnel ?? [];
      return steps.map((s): [string, string] => [s.name, String(s.count)]);
    }
    if (variant === "peakHours") {
      const cells = peakHours ?? [];
      const total = cells.reduce((s, c) => s + c.count, 0);
      const peak = cells.reduce((best, c) => (c.count > best.count ? c : best), cells[0]);
      const weekdayLabel = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
      return [
        ["Mensagens do lead no período", String(total)],
        ["Pico", peak ? `${weekdayLabel[peak.weekday]} às ${peak.hour}h (${peak.count})` : "—"],
        ["Fuso", "Brasília (America/Sao_Paulo)"],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "firstResponseTime") {
      const points = firstResponseTime ?? [];
      return [
        ["Respostas da IA", String(points.reduce((s, p) => s + p.ai, 0))],
        ["Respostas humanas", String(points.reduce((s, p) => s + p.human, 0))],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "autonomyRate") {
      const rate = autonomyRate ?? { current: 0, previous: null };
      return [
        ["Resolução autônoma atual", `${Math.round(rate.current * 100)}%`],
        ["Período anterior", rate.previous === null ? "—" : `${Math.round(rate.previous * 100)}%`],
      ];
    }
    if (variant === "followUpRecovery") {
      const r = followUpRecovery ?? { sent: 0, recovered: 0 };
      return [
        ["Follow-ups enviados", String(r.sent)],
        ["Com resposta depois do envio", String(r.recovered)],
      ];
    }
    if (variant === "attendanceOutcome") {
      const points = attendanceOutcome ?? [];
      return [
        ["Compareceu", String(points.reduce((s, p) => s + p.attended, 0))],
        ["Faltou", String(points.reduce((s, p) => s + p.noShow, 0))],
        ["Não verificado", String(points.reduce((s, p) => s + p.unknown, 0))],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
      ];
    }
    const parts = slices ?? [];
    const total = parts.reduce((s, x) => s + x.count, 0);
    return [
      ["Total de conversas", String(total)],
      ["Agentes distintos", String(parts.length)],
      ["Testes (sandbox)", "excluídos"],
    ];
  })();

  return (
    <Card>
      {/*
        Sem `hint` no título de propósito: o gráfico já tem o botão ⓘ ao lado,
        e duas fontes de explicação no mesmo canto competem entre si. O resumo
        (`hint`) virou a primeira linha do painel do ⓘ, acima do detalhe.
      */}
      <CardTitle
        action={
          <ChartActions
            label={title}
            title={title}
            hint={hint}
            description={DESCRIPTIONS[variant]}
            sources={sources}
            full={
              <>
                {chart(true)}
                <ChartTable head={table.head} rows={table.rows} foot={table.foot} />
              </>
            }
          />
        }
      >
        {title}
      </CardTitle>

      {chart(false)}
    </Card>
  );
}
