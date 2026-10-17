import { isEncryptionConfigured } from "@/lib/crypto";

/** Somente estes três valores públicos podem ir ao navegador. */
export type EmbeddedSignupPublicConfig = {
  appId: string;
  configId: string;
  version: string;
};

export function embeddedSignupConfig() {
  const appId = process.env.META_APP_ID?.trim() ?? "";
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() ?? "";
  const appSecret = process.env.META_APP_SECRET?.trim() ?? "";
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? "";
  let origin = "";
  try {
    const url = new URL(
      process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "",
    );
    if (url.protocol === "https:") origin = url.origin;
  } catch {
    /* Configuração incompleta: botão indisponível. */
  }
  const configuredVersion =
    process.env.META_GRAPH_API_VERSION?.trim() ?? "v26.0";
  const version = /^v\d+\.\d+$/.test(configuredVersion)
    ? configuredVersion
    : "v26.0";
  if (
    !/^\d{5,30}$/.test(appId) ||
    !/^\d{5,30}$/.test(configId) ||
    appSecret.length < 16 ||
    verifyToken.length < 32 ||
    !origin ||
    !isEncryptionConfigured()
  )
    return null;
  return {
    appId,
    configId,
    version,
    appSecret,
    verifyToken,
    origin,
    webhookUrl: `${origin}/api/webhooks/whatsapp/meta`,
  };
}

export function embeddedSignupPublicConfig(): EmbeddedSignupPublicConfig | null {
  const config = embeddedSignupConfig();
  return config
    ? {
        appId: config.appId,
        configId: config.configId,
        version: config.version,
      }
    : null;
}
