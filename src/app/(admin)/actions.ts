"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PlanKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { requireSuperadmin } from "@/lib/session";
import { setImpersonation, clearImpersonation } from "@/lib/impersonation";
import {
  setTenantStatus,
  adminSetPlan,
  adminSetUsageLimit,
  adminSetPriceOverride,
  adminSetTrialEndsAt,
  adminCreateAccount,
  deleteTenant,
} from "@/modules/admin/service";
import { strongPassword } from "@/lib/password-schema";
import {
  createProvider,
  getActiveModel,
  getActiveModelId,
  invalidateChainCache,
  isAiError,
  getUsableChain,
  resolveSecret,
  setActiveModelId,
} from "@/modules/ai";
import { addCredential, clearCooldown, deleteCredential } from "@/modules/ai/credentials";
import { saveChain } from "@/modules/ai/chain";
import { isEncryptionConfigured } from "@/lib/crypto";
import { recordAudit, recordChange } from "@/modules/audit/log";
import { closeWhatsappIncidents } from "@/modules/whatsapp/incidents";
import { revertAuditLog } from "@/modules/audit/revert";
import { deleteAuditLog } from "@/modules/audit/delete";
import { requestContext } from "@/modules/auth/attempts";
import { blockIp, unblockIp, ipActivity } from "@/modules/auth/ip-block";

import { recordUsage } from "@/modules/ai/usage";
import { buildAgentPackage, createAgentFromPackage } from "@/modules/agent-engine/transfer";

export type AdminAgentCopyResult = {
  ok: boolean;
  error?: string;
  info?: string;
  agentId?: string;
  warnings?: string[];
};

/** Replica um agente de qualquer empresa para outra, sempre desligado. */
export async function adminReplicateAgent(input: {
  sourceAgentId: string;
  destinationTenantId: string;
  name?: string;
}): Promise<AdminAgentCopyResult> {
  await requireSuperadmin();
  const parsed = z
    .object({
      sourceAgentId: z.string().min(1),
      destinationTenantId: z.string().min(1),
      name: z.string().trim().max(60).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Escolha o agente e a empresa de destino." };

  const portable = await buildAgentPackage(parsed.data.sourceAgentId);
  if (!portable) return { ok: false, error: "Agente de origem não encontrado." };

  const result = await createAgentFromPackage({
    tenantId: parsed.data.destinationTenantId,
    package: portable,
    name: parsed.data.name,
  });
  if (!result.ok) return result;

  await recordAudit({
    event: "admin.agent_replicated",
    tenantId: parsed.data.destinationTenantId,
    target: { type: "Agent", id: result.agentId, label: result.name },
    after: {
      name: result.name,
      sourceAgentId: parsed.data.sourceAgentId,
      sourceTenant: portable.source?.tenantName,
    },
    meta: { warnings: result.warnings },
  });

  revalidatePath("/admin/agentes");
  revalidatePath("/admin/logs");
  return {
    ok: true,
    agentId: result.agentId,
    warnings: result.warnings,
    info: result.warnings.length
      ? `Agente replicado desligado. ${result.warnings.join(" ")}`
      : "Agente replicado e deixado desligado para revisão.",
  };
}

export async function suspendTenant(tenantId: string, suspend: boolean) {
  await requireSuperadmin();

  // Lê antes de escrever: o log guarda o estado anterior, e é ele que o botão
  // "desfazer" da trilha regrava. Sem esta leitura o evento saberia dizer o
  // que aconteceu, mas não teria como voltar atrás.
  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, status: true },
  });
  if (!before) return;

  const status = suspend ? "suspended" : "active";
  await setTenantStatus(tenantId, status);

  await recordChange({
    event: suspend ? "admin.tenant_suspended" : "admin.tenant_reactivated",
    target: { type: "Tenant", id: tenantId, label: before.name },
    before: { status: before.status },
    after: { status },
    tenantId,
  });

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
}

export type DeleteTenantResult = { ok: boolean; error?: string };

