"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { MetaCloudProvider } from "@/modules/whatsapp/meta";
import {
  getWhatsAppProviderForInstance,
  metaWebhookUrl,
  WHATSAPP_PROVIDER_SELECT,
} from "@/modules/whatsapp/meta-config";
import { isWhatsappProviderName, stampLegacyConversations } from "@/modules/whatsapp/instances";
import { closeWhatsappIncidents } from "@/modules/whatsapp/incidents";
import {
  MAX_BLOCKED_NUMBERS,
  canonicalPhone,
  formatBlockedPhone,
  isBlockablePhone,
} from "@/modules/whatsapp/blocklist";
import { deployTenantWidget, WIDGET_CONFIG_SELECT } from "@/lib/widget/deploy";
import { uploadToBunny } from "@/lib/bunny";
import { setCalendarFeature, type CalendarFeatureKey } from "@/modules/scheduling/features";
import { disconnectGoogleCalendar } from "@/modules/scheduling/google";
import {
  disconnectClinicorp,
  listClinicorpCategories,
  listClinicorpProfessionals,
  saveClinicorpCredentials,
  verifyClinicorpCredentials,
  testClinicorpConnection,
} from "@/modules/scheduling/clinicorp";
import { encryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { recordAudit, recordChange } from "@/modules/audit/log";

type ConnectResult = {
  ok: boolean;
  status?: string;
  qrCode?: string;
  error?: string;
};

export type MetaConnectResult = ConnectResult & {
  webhookUrl?: string;
  verifyToken?: string;
  displayPhone?: string | null;
  warning?: string;
};

const metaWhatsappSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Informe o Phone Number ID numérico."),
  businessAccountId: z.string().trim().regex(/^\d{5,30}$/, "Informe o WABA ID numérico."),
  accessToken: z.string().trim().min(20, "Informe o token de acesso permanente."),
  appSecret: z.string().trim().min(16, "Informe o App Secret da aplicação Meta."),
});

async function tenantCanUseMetaWhatsapp(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { metaWhatsappEnabled: true },
  });
  return tenant?.metaWhatsappEnabled === true;
}

const META_WHATSAPP_NOT_ENABLED =
  "A API oficial da Meta ainda não foi habilitada pelo administrador para esta conta.";

/**
 * A conexão de um provedor da conta. Cada provedor tem a sua linha
 * (`@@unique([tenantId, provider])`): a Evolution e a Meta ficam conectadas ao
 * mesmo tempo, e mexer numa nunca toca na outra.
 */
const instanceKey = (tenantId: string, provider: "evolution" | "meta") => ({
  tenantId_provider: { tenantId, provider },
});

/**
 * Salva, valida e ativa a WhatsApp Cloud API oficial para a conta. Não exige
 * desconectar a Evolution: os dois números atendem juntos, e o contato é
 * respondido pelo número em que escreveu (ver `modules/whatsapp/instances.ts`).
 */
