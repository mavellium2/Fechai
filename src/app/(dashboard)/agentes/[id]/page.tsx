import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { planOf } from "@/modules/billing/plans";
import { getAgentOwned } from "@/modules/agent-engine/agents";
import { isActionAvailable } from "@/modules/agent-engine/actions";
import { getScheduleConfig } from "@/modules/scheduling/repository";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import { getClinicorpStatus } from "@/modules/scheduling/clinicorp";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import { getFollowUpConfig } from "@/modules/follow-up/config";
import { getHandoffConfig } from "@/modules/agent-engine/handoff";
import { isFishAudioConfigured } from "@/modules/voice/fish";
import { catalogVoiceByReferenceId } from "@/modules/voice/catalog";
import type { PersonaAnswers } from "@/modules/agent-engine/persona";
import { parseVariableDefinitions } from "@/modules/agent-engine/variables";
import { AgentWizard } from "./AgentWizard";
import { AgentsFrame } from "../AgentsFrame";

export default async function AgentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenantId } = await requireTenant();

  const agent = await getAgentOwned(tenantId, id);
  // 404 e não "acesso negado": para quem não é dono, o agente não existe.
  if (!agent) notFound();

  const [tenant, documents, tenantActions, agentCount, scheduleConfig, followUpConfig, handoffConfig, calendarFeatures, clinicorp, metaConnection] =
    await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { planKey: true } }),
      prisma.knowledgeDocument.findMany({
        where: { tenantId, agentId: agent.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, status: true, createdAt: true, fileUrl: true, fileName: true },
      }),
      prisma.tenantAction.findMany({
        where: { agentId: agent.id, enabled: true },
        select: { key: true },
      }),
      prisma.agent.count({ where: { tenantId, archived: false } }),
      getScheduleConfig(agent.id),
      getFollowUpConfig(agent.id),
      getHandoffConfig(agent.id),
      getCalendarFeatures(tenantId),
      getClinicorpStatus(tenantId),
      getBroadcastConnection(tenantId),
    ]);

  // Habilitado E com credencial salva: é o que decide se vale oferecer "trazer
  // os tipos do Clinicorp" na configuração de agendamento. Mesma dupla que a
  // /agenda usa para o aviso de envio. Esconder o botão não é autorização — a
  // action confere a flag de novo no servidor.
  // `getClinicorpStatus` devolve null quando não há credencial salva.
  const clinicorpConnected = Boolean(calendarFeatures.clinicorpEnabled && clinicorp);
  // API oficial da Meta ativa: fora da janela de 24h (inclusive quem nunca
  // conversou com o número, como os pacientes do Clinicorp) o lembrete só sai
  // por ela, com template aprovado.
  const metaReminders = Boolean(metaConnection);

  // Desativadas temporariamente não contam como "ação ativa" no checklist.
  const actions = tenantActions.filter((a) => isActionAvailable(a.key));

  const rules = (agent.personaDraft as Partial<PersonaAnswers> | null)?.avoid ?? "";

  return (
    <AgentsFrame>
      <AgentWizard
        key={agent.id}
        agent={{
          id: agent.id,
          name: agent.name,
          isPrimary: agent.isPrimary,
          enabled: agent.enabled,
        }}
        canDelete={agentCount > 1}
        canDuplicate={agentCount < planOf(tenant?.planKey).maxAgents}
        persona={(agent.personaDraft as Partial<PersonaAnswers> | null) ?? {}}
        rules={rules}
        variableDefinitions={parseVariableDefinitions(agent.variableDefinitions)}
        documents={documents}
        enabledKeys={actions.map((a) => a.key)}
        planLimit={planOf(tenant?.planKey).maxActiveActions}
        scheduleConfig={scheduleConfig}
        clinicorpConnected={clinicorpConnected}
        metaReminders={metaReminders}
        followUpConfig={followUpConfig}
        handoffConfig={handoffConfig}
        listenAudio={agent.listenAudio}
        speakReplies={agent.speakReplies}
        stopOnEmoji={agent.stopOnEmoji}
        voice={
          agent.voiceId
            ? {
                label: agent.voiceLabel,
                createdAt: agent.voiceCreatedAt,
                source: agent.voiceSource,
              }
            : null
        }
        catalogKey={catalogVoiceByReferenceId(agent.voiceId)?.key ?? null}
        voiceAvailable={isFishAudioConfigured()}
        speechBlocklist={agent.speechBlocklist}
        voiceStyle={agent.voiceStyle}
        voicePrompt={agent.voicePrompt}
      />
    </AgentsFrame>
  );
}