/**
 * Exclui uma conta DEFINITIVAMENTE. Sem desfazer.
 *
 * Exige a conta já **suspensa**. Não é burocracia: suspender é o passo
 * reversível que dá tempo de perceber o engano, e obrigá-lo antes torna
 * impossível apagar a conta errada num clique só — a lista tem contas de nomes
 * parecidos e a linha de cima já é destrutiva. Quem confirma a exclusão já viu
 * a conta parada e sabe qual é.
 *
 * **Conta de admin também pode ser excluída**, desde que suspensa e desde que
 * não seja a última. Antes eram todas recusadas em bloco, o que resolvia o
 * risco real (trancar todo mundo para fora do /admin) do jeito mais grosso
 * possível: um admin desligado ficava para sempre na lista, suspenso e
 * inapagável, e limpá-lo exigia ir ao banco à mão — justamente a saída que
 * não deixa rastro nenhum. A checagem certa não é "é admin?", é "sobra algum
 * admin depois?", e é essa que ficou.
 *
 * As checagens moram aqui, no servidor, e não só no botão: esconder a ação da
 * tela não é autorização, e a action é chamável direto.
 */
export async function deleteTenantAccount(tenantId: string): Promise<DeleteTenantResult> {
  const session = await requireSuperadmin();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      planKey: true,
      createdAt: true,
      users: { select: { id: true, email: true, role: true } },
      _count: { select: { users: true, leads: true, conversations: true } },
    },
  });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };

  // A própria conta do admin logado — apagá-la derrubaria quem está apagando.
  if (tenantId === session.user.tenantId) {
    return { ok: false, error: "Não é possível excluir a sua própria conta." };
  }
  if (tenant.status !== "suspended") {
    return { ok: false, error: "Suspenda a conta antes de excluí-la." };
  }

  const admins = tenant.users.filter((u) => u.role === "SUPERADMIN");
  if (admins.length > 0) {
    // Sobrar zero admin tranca todo mundo para fora do /admin, sem caminho de
    // volta pela interface — só rodando `npm run db:admin` no servidor. A
    // contagem é feita agora, não confiada à tela: entre carregar a lista e
    // clicar em excluir, outro admin pode ter sido removido.
    const remaining = await prisma.user.count({
      where: { role: "SUPERADMIN", tenantId: { not: tenantId } },
    });
    if (remaining === 0) {
      return {
        ok: false,
        error: "Esta é a última conta de admin — excluí-la deixaria a plataforma sem acesso.",
      };
    }
  }

  // O log da exclusão é gravado ANTES do delete, com a conta ainda em mãos: é
  // a última chance de ler quem ela era. `tenantId` na linha vira null pelo
  // `SetNull` do schema, mas `tenantName` e o snapshot permanecem — o evento
  // mais grave da trilha não pode sumir junto com o que ele registra.
  await recordAudit({
    event: "admin.tenant_deleted",
    target: { type: "Tenant", id: tenantId, label: tenant.name },
    before: {
      name: tenant.name,
      planKey: tenant.planKey,
      status: tenant.status,
      createdAt: tenant.createdAt,
      usuarios: tenant.users.map((u) => ({ email: u.email, role: u.role })),
    },
    after: null,
    meta: {
      eraContaAdmin: admins.length > 0,
      usuarios: tenant._count.users,
      leads: tenant._count.leads,
      conversas: tenant._count.conversations,
    },
    tenantId,
  });

  await deleteTenant(tenantId);
  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
  return { ok: true };
}

export async function changePlan(tenantId: string, planKey: PlanKey) {
  await requireSuperadmin();

  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, planKey: true },
  });
  if (!before) return;

  await adminSetPlan(tenantId, planKey);

  await recordChange({
    event: "admin.plan_changed",
    target: { type: "Tenant", id: tenantId, label: before.name },
    before: { planKey: before.planKey },
    after: { planKey },
    tenantId,
  });

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
}

/** Altera a cota de mensagens/mês da conta (null = volta ao padrão do plano). */
export async function setTenantUsageLimit(tenantId: string, limit: number | null) {
  await requireSuperadmin();

  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, messageLimitOverride: true },
  });
  if (!before) return;

  await adminSetUsageLimit(tenantId, limit);

  await recordChange({
    event: "admin.usage_limit_changed",
    target: { type: "Tenant", id: tenantId, label: before.name },
    before: { messageLimitOverride: before.messageLimitOverride },
    after: { messageLimitOverride: limit },
    tenantId,
  });

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
}

