"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createHash } from "node:crypto";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { planOf } from "@/modules/billing/plans";
import { applyPersonaAnswers, personaSchema, rulesSchema } from "@/modules/agent-engine/persona-apply";
import { ACTION_BY_KEY, type ActionKey } from "@/modules/agent-engine/actions";
import { createAgent, getAgentOwned, getAgentUsage } from "@/modules/agent-engine/agents";
import { validateQrRiskConsent, createQrRiskAcceptance } from "@/modules/scheduling/qr-risk-terms";
import { saveScheduleConfig } from "@/modules/scheduling/repository";
import { parseWeeklyAvailability, validateWeeklyAvailability, type WeeklyAvailability } from "@/modules/scheduling/weekly-availability";
import {
  MAX_DURATIONS,
  MAX_DURATION_MINUTES,
  MAX_REMINDER_MINUTES,
  MIN_DURATION_MINUTES,
  formatReminderLead,
  isScheduleTime,
  isCalendarDate,
  MAX_BLOCKED_DATES,
  isScheduleTimezone,
  normalizeDurationLabel,
  parseScheduleConfig,
  validateDurations,
  validateReminders,
  validateScheduleBreaks,
} from "@/modules/scheduling/config";
import { listClinicorpCategories } from "@/modules/scheduling/clinicorp";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import {
  parseMetaReminderTemplate,
  validateMetaReminderTemplate,
  type MetaReminderTemplate,
} from "@/modules/scheduling/meta-reminder";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import { isEvolutionEnabled } from "@/modules/whatsapp/instances";
import { sameBroadcastTemplate, type BroadcastTemplate } from "@/modules/broadcasts/template";
import {
  MAX_FOLLOWUP_DELAY_MINUTES,
  MAX_FOLLOWUP_MESSAGE_LENGTH,
  MAX_FOLLOWUP_STEPS,
  saveFollowUpConfig,
  validateFollowUpConfig,
} from "@/modules/follow-up/config";
import {
  MAX_GROUP_NAME,
  MAX_GROUP_REASON,
  listWhatsAppGroups,
  normalizeGroupId,
  saveHandoffConfig,
  type GroupListResult,
  type HandoffConfig,
} from "@/modules/agent-engine/handoff";
import { validateVariableDefinitions, type VariableDefinition } from "@/modules/agent-engine/variables";
import {
  ingestDocument,
  deleteDocument,
  getDocument,
  updateDocument,
  publishDocumentDraft,
} from "@/modules/knowledge-base/repository";
import { extractTextFromFile } from "@/modules/knowledge-base/extract";
import { uploadToBunny } from "@/lib/bunny";
import {
  VOICE_SAMPLE_MAX_BYTES,
  VOICE_SAMPLE_MIN_BYTES,
  cloneVoice,
  deleteVoice,
  isFishAudioConfigured,
  synthesize,
} from "@/modules/voice/fish";
import { SAMPLE_TEXT, findCatalogVoice } from "@/modules/voice/catalog";
import { parseSpeechBlocklist } from "@/modules/voice/speech-text";
import { VOICE_STYLES } from "@/modules/voice/style";
import { recordAudit, recordChange, recordDeletion } from "@/modules/audit/log";
import {
  MAX_AGENT_PACKAGE_BYTES,
  parseAgentPackage,
} from "@/modules/agent-engine/agent-package";
import {
  buildAgentPackage,
  createAgentFromPackage,
} from "@/modules/agent-engine/transfer";

export type Result = { ok: boolean; error?: string; info?: string };
export type AgentCopyResult = Result & { agentId?: string; warnings?: string[] };

export async function saveAgentVariables(agentId: string, definitions: VariableDefinition[]): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado." };
  const parsed = z.array(z.object({ key: z.string(), description: z.string() })).safeParse(definitions);
  if (!parsed.success) return { ok: false, error: "Variáveis inválidas." };
  const error = validateVariableDefinitions(parsed.data);
  if (error) return { ok: false, error };
  const normalized = parsed.data.map(({ key, description }) => ({ key: key.trim().toLowerCase(), description: description.trim() }));
  await prisma.agent.updateMany({ where: { id: agentId, tenantId }, data: { variableDefinitions: normalized } });
  revalidatePath(`/agentes/${agentId}`);
  return { ok: true, info: "Variáveis salvas." };
}

/**
 * Todas as actions recebem `agentId` e passam por `requireAgent`: o id vem da
 * URL, então sem a checagem de dono trocar o id na barra de endereço daria
 * acesso ao agente de outra conta.
 */
async function requireAgent(agentId: string) {
  const { tenantId } = await requireTenant();
  const agent = await getAgentOwned(tenantId, agentId);
  if (!agent) return { tenantId, agent: null as null };
  return { tenantId, agent };
}

function revalidateAgent(agentId: string) {
  revalidatePath("/agentes");
  revalidatePath(`/agentes/${agentId}`);
  revalidatePath("/onboarding");
  revalidatePath("/inicio");
}

// ---------------------------------------------------------------- agentes

const nameSchema = z.string().trim().min(1, "Dê um nome ao agente").max(60, "Nome muito longo");

/** Cria um agente e leva direto ao passo a passo dele. */
export async function createAgentAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  // Limite revalidado no servidor: a UI já esconde o botão, mas ela não é a
  // única linha de defesa (mesma regra do teto de ações).
  const usage = await getAgentUsage(tenantId);
  if (!usage.canCreate) {
    return {
      ok: false,
      error: `Seu plano permite ${usage.limit} agente(s). Exclua um ou mude de plano.`,
    };
  }

  const agent = await createAgent(tenantId, parsed.data);

  await recordAudit({
    event: "agent.created",
    target: { type: "Agent", id: agent.id, label: agent.name },
    after: { name: agent.name },
  });

  revalidatePath("/agentes");
  redirect(`/agentes/${agent.id}`);
}

/** Duplica toda a configuração do agente dentro da própria empresa. */
export async function duplicateAgent(agentId: string): Promise<AgentCopyResult> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const portable = await buildAgentPackage(agent.id, tenantId);
  if (!portable) return { ok: false, error: "Agente não encontrado" };

  const result = await createAgentFromPackage({
    tenantId,
    package: portable,
    name: `${agent.name} (cópia)`,
  });
  if (!result.ok) return result;

  await recordAudit({
    event: "agent.created",
    target: { type: "Agent", id: result.agentId, label: result.name },
    after: { name: result.name, copiedFrom: agent.id },
    meta: { operation: "duplicate", warnings: result.warnings },
  });

  revalidatePath("/agentes");
  return {
    ok: true,
    agentId: result.agentId,
    warnings: result.warnings,
    info: result.warnings.length
      ? `Agente duplicado. ${result.warnings.join(" ")}`
      : "Agente duplicado com toda a configuração.",
  };
}