export async function saveMetaWhatsapp(formData: FormData): Promise<MetaConnectResult> {
  const { tenantId } = await requireTenant();
  if (!(await tenantCanUseMetaWhatsapp(tenantId))) {
    return { ok: false, error: META_WHATSAPP_NOT_ENABLED };
  }
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error: "Falta a chave de criptografia no servidor. Configure ENCRYPTION_KEY antes de salvar credenciais.",
    };
  }

  const parsed = metaWhatsappSchema.safeParse({
    phoneNumberId: formData.get("phoneNumberId"),
    businessAccountId: formData.get("businessAccountId"),
    accessToken: formData.get("accessToken"),
    appSecret: formData.get("appSecret"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Credenciais inválidas." };
  }

  const { phoneNumberId, businessAccountId, accessToken, appSecret } = parsed.data;
  const current = await prisma.whatsappInstance.findUnique({
    where: instanceKey(tenantId, "meta"),
  });
  const provider = new MetaCloudProvider({ phoneNumberId, businessAccountId, accessToken });
  try {
    const profile = await provider.getPhoneProfile(phoneNumberId);
    const verifyToken = randomBytes(32).toString("base64url");
    let warning: string | undefined;
    try {
      await provider.ensureWebhook(phoneNumberId);
    } catch (err) {
      console.error("[whatsapp meta] não foi possível inscrever o app no WABA", err);
      warning =
        "As credenciais foram validadas, mas a inscrição automática no WABA falhou. " +
        "Confira se o token tem whatsapp_business_management e assine o campo messages no painel da Meta.";
    }

    const previous = current;
    // A segunda conexão da conta vai nascer: as conversas de antes ainda não
    // dizem por onde falaram, e a linha que já existe é a resposta certa.
    if (!previous) await stampLegacyConversations(tenantId);
    const row = await prisma.whatsappInstance.upsert({
      where: instanceKey(tenantId, "meta"),
      create: {
        tenantId,
        provider: "meta",
        status: "connected",
        externalId: phoneNumberId,
        metaPhoneNumberId: phoneNumberId,
        metaBusinessAccountId: businessAccountId,
        metaDisplayPhone: profile.displayPhone,
        metaAccessTokenEncrypted: encryptSecret(accessToken),
        metaAppSecretEncrypted: encryptSecret(appSecret),
        metaVerifyTokenEncrypted: encryptSecret(verifyToken),
      },
      update: {
        status: "connected",
        externalId: phoneNumberId,
        metaPhoneNumberId: phoneNumberId,
        metaBusinessAccountId: businessAccountId,
        metaDisplayPhone: profile.displayPhone,
        metaAccessTokenEncrypted: encryptSecret(accessToken),
        metaAppSecretEncrypted: encryptSecret(appSecret),
        metaVerifyTokenEncrypted: encryptSecret(verifyToken),
      },
    });

    if (previous?.status !== "connected") {
      await recordAudit({
        event: "whatsapp.connected",
        target: { type: "WhatsappInstance", id: row.id, label: "WhatsApp oficial" },
        before: { status: previous?.status ?? "disconnected", provider: "meta" },
        after: { status: "connected", provider: "meta" },
      });
    }

    revalidatePath("/integracoes");
    revalidatePath("/inicio");
    return {
      ok: true,
      status: "connected",
      webhookUrl: metaWebhookUrl(tenantId),
      verifyToken,
      displayPhone: profile.displayPhone,
      warning,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Não foi possível validar a conta na Meta.",
    };
  }
}

/** Revalida credenciais Meta preservadas depois de um disconnect local. */
export async function reconnectMetaWhatsapp(): Promise<MetaConnectResult> {
  const { tenantId } = await requireTenant();
  if (!(await tenantCanUseMetaWhatsapp(tenantId))) {
    return { ok: false, error: META_WHATSAPP_NOT_ENABLED };
  }
  const instance = await prisma.whatsappInstance.findUnique({
    where: instanceKey(tenantId, "meta"),
    select: { id: true, status: true, metaDisplayPhone: true, ...WHATSAPP_PROVIDER_SELECT },
  });
  if (!instance) {
    return { ok: false, error: "Configure primeiro a API oficial da Meta." };
  }
  const provider = getWhatsAppProviderForInstance(instance);
  if (!provider.isConfigured() || !(provider instanceof MetaCloudProvider)) {
    return { ok: false, error: "As credenciais salvas não puderam ser lidas. Configure novamente." };
  }

  try {
    const profile = await provider.getPhoneProfile(instance.metaPhoneNumberId ?? undefined);
    await provider.ensureWebhook(instance.externalId ?? "").catch((err) => {
      console.error("[whatsapp meta] falha ao reinscrever WABA", err);
    });
    await prisma.whatsappInstance.update({
      where: instanceKey(tenantId, "meta"),
      data: { status: "connected", externalId: instance.metaPhoneNumberId },
    });
    revalidatePath("/integracoes");
    revalidatePath("/inicio");
    return {
      ok: true,
      status: "connected",
      webhookUrl: metaWebhookUrl(tenantId),
      displayPhone: profile.displayPhone ?? instance.metaDisplayPhone,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Não foi possível reconectar com a Meta.",
    };
  }
}

export async function connectWhatsapp(): Promise<ConnectResult> {
  const { tenantId } = await requireTenant();
  const provider = getWhatsAppProvider("evolution");

  if (!provider.isConfigured()) {
    return { ok: false, error: "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)." };
  }

  try {
    const existing = await prisma.whatsappInstance.findUnique({
      where: instanceKey(tenantId, "evolution"),
    });

    // Instância que existe mas NÃO está conectada: desloga antes de pedir o QR.
    //
    // A Evolution conta os QRs que gera e, ao bater `QRCODE_LIMIT` (30 por
    // padrão), marca a sessão como `refused` e para de aceitar leitura — o
    // celular passa a responder "não foi possível conectar o dispositivo" em
    // TODA tentativa, por mais rápido que se escaneie. Esse contador só zera
    // com um logout de verdade, e o nosso estava quebrado (mandava POST numa
    // rota DELETE), então ele só subia. Pedir QR sobre uma sessão meia-morta
    // era empilhar código novo em cima do problema.
    //
    // Só quando NÃO está conectada: deslogar um número que está atendendo
    // derruba o atendimento para gerar um QR que ninguém pediu.
    //
    // A condição olha o estado VIVO, não `existing.status`: aquele campo é a
    // lembrança do dia da conexão e continua "connected" mesmo com a sessão
    // morta há dias. Guardar o logout atrás dele significava justamente pular
    // a limpeza no caso em que ela era necessária — e o contador de QR seguia
    // subindo até a instância recusar toda leitura.
    //
    // O `?.` e o catch cobrem provedor que não implemente a checagem: ela é um
    // upgrade do diagnóstico, e conectar o WhatsApp não pode depender dela —
    // sem QR a pessoa fica sem saída nenhuma nesta tela.
    const liveState = existing?.externalId
      ? await provider
          .getConnectionState?.(existing.externalId)
          .catch(() => null)
          .then((s) => s ?? null)
      : null;
    const realmenteConectado = liveState?.reachable === true && liveState.status === "connected";

    // Sem estado vivo (provedor sem a checagem, ou ela falhou), cai no
    // critério antigo — `status` do banco — em vez de decidir no escuro.
    const pulaLogout = liveState
      ? realmenteConectado || liveState.exists === false
      : existing?.status === "connected";

    if (existing?.externalId && !pulaLogout) {
      try {
        await provider.disconnect(existing.externalId);
      } catch (err) {
        // Sessão já limpa devolve erro, e isso é exatamente o estado que
        // queríamos — seguir para o QR é o certo. Falha real também não pode
        // travar aqui: sem QR a pessoa não tem o que fazer nesta tela.
        console.error("[whatsapp] logout antes de gerar QR falhou", err);
      }
    }

    // A instância pode ter sumido do provedor (apagada por fora, limpeza, ou
    // um container recriado) enquanto o nosso banco ainda diz "connected".
    // Nesse caso pedir QR para ela devolve 404 e a tela trava sem saída: o
    // botão "Conectar" falha justamente quando é a única coisa que resolveria.
    // Checar antes é barato e transforma o beco sem saída em criar de novo.
    let externalId = existing?.externalId ?? null;
    if (externalId && liveState?.reachable && !liveState.exists) {
      console.warn(`[whatsapp] instância ${externalId} não existe mais — recriando`);
      externalId = null;
    }

    // Instância já criada: só atualiza o QR. Recriar com o mesmo nome devolve
    // 403 da Evolution (instância em uso) e quebrava a tela na 2ª visita.
    const res = externalId
      ? { externalId, ...(await provider.getQrCode(externalId)) }
      : await provider.createInstance(tenantId);

    // Reaponta o webhook a cada conexão, não só ao criar: instâncias criadas
    // antes desta correção ficaram penduradas no webhook global (sem o header
    // de segredo), e a URL pública do app pode ter mudado desde então. É barato
    // e idempotente. NÃO derruba a conexão se falhar: o número conectado é o
    // que o cliente veio buscar aqui; webhook quebrado é problema do próximo
    // passo, e o script `whatsapp:webhooks` conserta em lote.
    try {
      await provider.ensureWebhook(res.externalId);
    } catch (err) {
      console.error("[whatsapp] falha ao configurar webhook da instância", err);
    }

    // Conta que só tinha a Meta ganha a segunda conexão agora: as conversas de
    // antes ainda não dizem por onde falaram (ver `stampLegacyConversations`).
    if (!existing) await stampLegacyConversations(tenantId);
    await prisma.whatsappInstance.upsert({
      where: instanceKey(tenantId, "evolution"),
      create: { tenantId, provider: "evolution", externalId: res.externalId, status: res.status },
      update: { externalId: res.externalId, status: res.status },
    });
    revalidatePath("/integracoes");
    revalidatePath("/inicio");
    return { ok: true, status: res.status, qrCode: res.qrCode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao conectar" };
  }
}

export async function refreshWhatsappStatus(): Promise<ConnectResult> {
  const { tenantId } = await requireTenant();
  // Só a linha da Evolution: a Meta não usa código QR e tem a sua própria.
  const instance = await prisma.whatsappInstance.findUnique({
    where: instanceKey(tenantId, "evolution"),
  });
  if (!instance?.externalId) return { ok: false, error: "Nenhuma instância criada ainda." };
  const provider = getWhatsAppProvider("evolution");
  if (!provider.isConfigured()) return { ok: false, error: "Evolution API não configurada." };

  try {
    const res = await provider.getQrCode(instance.externalId);
    await prisma.whatsappInstance.update({
      where: instanceKey(tenantId, "evolution"),
      data: { status: res.status },
    });

    // Só a TRANSIÇÃO para conectado vira evento. Esta função é chamada em
    // laço enquanto a tela espera o QR ser lido; registrar cada passagem
    // encheria a trilha de "ainda aguardando" a cada poucos segundos.
    if (res.status === "connected" && instance.status !== "connected") {
      await recordAudit({
        event: "whatsapp.connected",
        target: { type: "WhatsappInstance", id: instance.id, label: "WhatsApp" },
        before: { status: instance.status },
        after: { status: res.status },
      });
    }

    revalidatePath("/integracoes");
    revalidatePath("/inicio");
    return { ok: true, status: res.status, qrCode: res.qrCode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao atualizar" };
  }
}

type WhatsappControlResult = { ok: boolean; error?: string; info?: string };

/**
 * Desconecta UMA das conexões da conta e marca como desconectada no banco — a
 * outra segue atendendo. Alternativa ao "desligar" (que só cala o agente): aqui
 * o número inteiro sai — na Evolution, voltar exige novo QR. Se o provedor
 * falhar, retorna o erro sem marcar como desconectado (senão enganaríamos a
 * tela).
 *
 * O provedor vem da tela e é validado aqui: Server Action é um endpoint
 * público, e "qualquer string" cairia na conexão errada.
 */
export async function disconnectWhatsapp(requested: string): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  if (!isWhatsappProviderName(requested)) {
    return { ok: false, error: "Conexão de WhatsApp inválida." };
  }
  const instance = await prisma.whatsappInstance.findUnique({
    where: instanceKey(tenantId, requested),
  });
  if (!instance?.externalId) return { ok: false, error: "Nenhum número conectado." };
  const provider = getWhatsAppProviderForInstance(instance);
  if (!provider.isConfigured()) return { ok: false, error: "O provedor do WhatsApp não está configurado." };

  try {
    await provider.disconnect(instance.externalId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    console.error(`[whatsapp] falha ao desconectar no provedor ${provider.name}`, err);

    // A sessão já ter caído NÃO é erro para quem clicou: a pessoa queria o
    // número fora do ar, e ele está. Antes a tela devolvia o erro cru do
    // provedor ("Evolution logout falhou (404)"), que fala de uma API que o
    // dono da clínica não conhece e sugere que a ação falhou — quando na
    // verdade não havia nada para desligar. 404 = instância não existe mais,
    // 400/500 = o provedor acha que já está fechada. Nos três, o resultado
    // que o usuário pediu já é verdade: seguimos e marcamos desconectado.
    const jaEstavaFora = provider.name === "evolution" && /\((400|404|500)\)/.test(message);
    if (!jaEstavaFora) {
      return {
        ok: false,
        error:
          "Não foi possível desconectar agora. Tente de novo em alguns minutos — " +
          "se continuar, conecte o número de novo em \"Conectar outro número\".",
      };
    }
  }

  await prisma.whatsappInstance.update({
    where: instanceKey(tenantId, requested),
    data: { status: "disconnected" },
  });
  // Desligado pelo painel é decisão, não falha: uma queda em aberto termina aqui.
  await closeWhatsappIncidents(tenantId, requested);

  // Não revertível: religar o WhatsApp exige ler um QR code novo no aparelho,
  // e nenhum campo do banco faz isso. O evento registra o fato — a tela do
  // log não oferece desfazer para o que só o cliente consegue refazer.
  await recordAudit({
    event: "whatsapp.disconnected",
    target: {
      type: "WhatsappInstance",
      id: instance.id,
      label: requested === "meta" ? "WhatsApp oficial" : "WhatsApp",
    },
    before: { status: instance.status, provider: requested },
    after: { status: "disconnected", provider: requested },
  });

  revalidatePath("/integracoes");
  revalidatePath("/inicio");
  return {
    ok: true,
    info:
      provider.name === "meta"
        ? "WhatsApp oficial desconectado do fechai. As credenciais foram preservadas para reconectar."
        : "WhatsApp desconectado. Para voltar, gere um novo código.",
  };
}

/**
 * Pausa/retoma o agente que atende o WhatsApp (o principal, ou o mais antigo
 * se nenhum for marcado como principal). Espelha o `enabled` da página de
 * agentes — o mesmo campo que o `runAgentTurn` respeita para calar o bot.
 */
export async function setWhatsappAgentEnabled(enabled: boolean): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const agent = await prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
  if (!agent) return { ok: false, error: "Nenhum agente nesta conta." };

  await prisma.agent.update({ where: { id: agent.id }, data: { enabled } });
  revalidatePath("/integracoes");
  revalidatePath("/agentes");
  revalidatePath(`/agentes/${agent.id}`);
  revalidatePath("/inicio");
  return { ok: true, info: enabled ? `${agent.name} voltou a responder.` : `${agent.name} parou de responder.` };
}

/**
 * Liga/desliga o agente em UMA conexão. Desligado, o número só recebe: as
 * mensagens entram em Conversas para a equipe, sem resposta nem follow-up
 * automático — é o "Meta só para Disparos". A outra conexão não muda.
 */
export async function setWhatsappAgentReplies(
  requested: string,
  enabled: boolean,
): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  if (!isWhatsappProviderName(requested) || typeof enabled !== "boolean") {
    return { ok: false, error: "Conexão de WhatsApp inválida." };
  }
  if (requested === "meta" && !(await tenantCanUseMetaWhatsapp(tenantId))) {
    return { ok: false, error: META_WHATSAPP_NOT_ENABLED };
  }
  const updated = await prisma.whatsappInstance.updateMany({
    where: { tenantId, provider: requested },
    data: { agentReplies: enabled },
  });
  if (updated.count === 0) return { ok: false, error: "Esta conexão ainda não foi configurada." };

  revalidatePath("/integracoes");
  return {
    ok: true,
    info: enabled
      ? "O agente volta a responder quem escreve para este número."
      : "O agente não responde mais por este número. As mensagens continuam chegando em Conversas.",
  };
}

/** Configura se o agente ignora mensagens de grupos do WhatsApp. */
export async function setWhatsappIgnoreGroups(ignore: boolean): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  await prisma.tenant.update({ where: { id: tenantId }, data: { whatsappIgnoreGroups: ignore } });
  revalidatePath("/integracoes");
  return {
    ok: true,
    info: ignore ? "O agente ignora mensagens de grupos." : "O agente passa a responder em grupos.",
  };
}