/**
 * Altera o preço cobrado da conta (null = volta ao preço de tabela do plano).
 *
 * Só afeta o "Investido"/ROI da visão Financeira de /relatorios. A cota e os
 * limites continuam no plano — para mudar aqueles, muda-se o plano.
 */
export async function setTenantPriceOverride(tenantId: string, priceCents: number | null) {
  await requireSuperadmin();

  // Preço negativo inverteria o sinal do ROI do cliente; zero é legítimo
  // (cortesia), então o piso é 0 e não 1.
  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0)) return;

  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, priceCentsOverride: true },
  });
  if (!before) return;

  await adminSetPriceOverride(tenantId, priceCents);

  await recordChange({
    event: "admin.price_override_changed",
    target: { type: "Tenant", id: tenantId, label: before.name },
    before: { priceCentsOverride: before.priceCentsOverride },
    after: { priceCentsOverride: priceCents },
    tenantId,
  });

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
  // O relatório do cliente mostra o valor novo sem esperar o cache expirar.
  revalidatePath("/relatorios");
}

/**
 * Ajusta o período de teste da conta. `days` conta a partir de agora
 * (null = encerra o teste na hora, e a IA para até a pessoa assinar).
 */
export async function setTenantTrial(tenantId: string, days: number | null) {
  await requireSuperadmin();

  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, trialEndsAt: true },
  });
  if (!before) return;

  const endsAt = days == null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await adminSetTrialEndsAt(tenantId, endsAt);

  await recordChange({
    event: "admin.trial_changed",
    target: { type: "Tenant", id: tenantId, label: before.name },
    before: { trialEndsAt: before.trialEndsAt },
    after: { trialEndsAt: endsAt },
    meta: { dias: days },
    tenantId,
  });

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
}

export type TenantMetaWhatsappAccessResult = {
  ok: boolean;
  error?: string;
  info?: string;
};

/**
 * Libera ou recolhe a alternativa oficial da Meta para uma conta.
 *
 * Ao recolher, só a conexão Meta da conta é desligada localmente: a Evolution
 * (QR code) é outra linha e segue atendendo. Os segredos ficam preservados
 * para uma reativação futura; apagar credenciais aqui tornaria um toggle
 * administrativo desnecessariamente destrutivo.
 */
export async function setTenantMetaWhatsappEnabled(
  tenantId: string,
  enabled: boolean,
): Promise<TenantMetaWhatsappAccessResult> {
  await requireSuperadmin();
  if (typeof enabled !== "boolean") {
    return { ok: false, error: "Estado inválido para a API oficial da Meta." };
  }

  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      metaWhatsappEnabled: true,
      whatsappInstances: { select: { provider: true, status: true } },
    },
  });
  if (!before) return { ok: false, error: "Conta não encontrada." };

  const disconnectingMeta =
    !enabled &&
    before.whatsappInstances.some((i) => i.provider === "meta" && i.status !== "disconnected");
  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: { metaWhatsappEnabled: enabled },
    }),
    ...(disconnectingMeta
      ? [
          prisma.whatsappInstance.updateMany({
            where: { tenantId, provider: "meta" },
            data: { status: "disconnected" },
          }),
        ]
      : []),
  ]);

  await recordChange({
    event: "admin.meta_whatsapp_access_changed",
    target: { type: "Tenant", id: tenantId, label: before.name },
    before: { metaWhatsappEnabled: before.metaWhatsappEnabled },
    after: { metaWhatsappEnabled: enabled },
    meta: { disconnectedMeta: disconnectingMeta },
    tenantId,
  });

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
  revalidatePath("/integracoes");
  revalidatePath("/inicio");
  return {
    ok: true,
    info: enabled
      ? "API oficial da Meta liberada para esta conta."
      : disconnectingMeta
        ? "API oficial ocultada e conexão Meta interrompida. As credenciais foram preservadas."
        : "API oficial da Meta ocultada para esta conta.",
  };
}

export type TenantEvolutionWhatsappAccessResult = TenantMetaWhatsappAccessResult;

