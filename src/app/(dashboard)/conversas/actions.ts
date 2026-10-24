"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { sendManualReply } from "@/modules/agent-engine/conversation";
import { summarizeConversation } from "@/modules/agent-engine/summary";
import { runAgentTurn, resolveAgent } from "@/modules/agent-engine/orchestrator";
import { recoverPendingAgentReply } from "@/modules/agent-engine/recover-pending";
import { transcribeAudio } from "@/modules/ai/transcribe";
import { MAX_TTS_CHARS, isFishAudioConfigured, synthesize } from "@/modules/voice/fish";
import { toSpeech } from "@/modules/voice/speech-text";

type Result = { ok: boolean; error?: string; info?: string };

/**
 * Teto do áudio gravado à mão (~2 min de voz). Bem acima do `MAX_FORM_BYTES`
 * padrão (512 KB), que existe para formulários de texto: aqui o arquivo É o
 * conteúdo, como no upload da base de conhecimento.
 */
const MAX_VOICE_MESSAGE_BYTES = 8 * 1024 * 1024;

/**
 * Tira a conversa da fila "precisa de você".
 *
 * Fecha o beco sem saída apontado na revisão anterior: o agente marcava
 * `needsHuman` e não havia nada a fazer na tela — a conversa ficava na fila para
 * sempre, mesmo depois de a pessoa atender pelo WhatsApp.
 *
 * `updateMany` com `tenantId` no `where` (e não `update` por id): garante que um
 * id de outra conta não seja alterado, mesmo com a action chamada por POST
 * direto, fora da interface.
 */
export async function resolveConversation(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();

  const res = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { needsHuman: false },
  });

  if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Devolve a conversa para a fila (desfaz o "resolvida" clicado por engano) e
 * devolve o atendimento automático para o agente, se um humano tinha assumido
 * (`sendManualMessage`) — reabrir uma conversa e deixar a IA muda de novo
 * seria o mesmo beco sem saída que essa tela já resolveu uma vez.
 */
export async function reopenConversation(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();

  const res = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { needsHuman: true, agentPaused: false },
  });

  if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Responder manualmente pelo painel — dono da conta digitando no lugar do
 * agente, a partir de uma conversa já aberta. `sendManualReply`
 * (`agent-engine/conversation.ts`) decide envio real vs. simulação de teste,
 * grava com `sentBy: "human"` e pausa o agente nesta conversa; mesmo núcleo
 * usado por `sendMessageToContact` (`contatos/actions.ts`), a partir de um lead.
 */