/** Importa um pacote baixado anteriormente e abre a cópia para revisão. */
export async function importAgentAction(
  _prev: AgentCopyResult | null,
  formData: FormData,
): Promise<AgentCopyResult> {
  const { tenantId } = await requireTenant();
  const tooLarge = payloadTooLarge(formData, MAX_AGENT_PACKAGE_BYTES);
  if (tooLarge) return { ok: false, error: "O arquivo do agente pode ter no máximo 45MB." };

  const file = formData.get("agentPackage");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Selecione um arquivo de agente para importar." };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: "O arquivo selecionado não contém um JSON válido." };
  }
  const parsed = parseAgentPackage(raw);
  if (!parsed.ok) return parsed;

  const result = await createAgentFromPackage({ tenantId, package: parsed.data });
  if (!result.ok) return result;

  await recordAudit({
    event: "agent.created",
    target: { type: "Agent", id: result.agentId, label: result.name },
    after: { name: result.name, imported: true },
    meta: {
      operation: "import",
      sourceTenant: parsed.data.source?.tenantName,
      warnings: result.warnings,
    },
  });

  revalidatePath("/agentes");
  redirect(`/agentes/${result.agentId}`);
}

export async function renameAgent(agentId: string, name: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  await prisma.agent.update({ where: { id: agent.id }, data: { name: parsed.data } });

  await recordChange({
    event: "agent.updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { name: agent.name },
    after: { name: parsed.data },
  });

  revalidateAgent(agent.id);
  return { ok: true, info: "Nome atualizado." };
}

/**
 * Marca quem atende o número de WhatsApp da conta. Enquanto o número for um só
 * (ver CHANGELOG), promover um agente rebaixa o anterior — nunca dois
 * principais, nunca nenhum.
 */
export async function setPrimaryAgent(agentId: string): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  await prisma.$transaction([
    prisma.agent.updateMany({ where: { tenantId }, data: { isPrimary: false } }),
    prisma.agent.update({ where: { id: agent.id }, data: { isPrimary: true } }),
  ]);

  await recordChange({
    event: "agent.updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { isPrimary: agent.isPrimary },
    after: { isPrimary: true },
  });

  revalidateAgent(agent.id);
  return { ok: true, info: `${agent.name} agora atende o WhatsApp.` };
}

/**
 * Liga/desliga o agente. Desligado ele para de responder aos CLIENTES (WhatsApp
 * e widget do site) sem perder nada do que foi configurado — a alternativa que
 * existia era excluir o agente ou desconectar o WhatsApp da conta inteira.
 *
 * O chat de teste é a exceção e segue respondendo (`skipEnabledCheck` em
 * `runAgentTurn`): desligar é justamente o que se faz para mexer no agente, e
 * um sandbox mudo obrigava a religar — voltando a atender cliente de verdade —
 * só para conferir a mudança.
 */
export async function setAgentEnabled(agentId: string, enabled: boolean): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  await prisma.agent.update({ where: { id: agent.id }, data: { enabled } });

  await recordChange({
    event: "agent.updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { enabled: agent.enabled },
    after: { enabled },
  });

  revalidateAgent(agent.id);
  revalidatePath("/conversas");
  return {
    ok: true,
    info: enabled
      ? `${agent.name} voltou a responder.`
      : `${agent.name} parou de responder aos clientes. No chat de teste ele continua respondendo.`,
  };
}

/**
 * Liga/desliga um comportamento de conversa do agente (passo Comportamento):
 * `listenAudio` (ouvir mensagens de voz), `stopOnEmoji` (pausar quando um
 * atendente reage pelo número da empresa) e `speakReplies` (responder em áudio). São colunas
 * do Agent, não ações com limite de plano — por isso não passam por
 * `setActionEnabled`.
 */
const BEHAVIOR_FIELDS = ["listenAudio", "stopOnEmoji", "speakReplies"] as const;
type BehaviorField = (typeof BEHAVIOR_FIELDS)[number];

export async function setAgentBehavior(
  agentId: string,
  field: BehaviorField,
  enabled: boolean,
): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  if (!BEHAVIOR_FIELDS.includes(field)) {
    return { ok: false, error: "Comportamento inválido" };
  }

  // Ligar "responder com áudio" sem voz gravada não quebra nada (a resposta sai
  // em texto), mas o toggle ligado prometeria algo que não acontece. Recusar
  // aqui é o que faz a tela contar a verdade.
  if (field === "speakReplies" && enabled) {
    if (!isFishAudioConfigured()) {
      return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
    }
    const voice = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { voiceId: true },
    });
    if (!voice?.voiceId) {
      return { ok: false, error: "Grave a voz do agente antes de ligar a resposta em áudio." };
    }
  }

  await prisma.agent.update({ where: { id: agent.id }, data: { [field]: enabled } });

  await recordChange({
    event: "agent.behavior_updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { [field]: agent[field] },
    after: { [field]: enabled },
  });

  revalidateAgent(agent.id);
  return { ok: true, info: "Comportamento atualizado." };
}

/**
 * Como a voz do agente se comporta (`Agent.voiceStyle`).
 *
 * A chave é validada contra o catálogo (`modules/voice/style.ts`) em vez de
 * aceita como texto: a action é chamável direto por POST, e uma chave
 * desconhecida no banco só apareceria como "voz neutra" na leitura — o dono
 * escolheria "animada", a tela mostraria neutra e ninguém saberia por quê.
 */
export async function setAgentVoiceStyle(agentId: string, style: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  if (!VOICE_STYLES.some((s) => s.key === style)) {
    return { ok: false, error: "Estilo de voz inválido" };
  }

  await prisma.agent.update({ where: { id: agent.id }, data: { voiceStyle: style } });

  await recordChange({
    event: "agent.voice_style_updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { voiceStyle: agent.voiceStyle },
    after: { voiceStyle: style },
  });

  revalidateAgent(agent.id);
  return { ok: true, info: "Jeito de falar salvo." };
}

export async function saveVoicePrompt(agentId: string, raw: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado." };
  const parsed = z.string().trim().max(1200, "Use até 1.200 caracteres.").safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Instrução inválida." };

  await prisma.agent.update({ where: { id: agent.id }, data: { voicePrompt: parsed.data } });
  await recordChange({
    event: "agent.voice_prompt_updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { voicePrompt: agent.voicePrompt },
    after: { voicePrompt: parsed.data },
  });
  revalidateAgent(agent.id);
  return { ok: true, info: "Instruções de fala salvas." };
}

/**
 * Termos que o agente não pronuncia, um por linha (ver
 * `modules/voice/speech-text.ts`).
 *
 * Action própria, como `saveRules`: o campo vive no passo Comportamento, longe
 * do formulário da persona, e reaproveitar `personaSchema` apagaria o resto da
 * persona no `.default("")`.
 *
 * O teto não é o da lista (isso é `parseSpeechBlocklist`, que ignora o excesso
 * em silêncio na LEITURA — linha antiga, editada à mão ou colada de planilha
 * não pode derrubar o áudio). Aqui, na escrita, o excesso é recusado com
 * explicação: tem alguém na tela para corrigir.
 */