/**
 * Liga ou desliga o WhatsApp por QR (Evolution) de uma conta.
 *
 * Desligar só muda a flag: a sessão do QR e a linha `WhatsappInstance` ficam
 * como estão (nada de logout, nada de apagar credencial), então reativar volta
 * na hora, sem novo QR. O bloqueio é aplicado na leitura
 * (`listWhatsappChannels`), no webhook, no monitor de saúde e nas ações de
 * conexão. A linha da Meta não é tocada.
 */
export async function setTenantEvolutionWhatsappEnabled(
  tenantId: string,
  enabled: boolean,
): Promise<TenantEvolutionWhatsappAccessResult> {
  await requireSuperadmin();
  if (typeof enabled !== "boolean") {
    return { ok: false, error: "Estado inválido para o WhatsApp por QR." };
  }

  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, evolutionWhatsappEnabled: true },
  });
  if (!before) return { ok: false, error: "Conta não encontrada." };

  if (before.evolutionWhatsappEnabled !== enabled) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { evolutionWhatsappEnabled: enabled },
    });

    // Desligar por decisão do admin não é queda: fecha a em aberto, como o
    // "Desconectar" do painel, para o relatório mensal não contá-la como falha.
    if (!enabled) await closeWhatsappIncidents(tenantId, "evolution");

    await recordChange({
      event: "admin.evolution_whatsapp_access_changed",
      target: { type: "Tenant", id: tenantId, label: before.name },
      before: { evolutionWhatsappEnabled: before.evolutionWhatsappEnabled },
      after: { evolutionWhatsappEnabled: enabled },
      tenantId,
    });
  }

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
  revalidatePath("/integracoes");
  revalidatePath("/inicio");
  return {
    ok: true,
    info: enabled
      ? "WhatsApp por QR liberado para esta conta."
      : "WhatsApp por QR desligado. A sessão foi mantida e volta ao reativar.",
  };
}

export type CreateAccountResult = {
  ok: boolean;
  error?: string;
  /** Só volta quando o admin deixou a senha em branco. Mostrar UMA vez. */
  tempPassword?: string;
  email?: string;
};

const createAccountSchema = z.object({
  tenantName: z.string().trim().min(1, "Informe o nome da conta"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  // Vazio = gerar senha provisória (que já nasce dentro da política); qualquer
  // senha digitada segue a mesma regra de todo mundo.
  password: z.union([z.literal(""), strongPassword()]),
  role: z.enum(["OWNER", "SUPERADMIN"]),
  planKey: z.enum(["FREE", "STARTER", "PRO", "BUSINESS"]),
});

/** Cria uma conta (qualquer papel, qualquer plano) pelo painel admin. */
export async function createAccount(
  _prev: CreateAccountResult | null,
  formData: FormData,
): Promise<CreateAccountResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  await requireSuperadmin();

  const parsed = createAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const result = await adminCreateAccount(parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  // A senha provisória fica FORA do log, mesmo tendo sido gerada aqui: o
  // redator já a removeria, e registrar que ela existiu é o suficiente para a
  // trilha. Criar uma conta com papel de admin é o que realmente interessa.
  const created = await prisma.tenant.findFirst({
    where: { users: { some: { email: parsed.data.email } } },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  await recordAudit({
    event: "admin.account_created",
    target: { type: "Tenant", id: created?.id ?? parsed.data.email, label: parsed.data.tenantName },
    after: {
      tenantName: parsed.data.tenantName,
      email: parsed.data.email,
      role: parsed.data.role,
      planKey: parsed.data.planKey,
    },
    meta: { senhaGerada: Boolean(result.tempPassword) },
    tenantId: created?.id ?? null,
  });

  revalidatePath("/admin/contas");
  revalidatePath("/admin/logs");
  return { ok: true, email: parsed.data.email, tempPassword: result.tempPassword };
}

/** Troca o modelo de IA da plataforma. Vale para o próximo turno do agente. */
export async function changeAiModel(modelId: string) {
  const session = await requireSuperadmin();
  const previous = await getActiveModelId().catch(() => null);

  await setActiveModelId(modelId, session.user.email ?? undefined);

  await recordChange({
    event: "admin.ai_model_changed",
    target: { type: "AiSetting", id: "platform", label: modelId },
    before: { modelId: previous },
    after: { modelId },
    // Configuração da plataforma, não de uma conta: sem tenant, senão o
    // evento apareceria como se pertencesse à conta do admin.
    tenantId: null,
  });

  revalidatePath("/admin/ia");
  revalidatePath("/admin/logs");
}

/**
 * Teto por provedor no teste do painel. Sem isto, um provedor pendurado
 * deixaria o botão girando sem fim — e a chain nem chegaria a ser tentada.
 * Generoso porque um "cold start" de LLM passa de 30s em condição normal.
 */
const TEST_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`sem resposta em ${ms / 1000}s`)), ms),
    ),
  ]);
}

