import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { countGaps, listGaps, parseGapStatus } from "@/modules/knowledge-gaps/queue";
import { mavelliumAnswers, parseGapSettings } from "@/modules/knowledge-gaps/settings";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { GapCard } from "@/app/(dashboard)/perguntas/GapCard";
import { RespondersControl } from "./RespondersControl";
import { adminApproveGap, adminDismissGap, adminReopenGap, adminResumeGap, adminSaveGapDraft } from "./actions";

/**
 * Filas de perguntas de todas as contas, do lado da Mavellium. Nome e
 * telefone dos contatos são SEMPRE mascarados aqui (LGPD): a Mavellium
 * precisa do contexto da pergunta para responder, não de quem é o paciente.
 * Responder só onde a conta incluiu a Mavellium; nas outras, só a contagem.
 */
export default async function AdminPerguntasPage({ searchParams }: { searchParams: Promise<{ conta?: string; status?: string }> }) {
  await requireSuperadmin();
  const params = await searchParams;
  const status = parseGapStatus(params.status);

  const [tenants, openCounts] = await Promise.all([
    prisma.tenant.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, knowledgeGapSettings: { select: { responders: true } } },
    }),
    prisma.knowledgeGap.groupBy({ by: ["tenantId"], where: { status: "open" }, _count: { _all: true } }),
  ]);
  const openBy = new Map(openCounts.map((c) => [c.tenantId, c._count._all]));
  const rows = tenants
    .map((t) => ({ ...t, responders: parseGapSettings(t.knowledgeGapSettings).responders, open: openBy.get(t.id) ?? 0 }))
    // Primeiro quem espera a Mavellium, depois quem tem fila; o resto no fim.
    .sort((a, b) => Number(mavelliumAnswers(b.responders)) - Number(mavelliumAnswers(a.responders)) || b.open - a.open || a.name.localeCompare(b.name, "pt-BR"));

  const selected = rows.find((t) => t.id === params.conta) ?? null;
  const canAnswer = selected ? mavelliumAnswers(selected.responders) : false;
  const [gaps, counts] = selected && canAnswer
    ? await Promise.all([listGaps(selected.id, status, { masked: true }), countGaps(selected.id)])
    : [[], null];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Perguntas sem resposta"
        description="O que os agentes não souberam responder, por conta. Defina quem responde cada fila; nome e telefone dos contatos aparecem sempre mascarados."
      />

      <Card>
        <CardTitle hint="Clínica: a equipe da conta responde e recebe os avisos. Mavellium: só a Mavellium responde. As duas: qualquer uma aprova.">
          Contas
        </CardTitle>
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">Nenhuma conta ativa.</p>
        ) : (
          <DataTable
            caption="Filas de perguntas por conta"
            head={["Conta", "Na fila", "Quem responde", ""]}
            columnAlign={["left", "right", "right", "right"]}
            rows={rows.map((t) => ({
              id: t.id,
              cells: [
                t.name,
                t.open,
                <RespondersControl key="r" tenantId={t.id} tenantName={t.name} value={t.responders} />,
                mavelliumAnswers(t.responders) ? (
                  <Link
                    key="l"
                    href={`/admin/perguntas?conta=${t.id}`}
                    aria-current={selected?.id === t.id ? "page" : undefined}
                    className="rounded-control text-sm text-white/80 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                  >
                    Abrir fila
                  </Link>
                ) : (
                  <span key="l" className="text-xs text-white/45">a clínica responde</span>
                ),
              ],
            }))}
          />
        )}
      </Card>

      {selected && !canAnswer && (
        <Alert>
          Em {selected.name} a fila é respondida pela clínica. Para responder por aqui, inclua a Mavellium em “Quem responde”.
        </Alert>
      )}

      {selected && canAnswer && counts && (
        <section className="space-y-4" aria-label={`Fila de ${selected.name}`}>
          <h2 className="font-display text-lg font-semibold text-white">{selected.name}</h2>
          <FilterTabs
            accent="signal"
            label="Filtrar perguntas por situação"
            options={[
              { key: "open", label: "Na fila", count: counts.open },
              { key: "answered", label: "Respondidas", count: counts.answered },
              { key: "dismissed", label: "Descartadas", count: counts.dismissed },
            ]}
            active={status}
            href={(key) => `/admin/perguntas?conta=${selected.id}&status=${key}`}
          />
          {gaps.length === 0 ? (
            <Card>
              <EmptyState
                icon={CircleHelp}
                title="Nada nesta situação"
                description="Quando o agente desta conta não souber responder algo, a pergunta aparece aqui, com o trecho da conversa mascarado."
              />
            </Card>
          ) : (
            <ul className="space-y-4">
              {gaps.map((gap) => (
                <li key={gap.id}>
                  <GapCard
                    gap={gap}
                    canAnswer
                    linkConversations={false}
                    actions={{
                      draft: adminSaveGapDraft.bind(null, selected.id),
                      approve: adminApproveGap.bind(null, selected.id),
                      dismiss: adminDismissGap.bind(null, selected.id),
                      reopen: adminReopenGap.bind(null, selected.id),
                      resume: adminResumeGap.bind(null, selected.id),
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
