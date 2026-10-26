import { cache } from "react";
import { requireTenant } from "@/lib/session";
import { agentSteps, getAgentUsage, listAgents } from "@/modules/agent-engine/agents";
import { AgentsSidebar } from "./AgentsSidebar";

export const getAgentsNavigation = cache((tenantId: string) =>
  Promise.all([listAgents(tenantId), getAgentUsage(tenantId)]),
);

/** Read with the page so creation, import and rename never leave a cached layout list. */
export async function AgentsFrame({ children }: { children: React.ReactNode }) {
  const { tenantId } = await requireTenant();
  const [agents, usage] = await getAgentsNavigation(tenantId);
  return (
    <div className="agents-layout">
      <AgentsSidebar usage={usage} agents={agents.map((agent) => ({
        id: agent.id, name: agent.name, enabled: agent.enabled, isPrimary: agent.isPrimary,
        ready: agentSteps(agent).every((step) => step.done),
        hasKnowledge: agent._count.knowledgeDocs > 0,
      }))} />
      <div className="agents-page">{children}</div>
    </div>
  );
}