export type AiTestResult = {
  ok: boolean;
  /** Quem respondeu DE FATO — pode não ser o modelo ativo (ver abaixo). */
  provider?: string;
  model?: string;
  modelLabel?: string;
  /** O primeiro degrau da cadeia falhou e outro respondeu no lugar dele. */
  usedFallback?: boolean;
  /** Rótulo da chave que respondeu, ou null quando foi a do `.env`. */
  credentialLabel?: string | null;
  /** Modelo que estava configurado quando o teste rodou. */
  activeModel?: string;
  activeModelLabel?: string;
  /** Trecho da resposta — sinal de vida da API, não prova de identidade. */
  reply?: string;
  latencyMs?: number;
  tokens?: number;
  error?: string;
};

/**
 * Dispara uma chamada real ao LLM e diz QUEM respondeu.
 *
 * O painel mostrava o modelo configurado, mas o agente tem uma chain de
 * fallback (Gemini free → Grok → Groq): quando o modelo ativo estoura a cota,
 * outro provedor responde em silêncio. Sem esta prova, ler "Gemini 2.5 Flash"
 * na tela não significava que era o Gemini atendendo os leads.
 *
 * Percorre a MESMA chain do orquestrador (`getGeminiFallbackChain`) para que o
 * resultado valha para a conversa de verdade — um teste que só chamasse o
 * modelo ativo responderia outra pergunta.
 *
 * Não passa por `runAgentTurn` de propósito: nada de tenant, conversa, cota ou
 * histórico. É um ping ao provedor, e o custo é de uma frase.
 */
export async function testAiModel(): Promise<AiTestResult> {
  await requireSuperadmin();

  const active = await getActiveModel();
  const started = Date.now();

  // A MESMA cadeia do orquestrador — a que o admin montou, com as credenciais
  // dele. Um teste que percorresse outra ordem responderia outra pergunta.
  const chain = await getUsableChain();

  let lastError = "Nenhum provedor respondeu.";

  for (const [i, step] of chain.entries()) {
    const model = step.model;
    const isFallback = i > 0;
    const apiKey = await resolveSecret(model.provider, step.credentialId);
    if (!apiKey) {
      lastError = step.credentialId
        ? `A chave "${step.credentialLabel}" não pôde ser lida.`
        : `${model.envKey} não está configurada neste ambiente.`;
      continue;
    }
    try {
      const provider = createProvider(model, apiKey);
      // Um prompt trivial de propósito. Perguntar "qual modelo é você?" parece
      // a prova óbvia e não é: num teste real o Gemini respondeu "GPT-4o" —
      // modelos não sabem com segurança o próprio nome. Quem responde é o
      // provider que executou a chamada (`provider.provider`/`.model`), não o
      // texto gerado; o texto fica só como sinal de que a API respondeu.
      const result = await withTimeout(
        provider.complete([{ role: "user", content: "Responda apenas: ok" }], []),
        TEST_TIMEOUT_MS,
      );

      // Contabiliza como qualquer outra chamada: o teste gasta tokens de
      // verdade e some do relatório de uso seria mentir sobre o consumo.
      await recordUsage(provider.provider, result.usage).catch(() => {});

      return {
        ok: true,
        provider: provider.provider,
        model: provider.model,
        modelLabel: model.label,
        usedFallback: isFallback,
        credentialLabel: step.credentialLabel,
        activeModel: active.id,
        activeModelLabel: active.label,
        reply: result.content.trim().slice(0, 200),
        latencyMs: Date.now() - started,
        tokens: result.usage?.totalTokens,
      };
    } catch (err) {
      const who = step.credentialLabel ? `${model.label} (${step.credentialLabel})` : model.label;
      lastError = isAiError(err)
        ? `${who}: ${err.code}`
        : `${who}: ${err instanceof Error ? err.message : "falha inesperada"}.`;
    }
  }

  return { ok: false, error: lastError, activeModel: active.id, activeModelLabel: active.label };
}