const speechBlocklistSchema = z.object({
  terms: z
    .string()
    .trim()
    .max(2000, "Lista longa demais — use termos curtos, não frases")
    .default(""),
});

export async function saveSpeechBlocklist(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = speechBlocklistSchema.safeParse({ terms: formData.get("terms") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Normaliza na gravação para o banco guardar o mesmo formato que a leitura
  // espera (um termo por linha, sem vazias) — a tela manda o que a pessoa
  // digitou, e ela pode ter colado uma lista com linha em branco no meio.
  const terms = parseSpeechBlocklist(parsed.data.terms);
  const speechBlocklist = terms.join("\n");

  await prisma.agent.update({ where: { id: agent.id }, data: { speechBlocklist } });

  await recordChange({
    event: "agent.speech_blocklist_updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { speechBlocklist: agent.speechBlocklist },
    after: { speechBlocklist },
  });

  revalidateAgent(agent.id);
  return {
    ok: true,
    info: terms.length === 0 ? "Lista vazia — o agente volta a falar tudo." : "Lista salva.",
  };
}

// ------------------------------------------------------------------ voz

/**
 * Formatos que os navegadores produzem ao gravar (`MediaRecorder` entrega webm
 * no Chrome/Firefox e mp4 no Safari) mais os que a pessoa pode enviar de um
 * arquivo. A lista existe para não mandar um PDF renomeado para a Fish Audio.
 */
const VOICE_MIMES = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
];

/**
 * Clona a voz do dono da conta na Fish Audio e guarda o id no agente.
 *
 * A amostra NÃO é armazenada por nós: ela vai para a Fish Audio, vira um modelo
 * e o buffer morre com a request. Guardar a gravação significaria assumir a
 * custódia da voz de uma pessoa (dado biométrico) para nunca mais usá-la — o
 * modelo é a única coisa que o produto precisa de volta.
 *
 * Regravar SUBSTITUI: o modelo anterior é apagado lá antes de gravarmos o novo
 * id, senão cada regravação deixaria um modelo órfão na conta da plataforma,
 * cobrando e guardando a voz de um cliente para sempre.
 */
export async function saveAgentVoice(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
  }

  const file = formData.get("sample");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Grave ou envie uma amostra da sua voz." };
  }
  if (file.size > VOICE_SAMPLE_MAX_BYTES) {
    return { ok: false, error: "A gravação é grande demais. Grave algo em torno de 30 segundos." };
  }
  if (file.size < VOICE_SAMPLE_MIN_BYTES) {
    return { ok: false, error: "A gravação ficou curta demais. Fale por uns 20 a 30 segundos." };
  }

  const mime = (file.type || "audio/webm").split(";")[0].trim();
  if (!VOICE_MIMES.includes(mime)) {
    return { ok: false, error: "Formato de áudio não suportado. Grave pelo painel ou envie um MP3." };
  }

  const label = String(formData.get("label") ?? "").trim().slice(0, 60) || "Minha voz";

  const cloned = await cloneVoice({
    audio: Buffer.from(await file.arrayBuffer()),
    mime,
    // Identifica o dono do modelo dentro da conta da plataforma na Fish Audio,
    // onde convivem as vozes de todos os tenants.
    title: `fechai · ${agent.id} · ${label}`,
  });
  if (!cloned.ok) return { ok: false, error: cloned.error };

  const previous = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { voiceId: true, voiceSource: true },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      voiceId: cloned.referenceId,
      voiceLabel: label,
      voiceSource: "recorded",
      voiceCreatedAt: new Date(),
    },
  });

  // Só depois de a nova voz estar salva: se apagássemos antes e o update
  // falhasse, a conta ficaria sem voz nenhuma. E só se a anterior era nossa —
  // voz do catálogo é compartilhada (ver deleteAgentVoice).
  if (previous?.voiceId && previous.voiceSource !== "catalog") {
    await deleteVoice(previous.voiceId);
  }

  revalidateAgent(agent.id);
  return { ok: true, info: "Voz gravada. Ligue “Responder com áudio” para o agente usá-la." };
}

/**
 * Gera a amostra de uma voz pronta para a pessoa ouvir ANTES de escolher.
 *
 * Devolve data URL em vez de guardar arquivo: a amostra é descartável, vive só
 * enquanto a tela está aberta, e subir isso para a CDN encheria o storage de
 * áudio que ninguém vai reouvir.
 *
 * Custa uma síntese (~R$0,007) por clique no play — por isso a tela pede o
 * áudio só quando a pessoa clica, e não ao abrir a lista.
 */
export async function previewCatalogVoice(
  voiceKey: string,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  // Só exige sessão de tenant: a amostra não toca em nenhum agente.
  await requireTenant();

  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
  }

  const voice = findCatalogVoice(voiceKey);
  if (!voice) return { ok: false, error: "Voz não encontrada." };

  const audio = await synthesize({ text: SAMPLE_TEXT, referenceId: voice.referenceId });
  if (!audio) return { ok: false, error: "Não foi possível gerar a amostra agora." };

  return {
    ok: true,
    dataUrl: `data:${audio.mime};base64,${audio.audio.toString("base64")}`,
  };
}

/**
 * Escolhe uma das vozes prontas (ver `modules/voice/catalog.ts`).
 *
 * Substitui a voz atual, qualquer que fosse. Se a anterior era GRAVADA, o
 * modelo dela é apagado na Fish Audio: trocar por uma voz pronta é abandonar a
 * gravação, e deixá-la lá guardaria a voz de um cliente sem ninguém usando.
 */
export async function setAgentCatalogVoice(agentId: string, voiceKey: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
  }

  // A tela manda a CHAVE, não o `reference_id`: assim um id arbitrário nunca
  // entra no banco pela action, só os que nós curamos.
  const voice = findCatalogVoice(voiceKey);
  if (!voice) return { ok: false, error: "Voz não encontrada." };

  const previous = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { voiceId: true, voiceSource: true },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      voiceId: voice.referenceId,
      voiceLabel: voice.name,
      voiceSource: "catalog",
      voiceCreatedAt: new Date(),
    },
  });

  // Só a voz GRAVADA é nossa para apagar (ver `voiceSource` no schema).
  if (previous?.voiceSource === "recorded" && previous.voiceId) {
    await deleteVoice(previous.voiceId);
  }

  revalidateAgent(agent.id);
  return { ok: true, info: `Voz ${voice.name} selecionada.` };
}

/**
 * Apaga a voz do agente. Desliga a resposta em áudio junto: sem voz ela não
 * aconteceria de todo jeito, e um toggle ligado que não faz nada é pior que um
 * desligado.
 *
 * O modelo na Fish Audio só é apagado quando a voz era GRAVADA. Voz do catálogo
 * é compartilhada entre todas as contas — apagá-la derrubaria a voz de quem
 * mais tivesse escolhido a mesma.
 */