/**
 * Bloqueia um número: o agente passa a ignorar tudo que vier dele.
 *
 * Guarda a forma canônica (`canonicalPhone`) e não o que foi digitado — é o
 * que permite casar com o JID que o WhatsApp entrega. Bloquear duas vezes o
 * mesmo número (digitado com e sem o 55, por exemplo) não é erro: cai na mesma
 * chave e a tela só confirma que já está lá.
 */
export async function blockWhatsappNumber(
  phone: string,
  label: string,
): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();

  if (!isBlockablePhone(phone)) {
    return { ok: false, error: "Número incompleto — informe DDD e o número." };
  }
  const canonical = canonicalPhone(phone);
  const trimmedLabel = label.trim().slice(0, 60);

  const existing = await prisma.whatsappBlockedNumber.findUnique({
    where: { tenantId_phone: { tenantId, phone: canonical } },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, info: `${formatBlockedPhone(canonical)} já estava bloqueado.` };
  }

  // Teto conferido só quando vai mesmo inserir: quem reenvia um número que já
  // está na lista não pode tomar "lista cheia" por uma linha que não criaria.
  const count = await prisma.whatsappBlockedNumber.count({ where: { tenantId } });
  if (count >= MAX_BLOCKED_NUMBERS) {
    return {
      ok: false,
      error: `Limite de ${MAX_BLOCKED_NUMBERS} números bloqueados. Para calar o agente em massa, pause o agente ou ignore grupos.`,
    };
  }

  await prisma.whatsappBlockedNumber.create({
    data: { tenantId, phone: canonical, label: trimmedLabel || null },
  });

  revalidatePath("/integracoes");
  return { ok: true, info: `${formatBlockedPhone(canonical)} bloqueado. O agente vai ignorá-lo.` };
}

