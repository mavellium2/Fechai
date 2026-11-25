import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";
import { requireProductAccess } from "@/lib/require-product";
import { countGaps, gapStats, listGaps, parseGapStatus } from "@/modules/knowledge-gaps/queue";
import { getGapSettings } from "@/modules/knowledge-gaps/register";
import { clinicAnswers, describeGapNotices, mavelliumAnswers } from "@/modules/knowledge-gaps/settings";
import { formatDuration } from "@/modules/knowledge-gaps/text";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { GapCard } from "./GapCard";
import { GapSettingsForm } from "./GapSettingsForm";
import { GapTrend } from "./GapTrend";
import {
  approveGapAction,
  dismissGapAction,
  reopenGapAction,
  resumeGapAction,
  saveGapDraftAction,
} from "./actions";

export const metadata: Metadata = { title: "Perguntas" };

const EMPTY: Record<string, { title: string; description: string }> = {
  open: {
    title: "Nenhuma pergunta esperando resposta",
    description: "Quando o agente não souber responder algo, a pergunta aparece aqui com o trecho da conversa. Enquanto isso, ele avisa o contato que vai confirmar com a equipe — nunca inventa.",
  },
  answered: {
    title: "Nenhuma resposta aprovada ainda",
    description: "Responda uma pergunta da fila e aprove: o texto entra na base de conhecimento e o agente passa a responder sozinho.",
  },
  dismissed: {
    title: "Nada descartado",
    description: "Perguntas que não são do negócio (engano, assunto de outra área) podem ser descartadas da fila sem ensinar nada ao agente.",
  },
};

export default async function PerguntasPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;
  // Personificando = Mavellium olhando a conta: dados do paciente mascarados.
  const masked = session.user.impersonating === true;
  const status = parseGapStatus((await searchParams).status);

  const settings = await getGapSettings(tenantId);
  const [gaps, counts, stats] = await Promise.all([
    listGaps(tenantId, status, { masked }),
    countGaps(tenantId),
    gapStats(tenantId, settings.timezone),
  ]);
  const canAnswer = masked ? mavelliumAnswers(settings.responders) : clinicAnswers(settings.responders);
  const readOnlyReason = masked
    ? "Nesta conta a fila é respondida pela clínica."
    : "Nesta conta a fila é respondida pela Mavellium. A resposta aparece aqui assim que for aprovada.";

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="perguntas"
        title="Perguntas sem resposta"
        hint="O que o agente não soube responder. Responda uma vez: a resposta entra na base e ele passa a responder sozinho."
      />

      {masked && (
        <Alert title="Visão da Mavellium">
          Nome e telefone dos contatos aparecem mascarados, inclusive dentro do trecho da conversa.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat compact label="Na fila" value={String(stats.open)} hint={stats.open === 1 ? "pergunta aberta" : "perguntas abertas"} />
        <Stat
          compact
          label="Tempo para responder"
          value={formatDuration(stats.avgAnswerSeconds)}
          hint="média dos últimos 30 dias"
          about="Da primeira vez que um contato perguntou até a aprovação da resposta. É o mesmo cálculo do relatório mensal."
        />
        <Stat compact label="Respondidas" value={String(stats.answered30d)} hint="nos últimos 30 dias" />
      </div>

      <GapTrend months={stats.months} />

      <FilterTabs
        label="Filtrar perguntas por situação"
        options={[
          { key: "open", label: "Na fila", count: counts.open },
          { key: "answered", label: "Respondidas", count: counts.answered },
          { key: "dismissed", label: "Descartadas", count: counts.dismissed },
        ]}
        active={status}
        href={(key) => `/perguntas?status=${key}`}
      />

      {gaps.length === 0 ? (
        <Card>
          <EmptyState icon={CircleHelp} title={EMPTY[status].title} description={EMPTY[status].description} />
        </Card>
      ) : (
        <ul className="space-y-4">
          {gaps.map((gap) => (
            <li key={gap.id}>
              <GapCard
                gap={gap}
                canAnswer={canAnswer}
                readOnlyReason={readOnlyReason}
                linkConversations={!masked}
                actions={{
                  draft: saveGapDraftAction,
                  approve: approveGapAction,
                  dismiss: dismissGapAction,
                  reopen: reopenGapAction,
                  resume: resumeGapAction,
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <details>
          <summary className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-iris">
            <span className="font-display text-base font-semibold text-ink panel:text-white">Regra e avisos</span>
            <span className="mt-1 block text-sm text-neutral panel:text-white/60">
              {settings.onUnanswered === "handoff" ? "Passa a conversa para a equipe" : "O agente continua atendendo"} · {describeGapNotices(settings)}
            </span>
          </summary>
          <div className="mt-6 border-t border-ink/10 pt-6 panel:border-white/10">
            <GapSettingsForm settings={settings} />
          </div>
        </details>
      </Card>
    </div>
  );
}