/* ------------------------------------------------------------------ *
 * Cadeia de fallback e credenciais de IA.
 * ------------------------------------------------------------------ */

const credentialSchema = z
  .object({
    provider: z.enum(["gemini", "openai", "grok", "groq", "custom"]),
    label: z.string().trim().max(60),
    // Sem `.max()` apertado: chaves de provedores variam muito de formato e
    // tamanho, e recusar uma válida por palpite seria pior que aceitar.
    secret: z.string().trim().min(8, "Chave curta demais para ser válida."),
    baseUrl: z.string().trim().optional(),
    modelId: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.provider !== "custom" || Boolean(v.baseUrl && v.modelId), {
    message: "Provedor personalizado precisa de URL base e nome do modelo.",
  })
  .refine((v) => v.provider !== "custom" || /^https:\/\//i.test(v.baseUrl ?? ""), {
    // https obrigatório: a chave viaja no header, e http entregaria a
    // credencial em texto claro para qualquer um no caminho.
    message: "A URL base precisa começar com https://",
  });

export type SaveResult = { ok: boolean; error?: string };

/** Cadastra uma chave de API. O segredo é cifrado antes de tocar o banco. */
export async function addAiCredential(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const session = await requireSuperadmin();

  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error: "Falta ENCRYPTION_KEY no servidor — sem ela a chave não pode ser guardada com segurança.",
    };
  }

  const parsed = credentialSchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    secret: formData.get("secret"),
    baseUrl: formData.get("baseUrl") ?? undefined,
    modelId: formData.get("modelId") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  try {
    await addCredential({ ...parsed.data, createdBy: session.user.email ?? undefined });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Não foi possível salvar." };
  }

  // `secret` fica de fora do snapshot de propósito, e não por acaso: o redator
  // o removeria de qualquer jeito, mas nem chega a ser passado. O que a trilha
  // precisa é saber que uma chave daquele provedor entrou, e por quem.
  await recordAudit({
    event: "admin.ai_credential_added",
    target: { type: "AiCredential", id: parsed.data.label || parsed.data.provider, label: parsed.data.label },
    after: {
      provider: parsed.data.provider,
      label: parsed.data.label,
      modelId: parsed.data.modelId,
      baseUrl: parsed.data.baseUrl,
    },
    tenantId: null,
  });

  revalidatePath("/admin/ia");
  revalidatePath("/admin/logs");
  return { ok: true };
}

export async function removeAiCredential(id: string): Promise<SaveResult> {
  await requireSuperadmin();

  const credential = await prisma.aiCredential
    .findUnique({ where: { id }, select: { label: true, provider: true } })
    .catch(() => null);

  try {
    await deleteCredential(id);
  } catch {
    return { ok: false, error: "Não foi possível remover a chave." };
  }

  await recordAudit({
    event: "admin.ai_credential_removed",
    target: { type: "AiCredential", id, label: credential?.label ?? null },
    before: { provider: credential?.provider, label: credential?.label },
    tenantId: null,
  });

  invalidateChainCache();
  revalidatePath("/admin/ia");
  revalidatePath("/admin/logs");
  return { ok: true };
}

/** Tira a credencial da quarentena antes da hora. */
export async function clearAiCooldown(id: string): Promise<SaveResult> {
  await requireSuperadmin();
  try {
    await clearCooldown(id);
  } catch {
    return { ok: false, error: "Não foi possível liberar a chave." };
  }
  invalidateChainCache();
  revalidatePath("/admin/ia");
  return { ok: true };
}