/** Desbloqueia (remove da lista). O histórico anterior ao bloqueio continua
 *  em Conversas — bloquear nunca apagou nada. */
export async function unblockWhatsappNumber(id: string): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();

  // deleteMany com o tenantId no where: um id de outra conta apaga 0 linhas em
  // vez de apagar a linha alheia.
  const { count } = await prisma.whatsappBlockedNumber.deleteMany({ where: { id, tenantId } });
  if (!count) return { ok: false, error: "Esse número não está na lista." };

  revalidatePath("/integracoes");
  return { ok: true, info: "Número desbloqueado. O agente volta a responder." };
}

// --------------------------------------------------------- widget do site

type WidgetConfigResult = { ok: boolean; error?: string; info?: string };

const MAX_ICON_BYTES = 5 * 1024 * 1024;

const widgetConfigSchema = z.object({
  widgetColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida — use o seletor ao lado."),
  widgetGreeting: z.string().trim().min(1, "Escreva uma saudação").max(200, "Saudação muito longa"),
  widgetIconType: z.enum(["emoji", "image"], { message: "Tipo de ícone inválido" }),
  widgetIconEmoji: z.string().trim().min(1, "Escolha um emoji").max(8, "Use só um emoji"),
  widgetShape: z.enum(["circle", "rounded", "square"], { message: "Formato inválido" }),
  widgetBorderColor: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^#[0-9a-fA-F]{6}$/.test(v), "Cor de borda inválida"),
});

