import { createHash, randomBytes } from "node:crypto";
import { Prisma, type WhatsappInstance } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { recordAudit } from "@/modules/audit/log";
import {
  exchangeSignupCode,
  requireSignupConfig,
  signupGraph,
  SignupError,
  verifySignupAssets,
} from "./embedded-signup-graph";
import type { SignupAssets } from "./embedded-signup-events";
import { syncForOnboarding, type CoexistenceSync } from "./coexistence-sync";

export type SignupActor = { tenantId: string; userId: string };
type Previous = {
  id: string;
  metaPhoneNumberId: string | null;
  metaBusinessAccountId: string | null;
  metaAccessTokenEncrypted: string | null;
};
type Attempt = SignupActor & {
  expires: number;
  configuration: string;
  previous: string;
  expectedPhone: string | null;
  expectedWaba: string | null;
  token?: string;
  exchanged?: boolean;
  completed?: SignupAssets;
};
const TTL = 15 * 60;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const previousFingerprint = (row: Previous | null) =>
  hash(
    JSON.stringify(
      row && [
        row.id,
        row.metaPhoneNumberId,
        row.metaBusinessAccountId,
        row.metaAccessTokenEncrypted,
      ],
    ),
  );
const configurationFingerprint = () => {
  const c = requireSignupConfig();
  return hash(
    JSON.stringify([c.appId, c.appSecret, c.configId, c.origin, c.verifyToken]),
  );
};
const keyFor = (id: string) => `meta-signup:${hash(id)}`;
const previousSelect = {
  id: true,
  metaPhoneNumberId: true,
  metaBusinessAccountId: true,
  metaAccessTokenEncrypted: true,
} as const;

/** Redis falha fechado; nunca trocar por memória local (há vários processos). */
export async function startEmbeddedSignup(actor: SignupActor) {
  requireSignupConfig();
  const previous = await prisma.whatsappInstance.findUnique({
    where: {
      tenantId_provider: { tenantId: actor.tenantId, provider: "meta" },
    },
    select: previousSelect,
  });
  const attemptId = randomBytes(32).toString("base64url");
  const attempt: Attempt = {
    ...actor,
    expires: Date.now() + TTL * 1000,
    configuration: configurationFingerprint(),
    previous: previousFingerprint(previous),
    expectedPhone: previous?.metaPhoneNumberId ?? null,
    expectedWaba: previous?.metaBusinessAccountId ?? null,
  };
  await redis.set(keyFor(attemptId), JSON.stringify(attempt), "EX", TTL);
  return { attemptId };
}

async function saveAttempt(id: string, attempt: Attempt) {
  const ttl = Math.ceil((attempt.expires - Date.now()) / 1000);
  if (ttl <= 0)
    throw new SignupError("Esta autorização expirou. Recomece a conexão.", 409);
  await redis.set(keyFor(id), JSON.stringify(attempt), "EX", ttl);
}

/** Lock cobre troca de código e conclusão; nonce não pode ser usado por outra sessão/conta. */
async function withAttempt<T>(
  actor: SignupActor,
  id: string,
  task: (attempt: Attempt) => Promise<T>,
): Promise<T> {
  const key = keyFor(id),
    lock = `${key}:lock`,
    owner = randomBytes(16).toString("hex");
  if (!(await redis.set(lock, owner, "EX", 420, "NX")))
    throw new SignupError(
      "Esta conexão já está sendo processada. Aguarde.",
      409,
    );
  try {
    const raw = await redis.get(key);
    const attempt = raw ? (JSON.parse(raw) as Attempt) : null;
    if (
      !attempt ||
      attempt.expires <= Date.now() ||
      attempt.tenantId !== actor.tenantId ||
      attempt.userId !== actor.userId ||
      attempt.configuration !== configurationFingerprint()
    ) {
      throw new SignupError(
        "Esta autorização expirou ou pertence a outra conta. Recomece a conexão.",
        409,
      );
    }
    return await task(attempt);
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lock,
      owner,
    );
  }
}

export async function authorizeEmbeddedSignup(
  actor: SignupActor,
  id: string,
  code: string,
) {
  return withAttempt(actor, id, async (attempt) => {
    if (attempt.exchanged)
      throw new SignupError(
        "Esta autorização já foi utilizada. Recomece a conexão.",
        409,
      );
    // Marcar antes da chamada: timeout não autoriza repetir um código de uso único.
    attempt.exchanged = true;
    await saveAttempt(id, attempt);
    const token = await exchangeSignupCode(code);
    attempt.token = encryptSecret(token);
    await saveAttempt(id, attempt);
  });
}

type SyncConnection = Pick<
  WhatsappInstance,
  "id" | "updatedAt" | "metaAccessTokenEncrypted"