/** Regrava a cadeia inteira, na ordem que o admin montou. */
export async function saveAiChain(
  steps: { modelId: string; credentialId: string | null; enabled: boolean }[],
): Promise<SaveResult> {
  await requireSuperadmin();
  try {
    await saveChain(steps);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Não foi possível salvar a sequência.",
    };
  }
  revalidatePath("/admin/ia");
  return { ok: true };
}

/** Minutos de quarentena depois de uma falha de cota (0 desliga). */
export async function setAiCooldownMinutes(minutes: number): Promise<SaveResult> {
  const session = await requireSuperadmin();
  const value = Math.trunc(minutes);
  if (!Number.isInteger(value) || value < 0 || value > 10_080) {
    return { ok: false, error: "Informe de 0 a 10080 minutos (até uma semana)." };
  }
  await prisma.aiSetting.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      modelId: await getActiveModelId(),
      cooldownMinutes: value,
      updatedBy: session.user.email ?? undefined,
    },
    update: { cooldownMinutes: value, updatedBy: session.user.email ?? undefined },
  });
  invalidateChainCache();
  revalidatePath("/admin/ia");
  return { ok: true };
}

export type ImpersonateResult = { ok: boolean; error?: string };

/**
 * Entra como um usuário (normalmente o dono da conta): grava um cookie
 * assinado que faz os guards do dashboard tratar a sessão como a do cliente.
 * Sai com stopImpersonation(). Não dá para personificar conta do admin
 * (SUPERADMIN) nem a própria conta.
 */
export async function impersonateUser(userId: string): Promise<ImpersonateResult> {
  const session = await requireSuperadmin();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Usuário não encontrado." };
  if (user.role === "SUPERADMIN") {
    return { ok: false, error: "Não é permitido personificar uma conta do admin." };
  }
  if (user.tenantId === session.user.tenantId) {
    return { ok: false, error: "Você já está na sua própria conta." };
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { status: true } });
  if (tenant?.status === "suspended") {
    return { ok: false, error: "Conta suspensa — reative-a antes de personificar." };
  }

  // Registrado ANTES de o cookie existir: com a personificação já ativa,
  // `resolveActor` marcaria o evento como feito dentro da conta do cliente, e
  // o log de "entrei como fulano" apareceria como se fosse do próprio fulano.
  await recordAudit({
    event: "admin.impersonated",
    target: { type: "User", id: user.id, label: user.email },
    meta: { email: user.email },
    tenantId: user.tenantId,
  });

  await setImpersonation({
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  });
  revalidatePath("/inicio");
  redirect("/inicio");
}

/** Encerra a personificação e volta ao painel do admin. */
export async function stopImpersonation() {
  await requireSuperadmin();

  await recordAudit({
    event: "admin.impersonation_ended",
    meta: { encerradoEm: new Date().toISOString() },
  });

  await clearImpersonation();
  revalidatePath("/admin/contas");
  redirect("/admin/contas");
}

/* ------------------------------------------------------------------ *
 * Trilha de auditoria.
 * ------------------------------------------------------------------ */

export type RevertResultAction = { ok: boolean; error?: string; info?: string };

/**
 * Desfaz um evento da trilha (`/admin/logs`).
 *
 * A regra de quem pode e o que aceita undo mora em `modules/audit/revert.ts`,
 * não aqui: esta action só garante o papel e revalida as telas. Reverter é uma
 * escrita no banco a partir de um snapshot, e as checagens que a tornam segura
 * (whitelist de modelo e campo, evento já revertido, alvo inexistente) são as
 * mesmas quer venham da tela, quer venham de uma chamada direta.
 */
export async function revertAuditEvent(logId: string): Promise<RevertResultAction> {
  const session = await requireSuperadmin();

  const result = await revertAuditLog(logId, {
    id: session.user.id,
    email: session.user.email ?? null,
  });

  if (!result.ok) return { ok: false, error: result.error };

  // A reversão pode ter mexido em qualquer tela do produto — plano, agente,
  // documento, contato. Revalidar só /admin/logs deixaria o admin olhando um
  // painel de contas que ainda mostra o valor antigo.
  revalidatePath("/admin/logs");
  revalidatePath("/admin/contas");
  revalidatePath("/inicio");
  revalidatePath("/agentes");
  return { ok: true, info: result.info };
}

