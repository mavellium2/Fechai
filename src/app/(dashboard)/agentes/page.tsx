import { requireTenant } from "@/lib/session";
import type { PersonaAnswers } from "@/modules/agent-engine/persona";
import { AgentsFrame, getAgentsNavigation } from "./AgentsFrame";
import { AgentDirectory } from "./AgentDirectory";

export default async function AgentesPage() {
  const { tenantId } = await requireTenant();
  const [agents, usage] = await getAgentsNavigation(tenantId);
  return <AgentsFrame><AgentDirectory usage={usage} agents={agents.map(agent => {
    const persona = (agent.personaDraft ?? {}) as Partial<PersonaAnswers>;
    return { id: agent.id, name: agent.name, enabled: agent.enabled, isPrimary: agent.isPrimary,
      caption: persona.sector || "Atendimento", description: persona.objective || persona.offer || "" };
  })} /></AgentsFrame>;
}