>;
async function saveSyncCheckpoint(row: SyncConnection, sync: CoexistenceSync) {
  // Uma desconexão ou troca de credenciais no meio do fluxo vence a ativação.
  const saved = await prisma.whatsappInstance.update({
    where: {
      id: row.id,
      updatedAt: row.updatedAt,
      metaAccessTokenEncrypted: row.metaAccessTokenEncrypted,
      tenant: { status: "active", metaWhatsappEnabled: true },
    },
    data: { metaCoexistenceSync: sync as unknown as Prisma.InputJsonValue },
  });
  row.updatedAt = saved.updatedAt;
}

async function initiateSync(
  row: SyncConnection,
  token: string,
  sync: CoexistenceSync,
  step: "contacts" | "history",
) {
  if (sync[step]?.status === "requested") return;
  if (sync[step]?.status === "unknown")
    throw new SignupError(
      "A confirmação da sincronização está pendente. A equipe do Fechai precisa conferir o retorno da Meta antes de repetir essa etapa.",
      409,
    );
  // Esta API aceita uma solicitação por integração. Nunca repetir resultado incerto.
  sync[step] = { status: "unknown" };
  await saveSyncCheckpoint(row, sync);
  const result = await signupGraph(
    `${sync.phoneNumberId}/smb_app_data`,
    token,
    {
      messaging_product: "whatsapp",
      sync_type: step === "contacts" ? "smb_app_state_sync" : "history",
    },
  );
  if (typeof result.request_id !== "string" || !result.request_id)
    throw new SignupError(
      "A Meta não confirmou a solicitação de sincronização. Peça à equipe do Fechai para conferir a conexão.",
      502,
    );
  sync[step] = { status: "requested", requestId: result.request_id };
  await saveSyncCheckpoint(row, sync);
}