export type DeleteAuditResult = { ok: boolean; error?: string; info?: string };

/** Exclui uma entrada específica da trilha, apenas para superadmin. */
export async function deleteAuditEvent(logId: string): Promise<DeleteAuditResult> {
  await requireSuperadmin();

  if (typeof logId !== "string" || !logId.trim()) {
    return { ok: false, error: "Entrada de log inválida." };
  }

  const deleted = await deleteAuditLog(logId);
  if (!deleted) return { ok: false, error: "Esta entrada já não existe." };

  revalidatePath("/admin/logs");
  return { ok: true, info: "Entrada excluída." };
}

/* ------------------------------------------------------------------ *
 * Bloqueio de IP.
 * ------------------------------------------------------------------ */

export type IpBlockResult = { ok: boolean; error?: string; info?: string };

const blockIpSchema = z.object({
  // Sem validar formato de IP: o valor não é digitado, vem do próprio log, e
  // uma regex de IPv4 recusaria os IPv6 que o `x-forwarded-for` entrega de
  // verdade. O que importa é não ser vazio nem gigante.
  ip: z.string().trim().min(3, "IP inválido").max(64, "IP inválido"),
  reason: z
    .string()
    .trim()
    .min(3, "Diga por que está bloqueando")
    .max(280, "Motivo muito longo"),
  duration: z.string().trim().default("permanente"),
});

/**
 * Bloqueia um IP do login.
 *
 * O motivo é obrigatório de propósito: um bloqueio sem motivo é impossível de
 * revisar depois — quem encontra a linha meses adiante não tem como decidir se
 * ela ainda faz sentido, e acaba mantendo por medo ou removendo às cegas.
 */
export async function blockIpAddress(formData: FormData): Promise<IpBlockResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const session = await requireSuperadmin();

  const parsed = blockIpSchema.safeParse({
    ip: formData.get("ip"),
    reason: formData.get("reason"),
    duration: formData.get("duration") ?? "permanente",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { ip, reason, duration } = parsed.data;

  // O IP de quem está bloqueando. Trancar a si mesmo para fora do painel é um
  // erro sem caminho de volta pela interface: o próximo login já viria barrado,
  // e desbloquear exige justamente estar logado.
  const context = await requestContext();
  if (context.ip === ip) {
    return { ok: false, error: "Este é o seu próprio IP — você ficaria sem acesso ao painel." };
  }

  const activity = await ipActivity(ip);
  const block = await blockIp({
    ip,
    reason,
    duration,
    actor: { id: session.user.id, email: session.user.email ?? null },
    lastEmail: activity.lastEmail,
    attempts: activity.total,
  });

  await recordAudit({
    event: "admin.ip_blocked",
    target: { type: "BlockedIp", id: ip, label: ip },
    after: {
      ip,
      reason,
      expiresAt: block.expiresAt,
    },
    meta: {
      tentativas: activity.total,
      falhas: activity.failures,
      contasTentadas: activity.distinctEmails,
      ultimoEmail: activity.lastEmail,
    },
    // Bloqueio é da plataforma, não de uma conta: sem tenant, senão o evento
    // apareceria como se pertencesse à conta do admin que bloqueou.
    tenantId: null,
  });

  revalidatePath("/admin/logs");
  return {
    ok: true,
    info: block.expiresAt
      ? `IP bloqueado até ${block.expiresAt.toLocaleString("pt-BR")}.`
      : "IP bloqueado até você desbloquear.",
  };
}

/** Solta o IP. O evento fica na trilha — desbloquear não apaga o histórico. */
export async function unblockIpAddress(ip: string): Promise<IpBlockResult> {
  await requireSuperadmin();

  const removed = await unblockIp(ip);
  if (!removed) return { ok: false, error: "Este IP não está bloqueado." };

  await recordAudit({
    event: "admin.ip_unblocked",
    target: { type: "BlockedIp", id: ip, label: ip },
    before: { ip, reason: removed.reason },
    tenantId: null,
  });

  revalidatePath("/admin/logs");
  return { ok: true, info: "IP desbloqueado — o acesso volta a funcionar." };
}
