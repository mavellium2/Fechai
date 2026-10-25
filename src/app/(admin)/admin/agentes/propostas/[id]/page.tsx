import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PERSONA_FIELDS } from "@/modules/agent-engine/persona";
import { agentBaseHash } from "@/modules/agent-engine/persona-apply";
import {
  diffFromStored,
  effectiveStatus,
  lineDiff,
  parseStoredSide,
  PROPOSAL_STATUS_LABELS,
  type ProposalStatus,
} from "@/modules/agent-mcp/proposals";
import { ProposalDecision } from "./ProposalDecision";

const TONE: Record<ProposalStatus, "success" | "warn" | "danger" | "neutral" | "iris"> = {
  pending: "iris",
  applied: "success",
  rejected: "neutral",
  expired: "warn",
  stale: "warn",
};

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const FIELD_LABEL: Record<string, string> = {
  ...Object.fromEntries(PERSONA_FIELDS.map((field) => [field.name, field.label])),
  avoid: "Regras (uma por linha)",
};

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  // A página e as actions checam o superadmin por conta própria.
  await requireSuperadmin();
  const { id } = await params;

  const proposal = await prisma.agentChangeProposal.findUnique({
    where: { id },
    include: { tenant: { select: { name: true } }, agent: { select: { name: true, systemPrompt: true, objective: true, personaDraft: true } } },
  });
  if (!proposal) notFound();

  const before = parseStoredSide(proposal.before);
  const after = parseStoredSide(proposal.after);
  const status = effectiveStatus(proposal);
  const diff = before && after ? diffFromStored(before, after) : [];
  const promptDiff = before && after ? lineDiff(before.systemPrompt, after.systemPrompt) : [];
  // O agente de agora ainda é o da proposta? Se não, aprovar vai recusar.
  const drifted = status === "pending" && agentBaseHash(proposal.agent) !== proposal.baseHash;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Proposta de mudança do agente"
        description={`${proposal.tenant.name} · agente ${proposal.agent.name}`}
        actions={
          <ButtonLink href="/admin/agentes/mcp" variant="outline" size="sm">
            <ArrowLeft size={14} aria-hidden />
            Acesso MCP
          </ButtonLink>
        }
      />

      <section className="rounded-surface border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={TONE[status]}>{PROPOSAL_STATUS_LABELS[status]}</Badge>
          <span className="text-xs text-white/50">Criada em {dateTime.format(proposal.createdAt)}</span>
          <span className="text-xs text-white/50">Vence em {dateTime.format(proposal.expiresAt)}</span>
        </div>
        <h2 className="font-display mt-4 text-lg font-semibold text-white">Por que</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-white/80">{proposal.reason || "Sem justificativa."}</p>
      </section>

      {drifted && (
        <Alert tone="warn" title="O agente mudou depois desta proposta">
          Se você aprovar, ela será marcada como desatualizada e nada será gravado. Peça uma nova proposta.
        </Alert>
      )}
      {status === "expired" && (
        <Alert tone="warn" title="Proposta vencida">
          Passou de 7 dias sem decisão. Nada será gravado; peça uma nova.
        </Alert>
      )}
      {!before || !after ? (
        <Alert tone="danger" title="Proposta ilegível">
          Os dados desta proposta não puderam ser lidos. Recuse e peça outra.
        </Alert>
      ) : null}

      <section className="rounded-surface border border-white/10 bg-white/5 p-6">
        <h2 className="font-display text-lg font-semibold text-white">O que muda</h2>
        {diff.length === 0 ? (
          <p className="mt-3 text-sm text-white/60">Nenhum campo.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {diff.map((item) => (
              <div key={item.field}>
                <p className="text-sm font-medium text-white">{FIELD_LABEL[item.field] ?? item.field}</p>
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  <pre className="whitespace-pre-wrap break-words rounded-control bg-danger/10 px-3 py-2 font-mono text-xs text-white/80">
                    {item.before || "(vazio)"}
                  </pre>
                  <pre className="whitespace-pre-wrap break-words rounded-control bg-success/10 px-3 py-2 font-mono text-xs text-white/80">
                    {item.after || "(vazio)"}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-surface border border-white/10 bg-white/5 p-6">
        <h2 className="font-display text-lg font-semibold text-white">Prompt do agente, linha a linha</h2>
        <p className="mt-1 text-xs text-white/50">Vermelho sai, verde entra. É o texto que o agente recebe de instrução.</p>
        <div className="mt-4 overflow-x-auto rounded-control bg-ink/60 py-2 font-mono text-xs">
          {promptDiff.map((line, index) => (
            <div
              key={index}
              className={
                line.type === "add"
                  ? "bg-success/15 px-3 text-white"
                  : line.type === "remove"
                    ? "bg-danger/15 px-3 text-white/80"
                    : "px-3 text-white/60"
              }
            >
              <span aria-hidden className="mr-2 inline-block w-3 select-none">
                {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
              </span>
              <span className="sr-only">{line.type === "add" ? "Linha nova: " : line.type === "remove" ? "Linha removida: " : ""}</span>
              {line.text || " "}
            </div>
          ))}
        </div>
      </section>

      {status === "pending" ? (
        <ProposalDecision proposalId={proposal.id} />
      ) : (
        <section className="rounded-surface border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          <h2 className="font-display text-lg font-semibold text-white">Decisão</h2>
          {proposal.decidedAt ? (
            <p className="mt-2">
              {PROPOSAL_STATUS_LABELS[status]} em {dateTime.format(proposal.decidedAt)}
              {proposal.decidedByEmail ? ` por ${proposal.decidedByEmail}` : ""}.
            </p>
          ) : (
            <p className="mt-2">Sem decisão registrada.</p>
          )}
          {proposal.rejectReason && <p className="mt-2 whitespace-pre-wrap">Motivo: {proposal.rejectReason}</p>}
        </section>
      )}
    </div>
  );
}
