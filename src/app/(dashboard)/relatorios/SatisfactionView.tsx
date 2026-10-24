import Link from "next/link";
import { MessageSquareText, Star } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat } from "@/components/ui/stat";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import { dateTimeLabel } from "@/lib/format";
import { topicLabel } from "@/modules/satisfaction/categories";
import { averageIsReliable, MIN_ANSWERS_FOR_AVERAGE } from "@/modules/satisfaction/summary";
import type { SatisfactionOverview } from "@/modules/satisfaction/queries";
import { describeSurveySettings, type SurveySettings } from "@/modules/satisfaction/settings";
import { SurveyRowActions } from "./SurveyRowActions";
import { SurveySettingsForm, SurveyTestForm } from "./SurveySettingsForm";

const fmtAverage = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const ratingTone = (r: number) => (r <= 2 ? "danger" : r === 3 ? "warn" : "success");

/**
 * Satisfação dos contatos: configuração da pesquisa no topo, nota média,
 * distribuição, motivos de melhoria e as respostas com link para a conversa.
 * Só nota, motivo e o que o contato escreveu — nenhum nome ou telefone. Para
 * quem não é da clínica o comentário já chega mascarado (`maskComments`).
 */
export function SatisfactionView({
  overview,
  settings,
  period,
  ratingFilter,
  agentFilter,
  hrefFor,
  linkConversations,
}: {
  overview: SatisfactionOverview;
  settings: SurveySettings;
  period: string;
  ratingFilter: number | null;
  agentFilter: string | null;
  /** Monta a URL mantendo visão e período, trocando os filtros. */
  hrefFor: (filters: { nota?: string | null; agente?: string | null }) => string;
  linkConversations: boolean;
}) {
  const { summary: s, rows, agents, toReview } = overview;

  return (
    <div className="space-y-6">
      <Card className="space-y-6">
        <CardTitle hint="Depois da conversa, o agente pede uma nota de 1 a 5 e uma frase sobre o atendimento. Fica fora da cota de mensagens e nunca entra no histórico da conversa.">
          Pesquisa de satisfação · {describeSurveySettings(settings)}
        </CardTitle>
        <SurveySettingsForm settings={settings} />
        <div className="border-t border-ink/10 pt-6 panel:border-white/10">
          <SurveyTestForm />
        </div>
      </Card>

      {toReview > 0 && (
        <Alert tone="warn" title={`${toReview} ${toReview === 1 ? "avaliação com nota 1 ou 2 para revisar" : "avaliações com nota 1 ou 2 para revisar"}`}>
          Abra a conversa, veja o que aconteceu e marque como revisada.
        </Alert>
      )}

      {s.answered === 0 && s.sent === 0 ? (
        <Card>
          <EmptyState
            icon={Star}
            title="Ainda não há avaliações neste período"
            description={
              settings.enabled
                ? "Assim que contatos terminarem a conversa e responderem à pesquisa, a nota aparece aqui."
                : "Ligue a pesquisa acima para começar a medir a satisfação dos contatos."
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Nota média"
              value={s.average === null ? "—" : fmtAverage(s.average)}
              hint={s.average === null ? "sem respostas" : averageIsReliable(s.answered) ? "de 5" : `amostra pequena (menos de ${MIN_ANSWERS_FOR_AVERAGE})`}
              about="Média das notas dadas no período. Conversas de teste ficam de fora."
            />
            <Stat label="Respostas" value={String(s.answered)} hint={`de ${s.sent} ${s.sent === 1 ? "pesquisa enviada" : "pesquisas enviadas"}`} />
            <Stat
              label="Taxa de resposta"
              value={s.responseRatePercent === null ? "—" : `${s.responseRatePercent}%`}
              hint={period}
              about="Respostas com nota no período contra pesquisas que os contatos receberam no mesmo período."
            />
            <Stat label="Com comentário" value={String(s.withComment)} hint={s.unclassified > 0 ? `${s.unclassified} ainda sem motivo` : "todos com motivo"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle hint="Quantas notas de cada valor.">Distribuição das notas</CardTitle>
              <HorizontalBars
                empty="Nenhuma nota neste período."
                colorClass="bg-iris"
                points={[5, 4, 3, 2, 1].map((n) => ({
                  key: String(n),
                  label: `${n} ${n === 1 ? "estrela" : "estrelas"}`,
                  value: s.distribution[n - 1],
                  secondaryLabel: s.answered ? `${Math.round((s.distribution[n - 1] / s.answered) * 100)}%` : undefined,
                }))}
              />
            </Card>
            <Card>
              <CardTitle hint="O que os contatos disseram que poderia melhorar. A IA sugere o motivo; você pode corrigir na lista abaixo.">
                Pontos de melhoria
              </CardTitle>
              <HorizontalBars
                empty="Nenhum ponto de melhoria apontado neste período."
                colorClass="bg-warn"
                points={s.topics.map((t) => ({ key: t.key, label: t.label, value: t.count }))}
              />
            </Card>
          </div>

          <Card className="space-y-4">
            <CardTitle hint="Mais recentes primeiro (até 100). A nota, o motivo e o que a pessoa escreveu — o nome do contato fica na conversa.">
              Respostas
            </CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <FilterTabs
                label="Filtrar por nota"
                active={ratingFilter ? String(ratingFilter) : "todas"}
                href={(key) => hrefFor({ nota: key === "todas" ? null : key, agente: agentFilter })}
                options={[{ key: "todas", label: "Todas" }, ...[1, 2, 3, 4, 5].map((n) => ({ key: String(n), label: `${n}★` }))]}
              />
              {agents.length > 1 && (
                <FilterTabs
                  label="Filtrar por agente"
                  active={agentFilter ?? "todos"}
                  href={(key) => hrefFor({ nota: ratingFilter ? String(ratingFilter) : null, agente: key === "todos" ? null : key })}
                  options={[{ key: "todos", label: "Todos os agentes" }, ...agents.map((a) => ({ key: a.id, label: a.name }))]}
                />
              )}
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral panel:text-white/55">Nenhuma resposta com esse filtro.</p>
            ) : (
              <ul className="divide-y divide-ink/10 panel:divide-white/10">
                {rows.map((r) => (
                  <li key={r.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ratingTone(r.rating)} icon={<Star size={12} aria-hidden />}>
                        nota {r.rating}
                      </Badge>
                      {r.topics.map((t) => <Badge key={t} tone="neutral">{topicLabel(t)}</Badge>)}
                      {r.rating <= 2 && !r.reviewedAt && <Badge tone="warn">para revisar</Badge>}
                      {r.reviewedAt && <Badge tone="success">revisada</Badge>}
                      <span className="text-sm text-neutral panel:text-white/60">
                        {dateTimeLabel(r.ratedAt)}
                        {r.agentName && <> · agente {r.agentName}</>}
                      </span>
                    </div>
                    {r.comment ? (
                      <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-ink panel:text-white/85">“{r.comment}”</p>
                    ) : (
                      <p className="text-sm text-neutral panel:text-white/55">
                        {r.hasAudioComment ? "Respondeu por áudio. Abra a conversa para ouvir." : "Sem comentário."}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <SurveyRowActions id={r.id} topic={r.topics[0] ?? ""} canReview={r.rating <= 2 && !r.reviewedAt} />
                      {linkConversations && (
                        <Link
                          href={`/conversas?status=all&id=${r.conversationId}`}
                          className="inline-flex items-center gap-1.5 text-sm text-iris underline-offset-2 hover:underline panel:text-white/85"
                        >
                          <MessageSquareText size={14} aria-hidden />
                          Abrir conversa
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <p className="text-xs leading-relaxed text-neutral panel:text-white/55">
        A pesquisa só vai para quem conversou de verdade e não passou pela equipe, uma vez a cada 30 dias por contato, dentro das 24 horas do WhatsApp. Nota e comentário ficam fora do histórico da conversa e da cota de mensagens. Conversas de teste não entram nestes números.
      </p>
    </div>
  );
}
