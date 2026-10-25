import { Bot, KeyRound } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { planOf } from "@/modules/billing/plans";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { AdminAgentReplicator } from "./AdminAgentReplicator";

export default async function AdminAgentsPage() {
  await requireSuperadmin();
  const tenants = await prisma.tenant.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      planKey: true,
      status: true,
      agents: {
        where: { archived: false },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { id: true, name: true, enabled: true, isPrimary: true },
      },
    },
  });

  const sources = tenants.flatMap((tenant) =>
    tenant.agents.map((agent) => ({
      id: agent.id,
      tenantId: tenant.id,
      label: `${tenant.name} — ${agent.name}`,
      detail: `${agent.isPrimary ? "principal" : "secundário"} · ${agent.enabled ? "ligado" : "desligado"}`,
    })),
  );
  const destinations = tenants.map((tenant) => ({
    id: tenant.id,
    label: tenant.name,
    status: tenant.status,
    used: tenant.agents.length,
    limit: planOf(tenant.planKey).maxAgents,
  }));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Replicar agentes"
        description="Copie um agente completo entre empresas sem levar conversas, contatos ou agenda. A cópia nasce desligada."
        actions={
          <ButtonLink href="/admin/agentes/mcp" variant="outline" size="sm">
            <KeyRound size={14} aria-hidden />
            Acesso MCP
          </ButtonLink>
        }
      />

      {sources.length === 0 ? (
        <div className="rounded-surface border border-white/10 bg-white/5">
          <EmptyState
            icon={Bot}
            title="Nenhum agente disponível"
            description="Crie uma conta com agente antes de usar a replicação entre empresas."
          />
        </div>
      ) : (
        <AdminAgentReplicator sources={sources} destinations={destinations} />
      )}
    </div>
  );
}
