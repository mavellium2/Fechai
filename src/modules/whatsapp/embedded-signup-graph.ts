import { createHmac } from "node:crypto";
import type { SignupAssets } from "./embedded-signup-events";
import { embeddedSignupConfig } from "./embedded-signup-config";

export class SignupError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export function requireSignupConfig() {
  const config = embeddedSignupConfig();
  if (!config)
    throw new SignupError(
      "A conexão pela Meta precisa ser configurada pela equipe do Fechai.",
      503,
    );
  return config;
}
type Phone = {
  id: string;
  display_phone_number?: string;
  platform_type?: string;
  is_on_biz_app?: boolean;
  status?: string;
};

/** Não propaga corpo, URL ou exceção da Meta: podem conter credenciais. */
export async function signupGraph(
  path: string,
  token: string,
  body?: Record<string, unknown>,
) {
  const config = requireSignupConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
  url.searchParams.set(
    "appsecret_proof",
    createHmac("sha256", config.appSecret).update(token).digest("hex"),
  );
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error("graph");
    return data;
  } catch {
    throw new SignupError(
      "Não foi possível concluir a verificação com a Meta. Tente novamente.",
      502,
    );
  }
}

/** Código de 30 segundos: trocar assim que o callback chegar, antes do evento de sessão. */
export async function exchangeSignupCode(code: string): Promise<string> {
  const config = requireSignupConfig();
  const url = new URL(
    `https://graph.facebook.com/${config.version}/oauth/access_token`,
  );
  url.search = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
  }).toString();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json();
    if (
      !response.ok ||
      typeof data.access_token !== "string" ||
      data.access_token.length < 20
    )
      throw new Error("exchange");
    const token: string = data.access_token;
    const debugUrl = new URL(
      `https://graph.facebook.com/${config.version}/debug_token`,
    );
    debugUrl.searchParams.set("input_token", token);
    const debug = await fetch(debugUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${config.appId}|${config.appSecret}` },
    });
    const info = (await debug.json()).data;
    const required = [
      "whatsapp_business_management",
      "whatsapp_business_messaging",
    ];
    if (
      !debug.ok ||
      !info?.is_valid ||
      info.app_id !== config.appId ||
      !required.every(
        (scope) => Array.isArray(info.scopes) && info.scopes.includes(scope),
      )
    )
      throw new Error("permissions");
    return token;
  } catch {
    throw new SignupError(
      "A autorização não pôde ser validada. Recomece a conexão e permita o acesso ao WhatsApp.",
      422,
    );
  }
}

/** IDs do browser nunca bastam: o telefone precisa pertencer à WABA autorizada. */
export async function verifySignupAssets(
  token: string,
  assets: SignupAssets,
  expectedPhone?: string | null,
): Promise<Phone> {
  const wanted = assets.phoneNumberId || expectedPhone;
  let after: string | undefined;
  const phones: Phone[] = [];
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({
      fields: "id,display_phone_number",
      limit: "100",
    });
    if (after) query.set("after", after);
    const data = await signupGraph(
      `${assets.wabaId}/phone_numbers?${query}`,
      token,
    );
    if (!Array.isArray(data.data))
      throw new SignupError(
        "Não foi possível identificar o número autorizado.",
      );
    phones.push(...data.data);
    if (wanted && phones.some((p) => p.id === wanted)) break;
    if (!data.paging?.next) break;
    after = data.paging?.cursors?.after;
    if (!after)
      throw new SignupError(
        "Selecione um número específico na autorização da Meta.",
      );
  }
  const selected = wanted
    ? phones.find((p) => p.id === wanted)
    : phones.length === 1
      ? phones[0]
      : undefined;
  if (!selected || !/^\d{5,30}$/.test(selected.id))
    throw new SignupError(
      "O número escolhido não pertence à conta autorizada. Confira a seleção na Meta.",
    );
  const profile = (await signupGraph(
    `${selected.id}?fields=id,display_phone_number,platform_type,is_on_biz_app,status`,
    token,
  )) as Phone;
  if (
    profile.id !== selected.id ||
    profile.platform_type !== "CLOUD_API" ||
    profile.is_on_biz_app !== true ||
    profile.status !== "CONNECTED"
  ) {
    throw new SignupError(
      "A Meta ainda não confirmou a conexão deste número com a API. Conclua a confirmação no WhatsApp Business do celular e tente concluir novamente.",
      409,
    );
  }
  return profile;
}
