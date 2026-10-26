import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { agentSteps } from "@/modules/agent-engine/agents";
import { NewAgentButton } from "./NewAgentButton";
import { AgentsFrame, getAgentsNavigation } from "./AgentsFrame";

export default async function AgentesPage() {
  const { tenantId } = await requireTenant();
  const [agents, usage] = await getAgentsNavigation(tenantId);
  return (
    <AgentsFrame><section className="agents-index">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Seus agentes</h1>
          <p className="mt-1 text-sm text-neutral">Escolha um agente para conhecer e ajustar o que ele faz.</p>
        </div>
        <NewAgentButton usage={usage} />
      </header>
      {agents.length ? (
        <ul className="mt-8 grid gap-3 lg:grid-cols-2">
          {agents.map((agent) => {
            const ready = agentSteps(agent).every((step) => step.done);
            return (
              <li key={agent.id}>
                <Link href={`/agentes/${agent.id}`} className="agent-overview-link">
                  <span className="agent-overview-avatar">{agent.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{agent.name}</span>
                    <span className="mt-1 block text-xs text-neutral">{!agent.enabled ? "Desligado" : !ready ? "Configuração incompleta" : agent.isPrimary ? "Atende o WhatsApp" : "Pronto · só no teste"}</span>
                    <span className="mt-2 block text-xs text-neutral">{agent._count.knowledgeDocs} documentos · {agent._count.conversations} conversas</span>
                  </span>
                  <ArrowRight size={17} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="agents-empty">
          <Bot size={36} aria-hidden />
          <h2 className="mt-4 font-semibold">Seu primeiro agente começa aqui</h2>
          <p className="mt-2 max-w-sm text-sm text-neutral">Crie um agente, defina sua personalidade e adicione o conhecimento do seu negócio.</p>
        </div>
      )}
    </section></AgentsFrame>
  );
}