export async function deleteAgentVoice(agentId: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const current = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { voiceId: true, voiceSource: true },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      voiceId: null,
      voiceLabel: null,
      voiceSource: null,
      voiceCreatedAt: null,
      speakReplies: false,
    },
  });
  // `voiceSource` null = conta anterior a este campo, quando só existia voz
  // gravada — apagar continua certo nesse caso.
  if (current?.voiceId && current.voiceSource !== "catalog") {
    await deleteVoice(current.voiceId);
  }

  revalidateAgent(agent.id);
  return { ok: true, info: "Voz removida. O agente volta a responder só em texto." };
}

/** Exclui o agente depois de transferir suas conversas para outro agente ativo. */
export async function deleteAgent(agentId: string): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const total = await prisma.agent.count({ where: { tenantId, archived: false } });
  if (total <= 1) {
    return { ok: false, error: "Sua conta precisa de pelo menos um agente." };
  }

  const replacement = await prisma.agent.findFirst({
    where: { tenantId, id: { not: agent.id }, archived: false, enabled: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!replacement) {
    return { ok: false, error: "Ative outro agente antes de excluir este. As conversas precisam de alguém para atendê-las." };
  }

  // Snapshot ANTES do delete: depois não há mais o que ler, e é este JSON que
  // o admin usa para restaurar o agente com o mesmo id em /admin/logs. O que
  // não volta junto são os filhos apagados em cascade (documentos, ações) —
  // a tela do log avisa isso antes de confirmar.
  await recordDeletion({
    event: "agent.deleted",
    target: { type: "Agent", id: agent.id, label: agent.name },
    snapshot: {
      id: agent.id,
      tenantId,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      objective: agent.objective,
      personaDraft: agent.personaDraft,
      enabled: agent.enabled,
      listenAudio: agent.listenAudio,
      stopOnEmoji: agent.stopOnEmoji,
      speakReplies: agent.speakReplies,
      isPrimary: agent.isPrimary,
      archived: agent.archived,
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.conversation.updateMany({
      where: { tenantId, agentId: agent.id },
      data: { agentId: replacement.id },
    });
    if (agent.isPrimary) {
      await tx.agent.update({ where: { id: replacement.id }, data: { isPrimary: true } });
    }
    await tx.agent.delete({ where: { id: agent.id } });
  });

  revalidatePath("/agentes");
  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true, info: "Agente excluído." };
}

// ---------------------------------------------------------------- persona

// Os schemas e a gravação moram em `persona-apply.ts`, compartilhados com a
// aprovação de propostas do MCP: o comportamento é um só.

export async function savePersona(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = personaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // `avoid` não faz mais parte deste formulário (virou o passo Regras, com
  // sua própria action) — tira da resposta em vez de confiar no `.default("")`
  // do schema, que apagaria as regras a cada save de persona. `applyPersonaAnswers`
  // mantém o `avoid` que já estava salvo.
  const { avoid: _formAvoid, ...answers } = parsed.data;
  void _formAvoid;

  const applied = await applyPersonaAnswers(tenantId, agent.id, answers, null);
  if (!applied.ok) return { ok: false, error: "Agente não encontrado" };

  revalidateAgent(agent.id);
  return { ok: true, info: "Persona salva." };
}

/**
 * Regras (`avoid`) têm a própria action porque o formulário de Regras não
 * carrega os outros campos de persona no DOM — reaproveitar `personaSchema`
 * faria o resto da persona cair no `.default("")` e ser apagado.
 */
export async function saveRules(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = rulesSchema.safeParse({ rules: formData.get("rules") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const applied = await applyPersonaAnswers(tenantId, agent.id, { avoid: parsed.data.rules }, null);
  if (!applied.ok) return { ok: false, error: "Agente não encontrado" };

  revalidateAgent(agent.id);
  return { ok: true, info: "Regras salvas." };
}

// ----------------------------------------------------------------- ações

export async function setActionEnabled(
  agentId: string,
  key: ActionKey,
  enabled: boolean,
): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };
  const def = ACTION_BY_KEY[key];
  if (!def) return { ok: false, error: "Ação inválida" };
  if (def.status === "disabled") {
    return { ok: false, error: "Esta ação está desativada por enquanto." };
  }

  if (enabled) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const limit = planOf(tenant?.planKey).maxActiveActions;
    // Teto por agente: cada agente tem seu próprio orçamento de ações.
    const active = await prisma.tenantAction.count({ where: { agentId: agent.id, enabled: true } });
    if (active >= limit) {
      return { ok: false, error: `Seu plano permite ${limit} ações por agente. Desative uma antes.` };
    }
  }

  const previous = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId: agent.id, key } },
    select: { id: true, enabled: true },
  });

  const saved = await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId: agent.id, key } },
    create: { tenantId, agentId: agent.id, key, enabled },
    update: { enabled },
  });

  await recordChange({
    event: "agent.action_toggled",
    // O alvo é a linha de TenantAction, não o agente: é ela que um undo
    // regrava. `targetLabel` fica com o nome legível da ação para o log não
    // virar "TenantAction ckx…" na tela.
    target: { type: "TenantAction", id: saved.id, label: `${def.label} · ${agent.name}` },
    before: { enabled: previous?.enabled ?? false },
    after: { enabled },
    meta: { acao: key, agente: agent.name },
  });

  revalidateAgent(agent.id);
  return { ok: true };
}

// ------------------------------------------------- configuração da agenda

