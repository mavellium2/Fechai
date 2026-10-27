import { cache } from "react";
import { requireTenant } from "@/lib/session";
import { getAgentUsage, listAgents } from "@/modules/agent-engine/agents";

export const getAgentsNavigation = cache((tenantId: string) =>
  Promise.all([listAgents(tenantId), getAgentUsage(tenantId)]),
);

/** Read with the page so creation, import and rename never leave a cached layout list. */
export async function AgentsFrame({ children }: { children: React.ReactNode }) {
  await requireTenant();
  return (
    <div className="agents-layout">
      <div className="agents-page">{children}</div>
    </div>
  );
}