/**
 * Salva a personalização do widget (cor, saudação, ícone, formato, borda) e
 * republica o widget.js daquele tenant na CDN com os novos valores já
 * embutidos — automático, sem comando manual. O snippet no site do cliente
 * não muda.
 */
export async function updateWidgetConfig(
  _prev: WidgetConfigResult | null,
  formData: FormData,
): Promise<WidgetConfigResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();

  const currentTenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { widgetEnabled: true },
  });

  const parsed = widgetConfigSchema.safeParse({
    widgetColor: formData.get("widgetColor"),
    widgetGreeting: formData.get("widgetGreeting"),
    widgetIconType: formData.get("widgetIconType"),
    widgetIconEmoji: formData.get("widgetIconEmoji"),
    widgetShape: formData.get("widgetShape"),
    widgetBorderColor: formData.get("widgetBorderColor"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  let widgetIconUrl: string | null = null;
  if (parsed.data.widgetIconType === "image") {
    const iconImage = formData.get("widgetIconImage");
    if (iconImage instanceof File && iconImage.size > 0) {
      if (iconImage.size > MAX_ICON_BYTES) {
        return { ok: false, error: "Imagem do ícone muito grande. O máximo é 5MB." };
      }
      const safeName = iconImage.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const uploaded = await uploadToBunny(
        `widget-icons/${tenantId}/${Date.now()}-${safeName}`,
        Buffer.from(await iconImage.arrayBuffer()),
        iconImage.type || "application/octet-stream",
      );
      if (!uploaded.ok) {
        return { ok: false, error: `Falha ao enviar ícone: ${uploaded.error}` };
      }
      widgetIconUrl = uploaded.url;
    } else {
      // Sem arquivo novo: mantém o ícone já salvo, se houver.
      const current = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { widgetIconUrl: true },
      });
      widgetIconUrl = current?.widgetIconUrl ?? null;
      if (!widgetIconUrl) return { ok: false, error: "Envie uma imagem para o ícone." };
    }
  }

  const deployed = await deployTenantWidget({
    tenantId,
    enabled: currentTenant?.widgetEnabled ?? false,
    color: parsed.data.widgetColor,
    greeting: parsed.data.widgetGreeting,
    iconType: parsed.data.widgetIconType,
    iconEmoji: parsed.data.widgetIconEmoji,
    iconUrl: widgetIconUrl,
    shape: parsed.data.widgetShape,
    borderColor: parsed.data.widgetBorderColor,
  });
  if (!deployed.ok) {
    return { ok: false, error: `Não consegui publicar o widget na CDN: ${deployed.error}` };
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      widgetColor: parsed.data.widgetColor,
      widgetGreeting: parsed.data.widgetGreeting,
      widgetIconType: parsed.data.widgetIconType,
      widgetIconEmoji: parsed.data.widgetIconEmoji,
      widgetIconUrl,
      widgetShape: parsed.data.widgetShape,
      widgetBorderColor: parsed.data.widgetBorderColor,
      widgetDeployedAt: new Date(),
    },
  });
  revalidatePath("/integracoes");
  return { ok: true, info: "Personalização salva e publicada." };
}