const scheduleConfigSchema = z.object({
  durationMinutes: z.coerce.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES),
  timezone: z.string().trim().refine(isScheduleTimezone, "Fuso horário inválido"),
  startTime: z.string().refine(isScheduleTime, "Horário inválido"),
  endTime: z.string().refine(isScheduleTime, "Horário inválido"),
  location: z.string().trim().max(200).default(""),
  minNoticeHours: z.coerce.number().int().min(0).max(168),
  allowCancellation: z.enum(["true", "false"]).transform((v) => v === "true"),
  allowRescheduling: z.enum(["true", "false"]).transform((v) => v === "true"),
  recognizeExisting: z.enum(["true", "false"]).transform((v) => v === "true"),
  breaks: z.array(z.object({
    label: z.string().trim().max(60),
    startTime: z.string().refine(isScheduleTime, "Início da pausa inválido"),
    endTime: z.string().refine(isScheduleTime, "Fim da pausa inválido"),
  })).max(12, "Cadastre no máximo 12 pausas."),
  durations: z.array(z.object({
    label: z.string().trim().min(1, "Toda variação precisa de um nome.").max(60),
    // `null`/`""` chega de um campo em branco — inclusive dos tipos trazidos do
    // Clinicorp, que vêm sem duração. Recusado com o nome do tipo na mensagem
    // (no `superRefine` abaixo), porque `z.coerce.number()` transformaria o
    // vazio em 0 e a pessoa leria só "a duração vai de 5 a 480".
    minutes: z.number().int()
      .min(MIN_DURATION_MINUTES, `A duração de cada variação vai de ${MIN_DURATION_MINUTES} a ${MAX_DURATION_MINUTES} minutos.`)
      .max(MAX_DURATION_MINUTES, `A duração de cada variação vai de ${MIN_DURATION_MINUTES} a ${MAX_DURATION_MINUTES} minutos.`)
      .nullable(),
  })).max(MAX_DURATIONS, `Cadastre no máximo ${MAX_DURATIONS} variações de duração.`),
  reminderEnabled: z.enum(["true", "false"]).transform((v) => v === "true"),
  reminderAudience: z.enum(["all", "selected_types"]),
  reminderTypes: z.array(z.string().trim().min(1).max(60, "O nome do tipo deve ter até 60 caracteres.")),
  // Sem `.max()` de quantidade: quantos lembretes o paciente aguenta é decisão
  // de quem conhece a própria base. A tela avisa a partir de
  // `REMINDER_COUNT_WARNING` (e interrompe com um popup ao passar disso), mas
  // não impede — ver `ReminderList`.
  reminders: z.array(z.object({
    minutesBefore: z.coerce.number().int()
      .min(1, "A antecedência mínima de um lembrete é 1 minuto.")
      .max(MAX_REMINDER_MINUTES, `A antecedência máxima de um lembrete é ${formatReminderLead(MAX_REMINDER_MINUTES)}.`),
    template: z.string().trim().max(500),
    sendTime: z.string().optional(),
  })),
  // Datas bloqueadas (feriado, recesso). Data inválida é recusada em vez de
  // descartada em silêncio: a pessoa digitou aquele dia esperando fechar, e
  // sumir com a linha faria o agente atender num dia que ela achou bloqueado.
  blockedDates: z.array(z.object({
    date: z.string().refine(isCalendarDate, "Data inválida."),
    label: z.string().trim().max(60),
  })).max(MAX_BLOCKED_DATES, `São no máximo ${MAX_BLOCKED_DATES} datas bloqueadas.`),
}).superRefine((data, ctx) => {
  // Variação sem duração: acontece sempre que os tipos vêm do Clinicorp, que
  // não informa quanto tempo cada um leva. A mensagem nomeia o tipo porque
  // podem ser oito linhas na tela e "preencha a duração" não diria qual.
  const blank = data.durations.find((d) => d.minutes === null);
  if (blank) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durations"],
      message: `Preencha a duração de "${blank.label.trim()}" em minutos.`,
    });
  }

  // Lembrete ligado sem texto mandaria mensagem em branco para o paciente, e
  // dois no mesmo instante chegariam como duas mensagens coladas. As duas
  // checagens vêm no `superRefine` (e não num `transform` que desligaria o
  // lembrete sozinho) pelo mesmo motivo de `notifyGroup` sem `groupId`: a tela
  // diria "salvo" com a opção silenciosamente desligada.
  if (!data.reminderEnabled) return;
  if (data.reminderAudience === "selected_types" && data.reminderTypes.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reminderTypes"], message: "Escolha pelo menos um tipo de consulta para receber lembretes." });
  }
  const error = validateReminders(data.reminders);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reminders"], message: error });
  }
});

/**
 * Horário de atendimento usado pela ação "Agendar horário". Fica em
 * `TenantAction.config` (ver módulo scheduling) — é configuração da ação, não
 * do agente.
 */
