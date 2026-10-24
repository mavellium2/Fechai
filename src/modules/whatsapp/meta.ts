import { parseMetaMessages } from "./meta-events";
import type {
  CreateInstanceResult,
  IncomingMessage,
  WhatsAppProvider,
  WhatsAppStatus,
} from "./provider";
import {
  supportedTemplate,
  type BroadcastTemplate,
  type MetaTemplateRecord,
} from "@/modules/broadcasts/template";
import {
  managedTemplate,
  type ManagedTemplate,
  type MetaManagedTemplateRecord,
  type TemplatePayload,
} from "@/modules/broadcasts/template-draft";

/**
 * Credenciais de uma conta na WhatsApp Cloud API oficial.
 *
 * O token chega aqui já decifrado. Quem lê/grava o banco passa sempre por
 * `modules/whatsapp/meta-config.ts`; este adapter não conhece Prisma nem cifra.
 */
export type MetaCloudCredentials = {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string | null;
};

const DEFAULT_GRAPH_VERSION = "v26.0";

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
  };
};

function graphVersion(): string {
  const configured = (
    process.env.META_GRAPH_API_VERSION ?? DEFAULT_GRAPH_VERSION
  ).trim();
  return /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_VERSION;
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`;
}

async function metaError(label: string, res: Response): Promise<Error> {
  const raw = await res.text().catch(() => "");
  let detail = raw.slice(0, 300);
  try {
    const json = JSON.parse(raw) as MetaErrorBody;
    const code = json.error?.code ? ` (código ${json.error.code})` : "";
    detail = `${json.error?.message ?? detail}${code}`;
  } catch {
    // Corpo não JSON: a amostra limitada acima é mais útil que esconder tudo.
  }
  return new Error(
    `${label} falhou (${res.status})${detail ? `: ${detail}` : ""}`,
  );
}

/** Adapter da API oficial da Meta (WhatsApp Business Platform / Cloud API). */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta";

  constructor(private readonly credentials: MetaCloudCredentials) {}

  isConfigured(): boolean {
    return Boolean(
      this.credentials.phoneNumberId && this.credentials.accessToken,
    );
  }

  /** Templates aprovados no formato que Disparos e lembretes sabem enviar. */
  async listBroadcastTemplates(): Promise<BroadcastTemplate[]> {
    return this.listTemplates<MetaTemplateRecord, BroadcastTemplate>(
      "id,name,language,status,parameter_format,components",
      supportedTemplate,
    );
  }

  /** Todos os modelos da conta, inclusive em análise e recusados (`/disparos/modelos`). */
  async listManagedTemplates(): Promise<ManagedTemplate[]> {
    return this.listTemplates<MetaManagedTemplateRecord, ManagedTemplate>(
      "id,name,language,status,category,rejected_reason,components",
      managedTemplate,
    );
  }

  /**
   * Envia um modelo novo para a Meta analisar. A Meta responde na hora com o
   * status inicial (quase sempre `PENDING`) e decide depois. Recusa explícita
   * vira `MetaTemplateRejected` com uma frase para a tela; o corpo bruto da
   * resposta nunca sai daqui.
   */
  async createMessageTemplate(
    payload: TemplatePayload,
  ): Promise<{ id: string; status: string; category: string | null }> {
    const waba = this.requireWaba();
    const response = await fetch(graphUrl(`${waba}/message_templates`), {
      method: "POST",
      headers: this.headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as MetaErrorBody;
      throw new MetaTemplateRejected(templateErrorMessage(response.status, body));
    }
    const data = (await response.json()) as { id?: string; status?: string; category?: string };
    if (!data.id) throw new Error("A Meta não confirmou o identificador do modelo.");
    return { id: data.id, status: data.status ?? "PENDING", category: data.category ?? null };
  }

  private requireWaba(): string {
    const waba = this.credentials.businessAccountId;
    if (!waba)
      throw new Error(
        "Configure o ID da conta WhatsApp Business em Integrações.",
      );
    return waba;
  }

  /** Pagina usando cursor, nunca seguindo uma URL externa com nosso token. */
  private async listTemplates<Raw, Item>(
    fields: string,
    map: (raw: Raw) => Item | null,
  ): Promise<Item[]> {
    const waba = this.requireWaba();
    const templates: Item[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ fields, limit: "100" });
      if (after) query.set("after", after);
      const response = await fetch(
        `${graphUrl(`${waba}/message_templates`)}?${query}`,
        {
          headers: this.headers(false),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok)
        throw new Error(
          "Não foi possível consultar os templates na Meta. Confira as permissões do token em Integrações.",
        );
      const data = (await response.json()) as {
        data?: Raw[];
        paging?: { next?: string; cursors?: { after?: string } };
      };
      for (const raw of data.data ?? []) {
        const template = map(raw);
        if (template) templates.push(template);
      }
      if (!data.paging?.next) return templates;
      after = data.paging.cursors?.after;
      if (!after) break;
    }
    throw new Error(
      "A lista de templates é grande demais ou está incompleta. Revise os templates na Meta.",
    );
  }

  async sendBroadcastTemplate(
    toPhone: string,
    template: BroadcastTemplate,
    parameters: string[],
  ): Promise<string> {
    if (parameters.length !== template.parameterCount)
      throw new Error("Variáveis incompatíveis com o template.");
    const response = await fetch(
      graphUrl(`${this.credentials.phoneNumberId}/messages`),
      {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: toPhone,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language },
            ...(parameters.length
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: parameters.map((text) => ({
                        type: "text",
                        text,
                      })),
                    },
                  ],
                }
              : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      if (response.status >= 500)
        throw new Error("A Meta não confirmou o resultado do envio.");
      const data = (await response.json().catch(() => ({}))) as MetaErrorBody;
      // Não persistir corpo bruto: pode conter telefone, credencial ou conteúdo.
      throw new MetaBroadcastRejected(
        `A Meta recusou o envio (${response.status}${data.error?.code ? `, código ${data.error.code}` : ""}).`,
      );
    }
    const data = (await response.json()) as { messages?: { id?: string }[] };
    const id = data.messages?.[0]?.id;
    if (!id)
      throw new Error("A Meta não confirmou o identificador da mensagem.");
    return id;
  }

  private headers(json = true): HeadersInit {
    return {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  async createInstance(tenantId: string): Promise<CreateInstanceResult> {
    void tenantId;
    const state = await this.getConnectionState(this.credentials.phoneNumberId);
    if (!state.reachable || !state.exists || state.status !== "connected") {
      throw new Error("A Meta não confirmou o Phone Number ID com este token.");
    }
    return { externalId: this.credentials.phoneNumberId, status: "connected" };
  }

  /** A Cloud API não usa QR; esta chamada apenas revalida as credenciais. */
  async getQrCode(
    externalId: string,
  ): Promise<{ status: WhatsAppStatus; qrCode?: string }> {
    const state = await this.getConnectionState(externalId);
    return { status: state.status };
  }

  async getConnectionState(
    externalId: string,
  ): Promise<{ status: WhatsAppStatus; exists: boolean; reachable: boolean }> {
    try {
      const fields = "id,platform_type,status";
      const res = await fetch(
        `${graphUrl(externalId)}?fields=${encodeURIComponent(fields)}`,
        {
          headers: this.headers(false),
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (res.ok) {
        const data = await res.json() as { id?: string; platform_type?: string; status?: string };
        if (data.id !== externalId || !data.platform_type || !data.status)
          return { status: "disconnected", exists: true, reachable: false };
        return { status: data.platform_type === "CLOUD_API" && data.status === "CONNECTED" ? "connected" : "disconnected", exists: true, reachable: true };
      }
      // A Meta respondeu: rede está de pé, mas o id/token não dá acesso ao
      // número. Para o produto isto é desconectado (e não indisponibilidade).
      return {
        status: "disconnected",
        exists: res.status !== 404,
        reachable: true,
      };
    } catch {
      return { status: "disconnected", exists: true, reachable: false };
    }
  }

  async getPhoneProfile(externalId = this.credentials.phoneNumberId): Promise<{
    displayPhone: string | null;
    verifiedName: string | null;
  }> {
    const fields = "id,display_phone_number,verified_name,platform_type,status";
    const res = await fetch(
      `${graphUrl(externalId)}?fields=${encodeURIComponent(fields)}`,
      {
        headers: this.headers(false),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) throw await metaError("Meta Cloud API", res);
    const data = (await res.json()) as {
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      platform_type?: string;
      status?: string;
    };
    if (data.id !== externalId)
      throw new Error("A Meta devolveu um Phone Number ID diferente.");
    if (data.platform_type !== "CLOUD_API" || data.status !== "CONNECTED")
      throw new Error("O número ainda não está conectado à API oficial. Use a conexão pela Meta e confirme no WhatsApp Business do celular.");
    return {
      displayPhone: data.display_phone_number ?? null,
      verifiedName: data.verified_name ?? null,
    };
  }

  async sendMessage(
    externalId: string,
    toPhone: string,
    text: string,
  ): Promise<string | null> {
    const res = await fetch(graphUrl(`${externalId}/messages`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) throw await metaError("Meta sendMessage", res);
    const data = (await res.json()) as { messages?: { id?: string }[] };
    return data.messages?.[0]?.id ?? null;
  }

  /**
   * Lista interativa (`interactive.type = "list"`): corpo até 1024 caracteres,
   * botão até 20, no máximo 10 linhas com título de até 24. Só dentro das 24h
   * abertas pelo contato — fora disso a Meta exige template.
   */
  async sendRatingPrompt(
    externalId: string,
    toPhone: string,
    prompt: { body: string; button: string; rows: { id: string; title: string }[] },
  ): Promise<string | null> {
    const res = await fetch(graphUrl(`${externalId}/messages`), {
      method: "POST",
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: prompt.body.slice(0, 1024) },
          action: {
            button: prompt.button.slice(0, 20),
            sections: [
              {
                title: "Nota",
                rows: prompt.rows.slice(0, 10).map((r) => ({ id: r.id.slice(0, 200), title: r.title.slice(0, 24) })),
              },
            ],
          },
        },
      }),
    });
    if (!res.ok) throw await metaError("Meta sendRatingPrompt", res);
    const data = (await res.json()) as { messages?: { id?: string }[] };
    return data.messages?.[0]?.id ?? null;
  }

  async sendAudio(
    externalId: string,
    toPhone: string,
    audio: { base64: string; mime: string },
  ): Promise<string | null> {
    // A Cloud API envia mídia por id: primeiro sobe o OGG/Opus, depois
    // referencia o id no /messages. Não se usa URL temporária nem CDN pública.
    const bytes = Buffer.from(audio.base64, "base64");
    if (bytes.length === 0) throw new Error("Áudio vazio.");

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", audio.mime);
    form.append(
      "file",
      new Blob([bytes], { type: audio.mime }),
      "resposta.ogg",
    );

    const upload = await fetch(graphUrl(`${externalId}/media`), {
      method: "POST",
      headers: this.headers(false),
      body: form,
    });
    if (!upload.ok) throw await metaError("Meta uploadAudio", upload);
    const uploaded = (await upload.json()) as { id?: string };
    if (!uploaded.id)
      throw new Error("A Meta não devolveu o id do áudio enviado.");

    const res = await fetch(graphUrl(`${externalId}/messages`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,
        type: "audio",
        audio: { id: uploaded.id, voice: true },
      }),
    });
    if (!res.ok) throw await metaError("Meta sendAudio", res);
    const data = (await res.json()) as { messages?: { id?: string }[] };
    return data.messages?.[0]?.id ?? null;
  }

  /**
   * Não desregistra o número da Meta: isso removeria o telefone do WABA, uma
   * ação muito mais destrutiva que "desconectar do fechai". A action apenas
   * muda o estado local e o webhook passa a ignorar eventos desta conta.
   */
  async disconnect(externalId: string): Promise<void> {
    void externalId;
  }

  /** Inscreve o app no WABA quando o id foi informado. */
  async ensureWebhook(externalId: string): Promise<boolean> {
    void externalId;
    const wabaId = this.credentials.businessAccountId?.trim();
    if (!wabaId) return false;
    const res = await fetch(graphUrl(`${wabaId}/subscribed_apps`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw await metaError("Meta subscribed_apps", res);
    return true;
  }

  async getMediaAsBase64(
    externalId: string,
    mediaId: string,
  ): Promise<{ base64: string; mime: string }> {
    void externalId;
    const metadata = await fetch(graphUrl(mediaId), {
      headers: this.headers(false),
    });
    if (!metadata.ok) throw await metaError("Meta getMedia", metadata);
    const info = (await metadata.json()) as {
      url?: string;
      mime_type?: string;
    };
    if (!info.url)
      throw new Error("A Meta não devolveu a URL temporária da mídia.");

    // A URL temporária continua exigindo o mesmo bearer token.
    const media = await fetch(info.url, { headers: this.headers(false) });
    if (!media.ok) throw await metaError("Meta downloadMedia", media);
    const bytes = Buffer.from(await media.arrayBuffer());
    if (bytes.length === 0) throw new Error("A Meta devolveu uma mídia vazia.");
    return {
      base64: bytes.toString("base64"),
      mime:
        info.mime_type ??
        media.headers.get("content-type") ??
        "application/octet-stream",
    };
  }

  parseWebhook(payload: unknown): IncomingMessage | null {
    return parseMetaMessages(payload)[0] ?? null;
  }
}

/** Resposta negativa explícita; timeout/rede são resultado desconhecido. */
export class MetaBroadcastRejected extends Error {}

/** A Meta recusou criar o modelo; `message` já é a frase para a tela. */
export class MetaTemplateRejected extends Error {}

/**
 * A recusa da Meta em uma frase para a clínica. `error_user_msg` é escrito pela
 * Meta para o usuário final (vem no idioma da conta), então pode ir à tela —
 * curto e em uma linha. O resto da resposta (ids de rastreio, tipo, código cru)
 * fica de fora.
 */
export function templateErrorMessage(status: number, body: MetaErrorBody): string {
  if (status >= 500) return "A Meta não respondeu agora. Tente de novo em alguns minutos.";
  const error = body.error;
  if (error?.code === 190) return "O token da Meta expirou ou foi revogado. Atualize as credenciais em Integrações.";
  // Conta do WhatsApp sem autorização para gerir modelos: não é o texto, é a
  // conta. Nenhum ajuste no formulário resolve; só o suporte da Meta.
  if (error?.error_subcode === 2494160)
    return "A Meta não autoriza esta conta do WhatsApp a criar modelos. Peça a liberação ao suporte da Meta.";
  const fromMeta = error?.error_user_msg?.replace(/\s+/g, " ").trim();
  if (fromMeta && fromMeta.length <= 200) return fromMeta;
  return "A Meta recusou o modelo. Revise o nome e o texto e tente de novo.";
}