export async function sendManualMessage(conversationId: string, text: string): Promise<Result> {
  const { tenantId } = await requireTenant();
  const res = await sendManualReply(tenantId, conversationId, text);
  if (!res.ok) return res;

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Manda a resposta como ÁUDIO, na voz do agente: você escreve, a Fish Audio
 * fala. É a mesma voz que o agente usa sozinho — o cliente não percebe a
 * diferença entre a resposta automática e esta, que é justamente o ponto.
 *
 * Diferente do envio automático (`speakReply` no webhook), aqui NÃO existe
 * degradação silenciosa para texto: quem clicou em "enviar como áudio" pediu
 * áudio, e mandar texto no lugar sem avisar seria trocar a decisão da pessoa.
 * Falhou, a mensagem não sai e a tela explica por quê — o texto continua no
 * campo, e mandar como texto é um clique.
 */
export async function sendManualAudioMessage(
  conversationId: string,
  text: string,
): Promise<Result> {
  const { tenantId } = await requireTenant();

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Escreva algo antes de enviar." };
  if (trimmed.length > MAX_TTS_CHARS) {
    return {
      ok: false,
      error: `Texto longo demais para áudio (máximo ${MAX_TTS_CHARS} caracteres). Encurte ou envie como texto.`,
    };
  }

  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
  }

  // A voz é a do agente que atende esta conversa; sem agente definido, a do
  // principal da conta (mesma regra do webhook).
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { agentId: true, isTest: true },
  });
  if (!conversation) return { ok: false, error: "Conversa não encontrada." };

  // Funciona no chat de teste TAMBÉM, de propósito: é onde se experimenta como
  // a voz soa antes de mandar para um cliente de verdade. A síntese é paga
  // mesmo no teste (a Fish cobra por caractere, não por destinatário), mas
  // conferir a própria voz antes de usá-la com cliente é justamente o uso que
  // paga esse custo. No sandbox a mensagem fica só no histórico — nada sai
  // para o WhatsApp, como qualquer outra mensagem de teste.

  const agent = await resolveAgent(tenantId, conversation.agentId ?? undefined);
  if (!agent?.voiceId) {
    return {
      ok: false,
      error: "Este agente ainda não tem voz gravada. Grave em Agentes › Comportamento.",
    };
  }

  // O que vai ser falado passa por `toSpeech()` — risada escrita, emoji,
  // formatação e a lista do agente não viram som (ver
  // modules/voice/speech-text.ts). Se não sobrar nada, a síntese devolveria
  // `null` e a tela diria "não foi possível gerar o áudio", mandando a pessoa
  // investigar uma falha que não existe.
  const blocklist = agent.speechBlocklist ?? "";
  if (!toSpeech(trimmed, blocklist)) {
    return {
      ok: false,
      error: "Não sobrou nada para falar nesse texto. Escreva a mensagem em palavras.",
    };
  }

  const audio = await synthesize({
    text: trimmed,
    referenceId: agent.voiceId,
    blocklist,
    style: agent.voiceStyle,
  });
  if (!audio) {
    return { ok: false, error: "Não foi possível gerar o áudio agora. Tente de novo ou envie como texto." };
  }

  const res = await sendManualReply(tenantId, conversationId, trimmed, {
    buffer: audio.audio,
    mime: audio.mime,
  });
  if (!res.ok) return res;

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Manda um áudio GRAVADO POR VOCÊ — sua voz real, não a sintetizada.
 *
 * O áudio é transcrito antes de sair (`transcribeAudio`, o mesmo usado no
 * webhook para ouvir o cliente) e o texto vai para o histórico junto. Sem isso
 * a conversa ficaria cega: o resumo, os relatórios e o próximo turno da IA não
 * saberiam o que você falou — só que "houve um áudio".
 *
 * A transcrição NÃO bloqueia o envio: se falhar, a mensagem sai mesmo assim com
 * um marcador no lugar do texto. O áudio é o conteúdo real aqui; a transcrição
 * é conveniência.
 */
export async function sendRecordedAudioMessage(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData, MAX_VOICE_MESSAGE_BYTES);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const conversationId = String(formData.get("conversationId") ?? "");

  const file = formData.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Grave um áudio antes de enviar." };
  }
  if (file.size > MAX_VOICE_MESSAGE_BYTES) {
    return { ok: false, error: "O áudio é longo demais. Grave até 2 minutos." };
  }

  const mime = (file.type || "audio/webm").split(";")[0].trim();
  if (!mime.startsWith("audio/")) {
    return { ok: false, error: "Formato de áudio não suportado." };
  }

  // Sem bloqueio de sandbox aqui, ao contrário do texto→voz: gravar a própria
  // voz não custa síntese paga, e `sendManualReply` já sabe que numa conversa
  // de teste a mensagem só é gravada (nada sai para o WhatsApp). O áudio fica
  // no histórico do teste como ficaria numa conversa real.
  const buffer = Buffer.from(await file.arrayBuffer());

  // Transcreve antes de enviar para o texto entrar junto na mesma mensagem —
  // gravar duas linhas no histórico separaria o áudio do que ele diz.
  let text: string | null = null;
  try {
    text = await transcribeAudio(buffer.toString("base64"), mime);
  } catch (err) {
    console.error("[conversas] falha ao transcrever áudio gravado", err);
  }

  const res = await sendManualReply(tenantId, conversationId, text ?? "🎙️ Áudio enviado", {
    buffer,
    mime,
  });
  if (!res.ok) return res;

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Pausa/retoma o agente NESTA conversa (por conversa, não pelo agente inteiro).
 *
 * Ao retomar, mantém o agente atribuído se estiver ativo. Conversas de agente
 * removido, arquivado ou desligado passam para o agente ativo padrão. Também
 * limpa a pausa e o sinal de atendimento humano.
 */