export async function finishEmbeddedSignup(
  actor: SignupActor,
  id: string,
  assets: SignupAssets,
) {
  return withAttempt(actor, id, async (attempt) => {
    if (attempt.completed) {
      const current = await prisma.whatsappInstance.findUnique({
        where: {
          tenantId_provider: { tenantId: actor.tenantId, provider: "meta" },
        },
        select: {
          status: true,
          metaBusinessAccountId: true,
          metaPhoneNumberId: true,
        },
      });
      if (
        current?.status !== "connected" ||
        current.metaBusinessAccountId !== assets.wabaId ||
        assets.wabaId !== attempt.completed.wabaId ||
        current.metaPhoneNumberId !== attempt.completed.phoneNumberId ||
        (assets.phoneNumberId &&
          assets.phoneNumberId !== attempt.completed.phoneNumberId)
      ) {
        throw new SignupError(
          "A conexão já foi concluída e depois alterada. Atualize a página.",
          409,
        );
      }
      return; // Resposta perdida no browser: não repetir inscrição nem sincronização.
    }
    const token = attempt.token ? decryptSecret(attempt.token) : null;
    if (!token)
      throw new SignupError(
        "A autorização da Meta não está disponível. Recomece a conexão.",
        409,
      );
    if (
      (attempt.expectedWaba && attempt.expectedWaba !== assets.wabaId) ||
      (attempt.expectedPhone &&
        assets.phoneNumberId &&
        attempt.expectedPhone !== assets.phoneNumberId)
    ) {
      throw new SignupError(
        "Você autorizou outra conta ou outro número. Recomece e escolha o WhatsApp já cadastrado no Fechai.",
      );
    }
    const phone = await verifySignupAssets(
      token,
      assets,
      attempt.expectedPhone,
    );
    const config = requireSignupConfig();
    // Serializa finalizações da conta e do número, inclusive entre usuários/processos.
    const owner = randomBytes(16).toString("hex");
    const locks = [
      `meta-signup:tenant:${actor.tenantId}`,
      `meta-signup:waba:${assets.wabaId}`,
      `meta-signup:phone:${phone.id}`,
    ];
    const acquired: string[] = [];
    try {
      for (const lock of locks) {
        if (!(await redis.set(lock, owner, "EX", 180, "NX")))
          throw new SignupError(
            "Outra conexão está sendo concluída. Aguarde e tente novamente.",
            409,
          );
        acquired.push(lock);
      }
      // Conferir antes de alterar qualquer assinatura no WABA.
      const current = await prisma.whatsappInstance.findUnique({
        where: {
          tenantId_provider: { tenantId: actor.tenantId, provider: "meta" },
        },
        select: previousSelect,
      });
      if (previousFingerprint(current) !== attempt.previous)
        throw new SignupError(
          "A conexão foi alterada em outra tela. Recomece para conferir os dados atuais.",
          409,
        );
      const collision = await prisma.whatsappInstance.findFirst({
        where: {
          provider: "meta",
          tenantId: { not: actor.tenantId },
          OR: [
            { metaPhoneNumberId: phone.id },
            { externalId: phone.id },
            { metaBusinessAccountId: assets.wabaId },
          ],
        },
        select: { id: true },
      });
      if (collision)
        throw new SignupError(
          "Esta conta do WhatsApp já está vinculada a outra conta do Fechai.",
          409,
        );

      const subscribed = await signupGraph(
        `${assets.wabaId}/subscribed_apps`,
        token,
        {
          override_callback_uri: config.webhookUrl,
          verify_token: config.verifyToken,
        },
      );
      if (subscribed.success !== true)
        throw new SignupError(
          "A Meta não confirmou o recebimento de mensagens. Tente concluir novamente.",
          502,
        );
      // Substituição por telefone tem precedência sobre a da WABA; alinhar as duas.
      const callback = await signupGraph(phone.id, token, {
        webhook_configuration: {
          override_callback_uri: config.webhookUrl,
          verify_token: config.verifyToken,
        },
      });
      if (callback.success !== true)
        throw new SignupError(
          "A Meta não confirmou o recebimento de mensagens deste número.",
          502,
        );

      const row = await prisma.$transaction(
        async (tx) => {
          const tenant = await tx.tenant.findUnique({
            where: { id: actor.tenantId },
            select: { status: true, metaWhatsappEnabled: true },
          });
          if (!tenant?.metaWhatsappEnabled || tenant.status !== "active")
            throw new SignupError(
              "A conexão oficial não está liberada para esta conta.",
              403,
            );
          const latest = await tx.whatsappInstance.findUnique({
            where: {
              tenantId_provider: { tenantId: actor.tenantId, provider: "meta" },
            },
          });
          if (previousFingerprint(latest) !== attempt.previous)
            throw new SignupError(
              "A conexão foi alterada. Recomece a autorização.",
              409,
            );
          const other = await tx.whatsappInstance.findFirst({
            where: {
              provider: "meta",
              tenantId: { not: actor.tenantId },
              OR: [
                { metaPhoneNumberId: phone.id },
                { externalId: phone.id },
                { metaBusinessAccountId: assets.wabaId },
              ],
            },
            select: { id: true },
          });
          if (other)
            throw new SignupError(
              "Esta conta do WhatsApp já está em uso no Fechai.",
              409,
            );
          if (!latest) {
            const channels = await tx.whatsappInstance.findMany({
              where: { tenantId: actor.tenantId },
              select: { provider: true },
            });
            if (channels.length === 1 && channels[0].provider === "evolution")
              await tx.conversation.updateMany({
                where: {
                  tenantId: actor.tenantId,
                  isTest: false,
                  whatsappProvider: null,
                  lead: { phone: { not: { startsWith: "web:" } } },
                },
                data: { whatsappProvider: "evolution" },
              });
          }
          const data = {
            status: "disconnected",
            externalId: phone.id,
            metaPhoneNumberId: phone.id,
            metaBusinessAccountId: assets.wabaId,
            metaDisplayPhone: phone.display_phone_number ?? null,
            metaAccessTokenEncrypted: encryptSecret(token),
            metaAppSecretEncrypted: encryptSecret(config.appSecret),
            // O segredo do callback compartilhado nunca é exposto no cartão de um tenant.
            metaVerifyTokenEncrypted:
              latest?.metaVerifyTokenEncrypted ??
              encryptSecret(randomBytes(32).toString("base64url")),
          };
          return tx.whatsappInstance.upsert({
            where: {
              tenantId_provider: { tenantId: actor.tenantId, provider: "meta" },
            },
            create: { tenantId: actor.tenantId, provider: "meta", ...data },
            update: data,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      attempt.previous = previousFingerprint(row);
      await saveAttempt(id, attempt);
      const sync = syncForOnboarding(row.metaCoexistenceSync, phone.id);
      await initiateSync(row, token, sync, "contacts");
      await initiateSync(row, token, sync, "history");
      // Uma liberação retirada no meio do fluxo também impede a ativação final.
      const activated = await prisma.whatsappInstance.updateMany({
        where: {
          id: row.id,
          updatedAt: row.updatedAt,
          metaAccessTokenEncrypted: row.metaAccessTokenEncrypted,
          tenant: { status: "active", metaWhatsappEnabled: true },
        },
        data: { status: "connected" },
      });
      if (!activated.count)
        throw new SignupError(
          "A conexão não está mais liberada. Atualize a página.",
          403,
        );
      attempt.token = undefined;
      attempt.completed = { wabaId: assets.wabaId, phoneNumberId: phone.id };
      await saveAttempt(id, attempt);
      await recordAudit({
        event: "whatsapp.connected",
        tenantId: actor.tenantId,
        target: {
          type: "WhatsappInstance",
          id: row.id,
          label: "WhatsApp oficial",
        },
        after: {
          status: "connected",
          provider: "meta",
          onboarding: "coexistence",
        },
      });
    } finally {
      for (const lock of acquired)
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lock,
          owner,
        );
    }
  });
}