export async function saveScheduleConfigAction(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  let breaks: unknown;
  let weeklyAvailability: WeeklyAvailability | undefined;
  if (formData.has("weeklyAvailability")) {
    try {
      const raw = JSON.parse(String(formData.get("weeklyAvailability")));
      const error = validateWeeklyAvailability(raw);
      if (error) return { ok: false, error };
      weeklyAvailability = parseWeeklyAvailability(raw);
    } catch {
      return { ok: false, error: "Grade de horários inválida. Confira os períodos." };
    }
  }
  try {
    breaks = JSON.parse(String(formData.get("breaks") ?? "[]"));
  } catch {
    return { ok: false, error: "Pausas inválidas. Confira os intervalos." };
  }
  let durations: unknown;
  try {
    durations = JSON.parse(String(formData.get("durations") ?? "[]"));
  } catch {
    return { ok: false, error: "Variações de duração inválidas. Confira os tempos." };
  }
  let reminders: unknown;
  try {
    reminders = JSON.parse(String(formData.get("reminders") ?? "[]"));
  } catch {
    return { ok: false, error: "Lembretes inválidos. Confira as antecedências." };
  }
  let blockedDates: unknown;
  try {
    blockedDates = JSON.parse(String(formData.get("blockedDates") ?? "[]"));
  } catch {
    return { ok: false, error: "Datas bloqueadas inválidas. Confira os dias." };
  }
  // Formulário aberto antes da atualização não pode ampliar um público já
  // restrito. Preservamos a regra salva quando os dois campos novos não vêm.
  let reminderAudience: unknown;
  let reminderTypes: unknown;
  if (!formData.has("reminderAudience") && !formData.has("reminderTypes")) {
    const saved = await prisma.tenantAction.findUnique({
      where: { agentId_key: { agentId: agent.id, key: "schedule_meeting" } },
      select: { config: true },
    });
    const current = parseScheduleConfig(saved?.config);
    reminderAudience = current.reminderAudience;
    reminderTypes = current.reminderTypes;
  } else {
    reminderAudience = formData.get("reminderAudience");
    try {
      reminderTypes = JSON.parse(String(formData.get("reminderTypes") ?? "null"));
    } catch {
      return { ok: false, error: "Tipos de consulta inválidos. Confira quem recebe os lembretes." };
    }
  }
  const parsed = scheduleConfigSchema.safeParse({
    ...Object.fromEntries(formData),
    breaks,
    durations,
    reminders,
    blockedDates,
    reminderAudience,
    reminderTypes,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Checkboxes: `getAll` porque um <input name="workdays"> por dia marcado.
  const workdays = weeklyAvailability ? weeklyAvailability.flatMap((ranges, day) => ranges.length ? [day] : []) : formData
    .getAll("workdays")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (weeklyAvailability === undefined && workdays.length === 0) {
    return { ok: false, error: "Escolha pelo menos um dia de atendimento." };
  }

  const [startH, startM] = parsed.data.startTime.split(":").map(Number);
  const [endH, endM] = parsed.data.endTime.split(":").map(Number);
  if (startH * 60 + startM >= endH * 60 + endM) {
    return { ok: false, error: "O fim do expediente precisa ser depois do início." };
  }
  const breakError = validateScheduleBreaks(parsed.data);
  if (breakError) return { ok: false, error: breakError };
  // O `superRefine` já recusou minuto em branco; este filtro é o que convence
  // o tipo (e garante que um `null` que escape nunca vire duração 0 no banco).
  const filledDurations = parsed.data.durations.filter(
    (d): d is { label: string; minutes: number } => d.minutes !== null,
  );
  // Nome repetido o Zod não pega: são duas linhas válidas isoladamente.
  const durationError = validateDurations(filledDurations);
  if (durationError) return { ok: false, error: durationError };

  const metaTemplate = await readMetaReminderTemplate(formData, tenantId, agent.id, parsed.data.location);
  if (!metaTemplate.ok) return { ok: false, error: metaTemplate.error };

  const existingReminderSettings = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId: agent.id, key: "schedule_meeting" } }, select: { config: true },
  });
  const previousReminderSettings = parseScheduleConfig(existingReminderSettings?.config);
  const qrEnabled = formData.has("clinicorpQrEnabled") ? formData.get("clinicorpQrEnabled") === "true" : previousReminderSettings.clinicorpQrEnabled;
  let qrCategoryIds = previousReminderSettings.clinicorpReminderCategoryIds;
  let qrRiskAcceptance = previousReminderSettings.clinicorpQrRiskAcceptance;
  let newQrRiskAcceptance = false;
  if (qrEnabled) {
    // O bloqueio do admin vence a exceção: sem o QR liberado não há canal por
    // onde confirmar, e o aceite de risco seria registrado para nada.
    if (!previousReminderSettings.clinicorpQrEnabled && !(await isEvolutionEnabled(tenantId))) {
      return { ok: false, error: "O WhatsApp por QR foi desativado pelo administrador para esta conta." };
    }
    // A forged POST cannot activate without the current terms/name. Ordinary
    // saves retain a valid acceptance; reactivation always requires a new one.
    if (!previousReminderSettings.clinicorpQrEnabled || formData.has("clinicorpQrRiskAccepted")) {
      const consent = validateQrRiskConsent(formData);
      if (!consent.ok) return consent;
      const { session } = await requireTenant();
      if (!session.user.id) return { ok: false, error: "Entre novamente para registrar o aceite." };
      qrRiskAcceptance = createQrRiskAcceptance(consent.responsibleName, session.user.id);
      newQrRiskAcceptance = true;
    }
    if (parsed.data.reminderAudience !== "selected_types" || !parsed.data.reminderTypes.length) {
      return { ok: false, error: "Para confirmar pacientes do Clinicorp pelo QR, escolha os tipos de consulta autorizados." };
    }
    if (formData.has("clinicorpQrEnabled") && formData.get("clinicorpQrConsent") !== "true") {
      return { ok: false, error: "Confirme que os pacientes dos tipos escolhidos autorizaram as confirmações pelo WhatsApp." };
    }
    const categories = await listClinicorpCategories(tenantId);
    if (!categories.ok) return { ok: false, error: "Não foi possível conferir as categorias no Clinicorp. Tente novamente." };
    const selected = new Set(parsed.data.reminderTypes.map(normalizeDurationLabel));
    qrCategoryIds = categories.data.filter((c) => selected.has(normalizeDurationLabel(c.name))).map((c) => c.id);
    if (!qrCategoryIds.length) return { ok: false, error: "Escolha uma categoria existente no Clinicorp para as confirmações pelo QR." };
  }
  await saveScheduleConfig(tenantId, agent.id, {
    ...parsed.data,
    clinicorpQrEnabled: qrEnabled,
    ...(qrRiskAcceptance ? { clinicorpQrRiskAcceptance: qrRiskAcceptance } : {}),
    clinicorpReminderCategoryIds: qrCategoryIds,
    ...(qrEnabled ? { clinicorpQrConsentAt: previousReminderSettings.clinicorpQrConsentAt ?? new Date().toISOString() } : {}),
    ...(weeklyAvailability !== undefined ? { weeklyAvailability, breaks: [] } : {}),
    durations: filledDurations,
    workdays,
    ...(metaTemplate.template ? { metaReminderTemplate: metaTemplate.template } : {}),
  });
  if (newQrRiskAcceptance) {
    await recordAudit({ event: "scheduling.qr_risk_accepted", tenantId,
      target: { type: "Agent", id: agent.id, label: agent.name },
      after: { clinicorpQrEnabled: true, clinicorpQrRiskAcceptance: qrRiskAcceptance },
      meta: { agentId: agent.id, provider: "evolution" },
    });
  }
  revalidateAgent(agent.id);
  revalidatePath("/agenda");
  return { ok: true, info: newQrRiskAcceptance ? "Termos registrados e confirmações pelo QR ativadas." : "Configurações de agendamento salvas." };
}

/**
 * O template da Meta escolhido para o lembrete de primeiro contato, conferido.
 *
 * Mesmo cuidado dos Disparos: o template congelado no formulário precisa
 * continuar aprovado e igual na Meta — senão a tela mostraria uma prévia que
 * não é o que sai, ou cada lembrete seria recusado. Só pergunta à Meta quando o
 * template mudou: os switches desta tela salvam sozinhos, e cada clique não
 * pode depender da Graph API responder.
 */
async function readMetaReminderTemplate(
  formData: FormData,
  tenantId: string,
  agentId: string,
  location: string,
): Promise<{ ok: true; template: MetaReminderTemplate | null } | { ok: false; error: string }> {
  const raw = String(formData.get("metaReminderTemplate") ?? "");
  if (!raw || raw === "null") return { ok: true, template: null };
  const template = (() => {
    try {
      return parseMetaReminderTemplate(JSON.parse(raw));
    } catch {
      return null;
    }
  })();
  if (!template) return { ok: false, error: "Template da Meta inválido. Carregue os templates e escolha de novo." };
  const error = validateMetaReminderTemplate(template, { location });
  if (error) return { ok: false, error };

  const saved = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "schedule_meeting" } },
    select: { config: true },
  });
  const current = parseScheduleConfig(saved?.config).metaReminderTemplate;
  if (current && sameBroadcastTemplate(current, template)) return { ok: true, template };

  const connection = await getBroadcastConnection(tenantId);
  if (!connection) {
    return { ok: false, error: "Conecte o WhatsApp pela API oficial da Meta em Integrações para usar um template." };
  }
  let templates: BroadcastTemplate[];
  try {
    templates = await connection.provider.listBroadcastTemplates();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Não foi possível consultar os templates na Meta." };
  }
  if (!templates.some((t) => sameBroadcastTemplate(t, template))) {
    return { ok: false, error: "Esse template não está mais aprovado na Meta, ou foi alterado. Carregue os templates e escolha de novo." };
  }
  return { ok: true, template };
}

/**
 * Templates aprovados da Meta, para escolher o do lembrete de primeiro
 * contato. Buscado no clique, como os tipos do Clinicorp: a Graph API não
 * entra no carregamento da tela de agentes.
 */
export async function loadReminderTemplatesAction(): Promise<
  { ok: true; templates: BroadcastTemplate[] } | { ok: false; error: string }