/**
 * Liga/desliga o botão no site do cliente. Por padrão ele nasce desativado
 * (`widgetEnabled = false`): colar o snippet só instala o script, e o botão
 * só aparece depois deste comando — republica o widget.js com a flag nova
 * embutida, sem mudar nada no site do cliente.
 */
export async function setWidgetEnabled(enabled: boolean): Promise<WidgetConfigResult> {
  const { tenantId } = await requireTenant();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ...WIDGET_CONFIG_SELECT, widgetDeployedAt: true },
  });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };

  const deployed = await deployTenantWidget({
    tenantId,
    enabled,
    color: tenant.widgetColor,
    greeting: tenant.widgetGreeting,
    iconType: tenant.widgetIconType,
    iconEmoji: tenant.widgetIconEmoji,
    iconUrl: tenant.widgetIconUrl,
    shape: tenant.widgetShape,
    borderColor: tenant.widgetBorderColor,
  });
  if (!deployed.ok) {
    return { ok: false, error: `Não consegui publicar o widget na CDN: ${deployed.error}` };
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { widgetEnabled: enabled, widgetDeployedAt: new Date() },
  });
  revalidatePath("/integracoes");
  return { ok: true, info: enabled ? "O botão agora aparece no seu site." : "O botão foi desativado no seu site." };
}