export async function setConversationAgentPaused(id: string, paused: boolean): Promise<Result> {
  const { tenantId } = await requireTenant();

  if (!paused) {
    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { agent: { select: { id: true, enabled: true, archived: true } } },
    });
    if (!conversation) return { ok: false, error: "Conversa não encontrada." };

    const assigned = conversation.agent;
    const agentId = assigned?.enabled && !assigned.archived
      ? assigned.id
      : (await prisma.agent.findFirst({
          where: { tenantId, enabled: true, archived: false },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: { id: true },
        }))?.id;
    if (!agentId) {
      return { ok: false, error: "Ative um agente em Agentes antes de devolver esta conversa." };
    }

    const res = await prisma.conversation.updateMany({
      where: { id, tenantId },
      data: { agentId, agentPaused: false, needsHuman: false },
    });
    if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

    const recovery = await recoverPendingAgentReply(tenantId, id, agentId);
    if (recovery.status === "failed") {
      await prisma.conversation.updateMany({
        where: { id, tenantId },
        data: { needsHuman: true },
      });
    }

    revalidatePath("/conversas");
    revalidatePath("/inicio");
    if (recovery.status === "failed") return { ok: false, error: recovery.error };
    if (recovery.status === "sent") return { ok: true, info: "Agente reativado e resposta enviada à mensagem pendente." };
    if (recovery.status === "in_progress") return { ok: true, info: "A resposta do agente já está em andamento." };
    return { ok: true, info: "Agente reativado nesta conversa para atender a próxima mensagem." };
  }

  const res = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { agentPaused: true },
  });

  if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Excluir um chat de teste (sandbox) em definitivo: a conversa, as mensagens e
 * o lead de teste vão junto (cascade). Só conversas `isTest: true` da própria
 * conta passam por aqui — um id de conversa real retorna erro, nunca apaga.
 */
export async function deleteTestConversation(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();

  const conv = await prisma.conversation.findFirst({
    where: { id, tenantId, isTest: true, lead: { isTest: true } },
    select: { id: true, leadId: true },
  });
  if (!conv) return { ok: false, error: "Conversa de teste não encontrada." };

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: conv.id } }),
    prisma.conversation.delete({ where: { id: conv.id } }),
    prisma.lead.delete({ where: { id: conv.leadId } }),
  ]);

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Gera o resumo da conversa sob demanda (botão "Resumir" no painel do cliente).
 *
 * Sob demanda por escolha: resumir a cada turno dobraria o gasto de tokens de
 * toda mensagem recebida. O resultado fica em cache
 * (`Conversation.summary/summaryAt/summaryMsgCount`), então reabrir a conversa
 * mostra o resumo pronto — e a interface sabe dizer quantas mensagens novas
 * chegaram desde então sem gastar outra chamada. Ver `agent-engine/summary.ts`.
 */
export async function generateConversationSummary(
  conversationId: string,
): Promise<Result & { summary?: string }> {
  const { tenantId } = await requireTenant();
  const res = await summarizeConversation(tenantId, conversationId);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/conversas");
  revalidatePath("/contatos");
  return { ok: true, summary: res.summary };
}

/**
 * Enviar como se fosse o CLIENTE, numa conversa de teste — o outro lado do
 * `sendManualMessage`, que sempre fala como "você".
 *
 * Testar o agente de dentro de uma conversa aberta era meio caminho: a caixa
 * de resposta só sabia escrever como o dono da conta (e ainda pausava a IA),
 * então para ver o agente responder era preciso sair para o diálogo "Testar
 * agente" — que sempre começa do zero, sem o histórico da conversa aberta.
 * Aqui a mensagem entra como `role: "user"` e o motor roda de verdade.
 *
 * Restrito a `isTest: true`. Numa conversa real, isso forjaria uma mensagem
 * que o cliente nunca mandou — dado falso no histórico e nos relatórios.
 */
export async function sendTestClientMessage(
  conversationId: string,
  text: string,
): Promise<Result & { reply?: string; status?: string }> {
  const { tenantId } = await requireTenant();

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Escreva algo antes de enviar." };

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId, isTest: true },
    select: { id: true, leadId: true, agentId: true },
  });
  if (!conversation) {
    return { ok: false, error: "Só dá para escrever como cliente em uma conversa de teste." };
  }

  const { reply, status } = await runAgentTurn({
    tenantId,
    conversationId: conversation.id,
    leadId: conversation.leadId,
    userMessage: trimmed,
    agentId: conversation.agentId ?? undefined,
    // Mesmo motivo do `/api/sandbox`: teste não é atendimento, então segue
    // funcionando com a cota do mês esgotada e com o agente desligado — a
    // chave geral cala o agente para o cliente, não para quem está ajustando.
    skipUsageCheck: true,
    skipEnabledCheck: true,
    // Teste não pode ocupar a agenda real nem espelhar no Clinicorp/Google/iCloud.
    dryRunScheduling: true,
  });

  revalidatePath("/conversas");
  return { ok: true, reply, status };
}