> {
  const { tenantId } = await requireTenant();
  const connection = await getBroadcastConnection(tenantId);
  if (!connection) {
    return { ok: false, error: "Conecte o WhatsApp pela API oficial da Meta em Integrações para usar templates." };
  }
  try {
    const templates = await connection.provider.listBroadcastTemplates();
    if (!templates.length) {
      return { ok: false, error: "Nenhum template aprovado e compatível na Meta. Crie um em Disparos › Modelos de mensagem e aguarde a aprovação." };
    }
    return { ok: true, templates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Não foi possível consultar os templates na Meta." };
  }
}

/**
 * Categorias de agendamento do Clinicorp, para preencher os NOMES das variações
 * de duração sem digitar um por um.
 *
 * Só os nomes: `/appointment/list_categories` devolve `id`, `Description` e
 * `Color` — **o Clinicorp não informa a duração de cada categoria** (o único
 * tempo que a API expõe é o `SlotTime` da clínica inteira, em
 * `/group/list_subscribers_clinics`). Por isso o minuto volta vazio e quem
 * conhece a clínica preenche: chutar a duração aqui seria a tela afirmando um
 * dado que ninguém informou, e o preço do chute é cadeira ocupada errado.
 *
 * Buscado sob demanda (no clique), não a cada render da tela de agentes — mesmo
 * motivo de `loadClinicorpProfessionalsAction`.
 */
export async function loadClinicorpDurationNamesAction(): Promise<
  { ok: true; names: string[] } | { ok: false; error: string }
> {
  const result = await loadClinicorpAppointmentTypeNames();
  return result.ok ? { ok: true, names: result.names.slice(0, MAX_DURATIONS) } : result;
}

/** Público de lembretes não tem o limite das variações de duração. */
export async function loadClinicorpReminderTypesAction(): Promise<
  { ok: true; names: string[] } | { ok: false; error: string }
> {
  return loadClinicorpAppointmentTypeNames();
}

async function loadClinicorpAppointmentTypeNames(): Promise<
  { ok: true; names: string[] } | { ok: false; error: string }
> {
  const { tenantId } = await requireTenant();

  // Habilitado E conectado: a credencial continua salva com o calendário
  // desabilitado, e nesse caso a conta desligou a integração de propósito.
  const features = await getCalendarFeatures(tenantId);
  if (!features.clinicorpEnabled) {
    return { ok: false, error: "O Clinicorp está desabilitado. Habilite em Integrações › Calendários." };
  }

  const result = await listClinicorpCategories(tenantId);
  if (!result.ok) return { ok: false, error: result.error };

  // Nome repetido no Clinicorp não pode virar duas variações: `validateDurations`
  // recusaria o formulário inteiro depois, sem a pessoa entender por quê.
  const names: string[] = [];
  const seen = new Set<string>();
  for (const category of result.data) {
    const key = normalizeDurationLabel(category.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(category.name.slice(0, 60));
  }
  if (!names.length) return { ok: false, error: "Nenhuma categoria de agendamento cadastrada no Clinicorp." };
  return { ok: true, names };
}

// --------------------------------------------------- configuração do follow-up

const followUpSequenceSchema = z.object({
  enabled: z.boolean(),
  steps: z.array(z.object({
    delayMinutes: z.number().int()
      .min(1, "A espera mínima de uma mensagem é 1 minuto.")
      .max(MAX_FOLLOWUP_DELAY_MINUTES, "A espera máxima de uma mensagem é 30 dias."),
    message: z.string().trim().max(MAX_FOLLOWUP_MESSAGE_LENGTH, `Cada mensagem tem no máximo ${MAX_FOLLOWUP_MESSAGE_LENGTH} caracteres.`),
    ai: z.boolean(),
  })).max(MAX_FOLLOWUP_STEPS, `Cada esteira tem no máximo ${MAX_FOLLOWUP_STEPS} mensagens.`),
});

const followUpConfigSchema = z.object({
  noReply: followUpSequenceSchema,
  declined: followUpSequenceSchema,
  window: z.object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  }),
});

/**
 * As duas esteiras da ação "Follow-up automático" e a janela de envio. Fica em
 * `TenantAction.config` (ver módulo follow-up), igual ao horário de
 * atendimento do agendamento. Vem num campo JSON só porque são listas de
 * tamanho variável, como os lembretes da agenda.
 */
export async function saveFollowUpConfigAction(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("config") ?? ""));
  } catch {
    return { ok: false, error: "Follow-up inválido. Confira as mensagens." };
  }
  const parsed = followUpConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  // Esteira ligada sem mensagem, texto em branco, janela invertida: regra
  // dupla, como os lembretes — a tela avisa, mas quem decide é o servidor.
  const error = validateFollowUpConfig(parsed.data);
  if (error) return { ok: false, error };

  await saveFollowUpConfig(tenantId, agent.id, parsed.data);
  revalidateAgent(agent.id);
  return { ok: true, info: "Follow-up salvo." };
}

// ----------------------------------------------------- config da transferência

const handoffConfigSchema = z
  .object({
    // O input oculto em `HandoffSettings` manda "on" ou "". Comparação
    // explícita em vez de `z.coerce.boolean()`, que considera verdadeira
    // QUALQUER string não vazia — inclusive "false" e "off", o que inverteria
    // o desligado em silêncio se a tela um dia passasse a mandar esses valores.
    notifyGroup: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    groupId: z.string().trim().optional().default(""),
    groupName: z.string().trim().optional().default(""),
    groupReason: z
      .string()
      .trim()
      .max(MAX_GROUP_REASON, `O motivo pode ter até ${MAX_GROUP_REASON} caracteres.`)
      .optional()
      .default(""),
  })
  // A recusa vem ANTES da normalização, não depois: se `transform` rodasse
  // primeiro, um ID inválido já teria virado `notifyGroup: false` e o `refine`
  // olharia para um objeto coerente — a tela diria "salvo" com a opção
  // silenciosamente desligada, que é justamente o que o campo obrigatório
  // deveria impedir.
  .superRefine((data, ctx) => {
    if (data.notifyGroup && !normalizeGroupId(data.groupId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupId"],
        message: "Escolha o grupo do WhatsApp (ou cole o ID dele) ou desligue a opção.",
      });
    }
  })
  // Desligado, grupo e motivo continuam gravados: desligar é pausar, não
  // descadastrar. Antes o grupo virava null aqui, e o campo escondido que a
  // tela mantinha no envio justamente para preservá-lo não servia de nada.
  .transform((data): HandoffConfig => {
    const groupId = normalizeGroupId(data.groupId);
    return {
      notifyGroup: data.notifyGroup && Boolean(groupId),
      groupId,
      groupName: groupId && data.groupName ? data.groupName.slice(0, MAX_GROUP_NAME) : null,
      groupReason: data.groupReason,
    };
  });