/**
 * Habilita ou desabilita um calendário.
 *
 * Só a decisão "quero usar isso": as credenciais e a configuração ficam na
 * /agenda, e desabilitar aqui **não** as apaga (isso é desconectar, lá). Quem
 * desliga por uma semana reencontra tudo ao religar.
 */
export async function setCalendarFeatureAction(
  key: CalendarFeatureKey,
  enabled: boolean,
): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();

  const before = await prisma.calendarFeatures.findUnique({
    where: { tenantId },
    select: { id: true, googleEnabled: true, clinicorpEnabled: true },
  });

  await setCalendarFeature(tenantId, key, enabled);

  const field = key === "google" ? "googleEnabled" : "clinicorpEnabled";
  const saved = await prisma.calendarFeatures.findUnique({
    where: { tenantId },
    select: { id: true },
  });

  await recordChange({
    event: "integration.toggled",
    target: { type: "CalendarFeatures", id: saved?.id ?? tenantId, label: `Calendário · ${key}` },
    before: { [field]: before?.[field] ?? false },
    after: { [field]: enabled },
    meta: { calendario: key },
  });

  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return {
    ok: true,
    info: enabled ? "Calendário habilitado. Configure na Agenda." : "Calendário desabilitado.",
  };
}

// --- Calendários: Google e Clinicorp --------------------------------------

/** Desliga o espelhamento sem desfazer a autorização do Google. */
export async function setGoogleSyncEnabled(enabled: boolean): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const { count } = await prisma.calendarIntegration.updateMany({
    where: { tenantId },
    data: { syncEnabled: enabled },
  });
  if (count === 0) return { ok: false, error: "Google Agenda não está conectado." };
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function disconnectGoogleAction(): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  await disconnectGoogleCalendar(tenantId);

  // Desconectar apaga os tokens do OAuth: reconectar exige o consentimento do
  // cliente de novo, e nenhum campo guardado desfaz isso. Fato, não estado.
  await recordAudit({
    event: "integration.removed",
    target: { type: "CalendarIntegration", id: tenantId, label: "Google Agenda" },
  });

  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Google Agenda desconectado." };
}

// --- Clinicorp ------------------------------------------------------------

const clinicorpSchema = z.object({
  apiUser: z.string().trim().min(1, "Informe o usuário da API"),
  apiToken: z.string().trim().min(1, "Informe o token da API"),
  subscriberId: z.string().trim().min(1, "Informe o id do assinante"),
});

/**
 * Conecta a conta ao Clinicorp.
 *
 * As credenciais só são gravadas depois de a API aceitá-las: colar um token
 * errado e só descobrir dias depois, quando um agendamento não chegou na
 * clínica, seria o pior jeito de errar. A mesma chamada devolve as clínicas do
 * assinante, e quando só existe uma ela já fica escolhida — a maioria das
 * contas não é franquia e não deveria ter que escolher nada.
 */
export async function connectClinicorpAction(
  _prev: WhatsappControlResult | null,
  formData: FormData,
): Promise<WhatsappControlResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const parsed = clinicorpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Sem chave de criptografia não se guarda credencial de cliente em texto
  // claro: recusa com uma mensagem útil em vez de deixar `encryptSecret` lançar.
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error: "Integração indisponível nesta instalação — falta a chave de criptografia no servidor.",
    };
  }

  const check = await verifyClinicorpCredentials(parsed.data);
  if (!check.ok) return { ok: false, error: check.error };

  // Uma clínica só: já fica escolhida. A maioria das contas não é franquia e não
  // deveria ter que escolher nada.
  const onlyBusiness = check.businesses.length === 1 ? check.businesses[0].id : null;

  await saveClinicorpCredentials(tenantId, parsed.data, { businessId: onlyBusiness });

  // A credencial em si NUNCA entra no log — nem cifrada. O que a trilha
  // registra é que a conta passou a ter uma integração ativa e para qual
  // clínica, que é o que responde "por que os agendamentos foram para lá?".
  await recordAudit({
    event: "integration.saved",
    target: { type: "ClinicorpIntegration", id: tenantId, label: "Clinicorp" },
    after: { businessId: onlyBusiness, clinicas: check.businesses.length },
  });

  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Clinicorp conectado." };
}

const clinicorpSettingsSchema = z.object({
  businessId: z.string().trim().regex(/^\d+$/, "Escolha a clínica que receberá os horários."),
  dentistId: z.string().trim().regex(/^\d*$/, "Profissional inválido."),
  categoryDescription: z.string().trim().max(120),
});

export async function saveClinicorpSettingsAction(
  _prev: WhatsappControlResult | null,
  formData: FormData,
): Promise<WhatsappControlResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const parsed = clinicorpSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  if (parsed.data.categoryDescription) {
    const categories = await listClinicorpCategories(tenantId);
    if (!categories.ok) return { ok: false, error: categories.error };
    if (categories.data.filter((c) => c.name === parsed.data.categoryDescription).length !== 1) {
      return { ok: false, error: "Escolha uma categoria existente com nome único no Clinicorp." };
    }
  }

  const { count } = await prisma.clinicorpIntegration.updateMany({
    where: { tenantId },
    data: {
      businessId: parsed.data.businessId || null,
      dentistId: parsed.data.dentistId || null,
      categoryDescription: parsed.data.categoryDescription || null,
    },
  });
  if (count === 0) return { ok: false, error: "Clinicorp não está conectado." };

  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Preferências salvas." };
}

/** Espelhar novos horários e ler a agenda de lá são dois botões separados. */
export async function setClinicorpToggle(
  field: "syncEnabled" | "checkAvailability",
  enabled: boolean,
): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const { count } = await prisma.clinicorpIntegration.updateMany({
    where: { tenantId },
    data: { [field]: enabled },
  });
  if (count === 0) return { ok: false, error: "Clinicorp não está conectado." };
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function disconnectClinicorpAction(): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  await disconnectClinicorp(tenantId);

  await recordAudit({
    event: "integration.removed",
    target: { type: "ClinicorpIntegration", id: tenantId, label: "Clinicorp" },
  });

  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Clinicorp desconectado." };
}

/** Profissionais para o seletor — buscado sob demanda, não a cada render. */
export async function loadClinicorpProfessionalsAction() {
  const { tenantId } = await requireTenant();
  return listClinicorpProfessionals(tenantId);
}

export async function loadClinicorpCategoriesAction() {
  const { tenantId } = await requireTenant();
  return listClinicorpCategories(tenantId);
}

export async function testClinicorpConnectionAction(): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const result = await testClinicorpConnection(tenantId);
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return result.ok ? { ok: true, info: result.data } : { ok: false, error: result.error };
}