/**
 * Grupos do número conectado, para a tela da transferência escolher em vez de
 * colar o ID. Sob demanda (quando a opção de grupo está ligada), não a cada
 * render de /agentes: a Evolution leva segundos para listar numa conta com
 * muitos grupos.
 */
export async function loadWhatsAppGroupsAction(): Promise<GroupListResult> {
  const { tenantId } = await requireTenant();
  return listWhatsAppGroups(tenantId);
}

/**
 * Config da ação "Transferir para humano" (ver módulo `agent-engine/handoff`):
 * o grupo interno do WhatsApp que recebe o aviso de transferência e quando avisar.
 */
export async function saveHandoffConfigAction(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = handoffConfigSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  await saveHandoffConfig(tenantId, agent.id, parsed.data);
  revalidateAgent(agent.id);
  return { ok: true, info: "Transferência salva." };
}

// ----------------------------------------------------------- conhecimento

// Mantenha em sincronia com serverActions.bodySizeLimit em next.config.ts —
// aquele é o teto duro do Next.js (a requisição nem chega aqui se estourar);
// este é o que dá pro usuário uma mensagem legível em vez de um crash 413.
const MAX_KB_FILE_BYTES = 50 * 1024 * 1024;

export async function addDocument(_prev: Result | null, formData: FormData): Promise<Result> {
  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const title = String(formData.get("title") ?? "").trim();
  const pasted = String(formData.get("content") ?? "").trim();
  const file = formData.get("file");

  if (!title) return { ok: false, error: "Dê um título ao documento" };

  if (file instanceof File && file.size > MAX_KB_FILE_BYTES) {
    return { ok: false, error: "Arquivo muito grande. O tamanho máximo é 50MB." };
  }

  let content = pasted;
  let fileUrl: string | undefined;
  let fileName: string | undefined;
  try {
    if (file instanceof File && file.size > 0) {
      content = await extractTextFromFile(file);

      // Guarda o arquivo original na CDN — antes ele era descartado depois de
      // extrair o texto, e o cliente não tinha como baixar de volta o que enviou.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `knowledge/${tenantId}/${agent.id}/${Date.now()}-${safeName}`;
      const uploaded = await uploadToBunny(
        path,
        Buffer.from(await file.arrayBuffer()),
        file.type || "application/octet-stream",
      );
      if (uploaded.ok) {
        fileUrl = uploaded.url;
        fileName = file.name;
      } else {
        console.error("[knowledge-base] falha ao guardar arquivo original na CDN", uploaded.error);
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao ler arquivo" };
  }

  if (!content) return { ok: false, error: "Cole um texto ou envie um arquivo" };

  const doc = await ingestDocument({ tenantId, agentId: agent.id, title, content, fileUrl, fileName });

  await recordAudit({
    event: "knowledge.added",
    target: { type: "KnowledgeDocument", id: doc.id, label: title },
    // Sem o `content`: um documento pode ter dezenas de milhares de
    // caracteres, e o log guarda o que aconteceu, não uma segunda cópia da
    // base de conhecimento. Tamanho é o bastante para auditar.
    after: { title, status: doc.status, fileName, caracteres: content.length },
    meta: { agente: agent.name },
  });

  revalidateAgent(agent.id);
  const info =
    doc.status === "no_embeddings"
      ? "Documento salvo (embeddings desativados: configure GEMINI_API_KEY)."
      : doc.status === "failed"
        ? "Documento salvo, mas houve falha ao gerar embeddings."
        : "Documento adicionado à base.";
  return { ok: true, info };
}

export async function removeDocument(agentId: string, documentId: string): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  // Lido antes de apagar: é este snapshot que permite restaurar o documento
  // com o mesmo id em /admin/logs. O `content` entra inteiro (é o que faz a
  // restauração valer a pena) e o redator corta se passar do teto — nesse
  // caso o revert recusa em vez de recriar um documento truncado.
  const doc = await getDocument(tenantId, agent.id, documentId);

  await deleteDocument(tenantId, documentId);

  if (doc) {
    await recordDeletion({
      event: "knowledge.deleted",
      target: { type: "KnowledgeDocument", id: documentId, label: doc.title },
      snapshot: {
        id: documentId,
        tenantId,
        agentId: agent.id,
        title: doc.title,
        content: doc.content,
        status: doc.status,
        // A URL volta, mas o arquivo em si já saiu da CDN — restaurar o
        // documento devolve o texto extraído, não o anexo original.
        fileUrl: doc.fileUrl,
        fileName: doc.fileName,
      },
      meta: { agente: agent.name, arquivoNaCdn: Boolean(doc.fileUrl) },
    });
  }

  revalidateAgent(agent.id);
  return { ok: true };
}

type DocumentContentResult =
  | { ok: true; title: string; content: string; revision: string }
  | { ok: false; error: string };

// Busca o texto sob demanda (ao abrir o modal de ver/editar) em vez de mandar
// o conteúdo de todo documento na lista — evita puxar texto grande sem precisar.
export async function getDocumentContent(
  agentId: string,
  documentId: string,
): Promise<DocumentContentResult> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const doc = await getDocument(tenantId, agent.id, documentId);
  if (!doc) return { ok: false, error: "Documento não encontrado" };
  return { ok: true, title: doc.title, content: doc.content, revision: createHash("sha256").update(JSON.stringify([doc.title, doc.content])).digest("hex") };
}

export async function updateDocumentAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title) return { ok: false, error: "Dê um título ao documento" };
  if (!content) return { ok: false, error: "O texto não pode ficar vazio" };

  const previous = await getDocument(tenantId, agent.id, documentId);

  const isDraftPublish = formData.has("baseRevision");
  if (isDraftPublish && (!previous || createHash("sha256").update(JSON.stringify([previous.title, previous.content])).digest("hex") !== String(formData.get("baseRevision")))) return { ok: false, error: "Este documento mudou desde que você abriu. Reabra a versão publicada antes de tentar novamente." };
  const doc = isDraftPublish
    ? await publishDocumentDraft(tenantId, agent.id, documentId, { title, content, baseTitle: previous!.title, baseContent: previous!.content })
    : await updateDocument(tenantId, agent.id, documentId, { title, content });
  if (!doc) return { ok: false, error: "Documento não encontrado" };
  if ("ok" in doc && !doc.ok) return { ok: false, error: doc.error };

  await recordChange({
    event: "knowledge.updated",
    target: { type: "KnowledgeDocument", id: documentId, label: title },
    before: { title: previous?.title, content: previous?.content },
    after: { title, content },
    meta: { agente: agent.name },
  });

  revalidateAgent(agent.id);
  const info =
    doc.status === "no_embeddings"
      ? "Documento atualizado (embeddings desativados: configure GEMINI_API_KEY)."
      : doc.status === "failed"
        ? "Documento atualizado, mas houve falha ao gerar embeddings."
        : "Documento atualizado.";
  return { ok: true, info };
}
