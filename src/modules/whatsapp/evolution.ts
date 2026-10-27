import type {
  WhatsAppProvider,
  CreateInstanceResult,
  IncomingMessage,
  WhatsAppGroup,
  WhatsAppStatus,
} from "./provider";
import { reportedAudioSeconds } from "@/modules/voice/received-audio";

function isPhoneJid(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{8,15}@(s\.whatsapp\.net|c\.us)$/.test(value);
}

type EvolutionMessageContent = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  audioMessage?: { seconds?: unknown } | null;
  pttMessage?: { seconds?: unknown } | null;
  reactionMessage?: { text?: string; key?: { remoteJid?: string } };
  ephemeralMessage?: { message?: EvolutionMessageContent | null } | null;
};

function unwrapEphemeralMessage(message: EvolutionMessageContent | undefined) {
  // O temporizador do contato pode envolver texto/voz em vez de mudar o tipo
  // interno. Limite evita ciclos/profundidade arbitrária em payload inválido.
  for (let depth = 0; message?.ephemeralMessage && depth < 5; depth++) {
    message = message.ephemeralMessage.message ?? undefined;
  }
  return message?.ephemeralMessage ? undefined : message;
}

// Adapter da Evolution API (self-hosted). Docs variam por versão; os endpoints
// abaixo seguem a v2 (/instance/create, /instance/connect, /message/sendText).
export class EvolutionProvider implements WhatsAppProvider {
  readonly name = "evolution";
  private baseUrl = process.env.EVOLUTION_API_URL ?? "";
  private apiKey = process.env.EVOLUTION_API_KEY ?? "";

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private headers() {
    return { "Content-Type": "application/json", apikey: this.apiKey };
  }

  /** Monitoramento não pode ficar preso para sempre numa Evolution travada. */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit = {},
    timeoutMs = 10_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private instanceName(tenantId: string) {
    return `tenant_${tenantId}`;
  }

  /**
   * Webhook DA INSTÂNCIA — e não o global (`WEBHOOK_GLOBAL_*` no compose).
   *
   * O webhook do fechai recusa (401) tudo que não trouxer o header
   * `x-webhook-secret`, e o webhook GLOBAL da Evolution não sabe mandar header
   * nenhum: o tipo dela só tem URL, ENABLED e WEBHOOK_BY_EVENTS — `headers`
   * existe apenas na configuração por instância. Com o global ligado, portanto,
   * TODA mensagem recebida voltava 401; e 401 está na lista de status não
   * reentregáveis da Evolution (400, 401, 403, 404, 422), então a mensagem era
   * descartada em vez de reenfileirada. O resultado era o pior possível: número
   * "conectado" na tela e zero mensagem chegando, sem fila para recuperar.
   *
   * Devolve null quando falta URL ou segredo — aí a instância é criada sem
   * webhook (o app funciona, só não recebe), em vez de nascer apontando para
   * lugar nenhum ou entregando sem o header e tomando 401 em silêncio.
   */
  private webhookConfig() {
    const url = process.env.EVOLUTION_WEBHOOK_URL ?? "";
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET ?? "";
    if (!url || !secret) return null;
    return {
      enabled: true,
      url,
      headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
      byEvents: false,
      base64: false,
      // Só o que o app consome. A Evolution assume a lista INTEIRA de eventos
      // quando recebe um array vazio — e aí cada presença/typing de cada
      // contato vira uma request no nosso webhook.
      events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
    };
  }

  /**
   * A Evolution já perdeu URL/eventos/header do webhook depois de reiniciar,
   * mesmo mantendo a instância conectada. Antes de escrever de novo, compara a
   * configuração atual: o worker chama isto a cada minuto e uma escrita cega
   * transformaria monitoramento em carga desnecessária no banco que queremos
   * proteger.
   */
  private webhookMatches(
    current: unknown,
    expected: NonNullable<ReturnType<EvolutionProvider["webhookConfig"]>>,
  ): boolean {
    const envelope = current as { webhook?: unknown } | null;
    const value = (envelope?.webhook ?? current) as {
      enabled?: boolean;
      url?: string;
      headers?: Record<string, unknown> | null;
      events?: unknown;
    } | null;
    if (!value || value.enabled === false || value.url !== expected.url) return false;

    const secret = Object.entries(value.headers ?? {}).find(
      ([key]) => key.toLowerCase() === "x-webhook-secret",
    )?.[1];
    if (secret !== expected.headers["x-webhook-secret"]) return false;

    const events = Array.isArray(value.events) ? value.events : [];
    return expected.events.every((event) => events.includes(event));
  }

  async createInstance(tenantId: string): Promise<CreateInstanceResult> {
    const instanceName = this.instanceName(tenantId);
    const webhook = this.webhookConfig();
    const res = await fetch(`${this.baseUrl}/instance/create`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        // Webhook já no nascimento: instância criada é instância que entrega.
        ...(webhook ? { webhook } : {}),
      }),
    });
    // 403 = instância já existe; conectar nela em vez de tentar recriar.
    if (res.status === 403) {
      const { status, qrCode } = await this.getQrCode(instanceName);
      return { externalId: instanceName, status, qrCode };
    }
    if (!res.ok) throw new Error(`Evolution createInstance falhou (${res.status})`);
    const data = await res.json();
    const qrCode: string | undefined = data?.qrcode?.base64 ?? data?.qrcode?.code;
    return {
      externalId: instanceName,
      status: qrCode ? "pending_qr" : "disconnected",
      qrCode,
    };
  }

  async getQrCode(externalId: string): Promise<{ status: WhatsAppStatus; qrCode?: string }> {
    const res = await fetch(`${this.baseUrl}/instance/connect/${externalId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Evolution connect falhou (${res.status})`);
    const data = await res.json();
    const qrCode: string | undefined = data?.base64 ?? data?.qrcode?.base64;
    const connected = data?.instance?.state === "open" || data?.state === "open";
    return { status: connected ? "connected" : qrCode ? "pending_qr" : "disconnected", qrCode };
  }

  async getConnectionState(
    externalId: string,
  ): Promise<{ status: WhatsAppStatus; exists: boolean; reachable: boolean }> {
    // GET /instance/connectionState — só LÊ o estado. O `/instance/connect` do
    // `getQrCode` geraria um QR a cada chamada (ver a doc de
    // `getConnectionState` na interface).
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/instance/connectionState/${externalId}`, {
        headers: this.headers(),
      });
      // 404 = a instância não existe mais no provedor. Acontece quando ela é
      // apagada por fora (limpeza, recriação do container): o nosso banco
      // segue dizendo "connected" e a tela mente até alguém reconectar.
      if (res.status === 404) return { status: "disconnected", exists: false, reachable: true };
      if (!res.ok) return { status: "disconnected", exists: true, reachable: false };
      const data = (await res.json()) as { instance?: { state?: string }; state?: string };
      const state = data?.instance?.state ?? data?.state;
      return {
        status: state === "open" ? "connected" : state === "connecting" ? "pending_qr" : "disconnected",
        exists: true,
        reachable: true,
      };
    } catch {
      // Evolution fora do ar: `reachable: false` para o chamador não confundir
      // "não consegui perguntar" com "o número caiu" — e não alarmar o cliente
      // por um problema que é nosso.
      return { status: "disconnected", exists: true, reachable: false };
    }
  }

  async sendMessage(externalId: string, toPhone: string, text: string): Promise<string | null> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/message/sendText/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number: toPhone, text }),
    });
    if (!res.ok) throw new Error(`Evolution sendMessage falhou (${res.status})`);
    // A resposta traz o key.id da mensagem criada — usado pelo webhook para
    // não gravar duas vezes o que a própria instância enviou (fromMe).
    const data = (await res.json()) as { key?: { id?: string } };
    return data.key?.id ?? null;
  }

  async sendAudio(
    externalId: string,
    toPhone: string,
    audio: { base64: string; mime: string },
  ): Promise<string | null> {
    // `/message/sendWhatsAppAudio` (e não `sendMedia`) é o que produz uma
    // mensagem de VOZ: a Evolution converte para o opus/ogg do PTT e o WhatsApp
    // mostra a onda com play. `sendMedia` com o mesmo arquivo entregaria um
    // anexo de áudio — que toca, mas parece um documento na conversa.
    const res = await fetch(`${this.baseUrl}/message/sendWhatsAppAudio/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number: toPhone, audio: audio.base64 }),
    });
    if (!res.ok) {
      throw new Error(
        `Evolution sendWhatsAppAudio falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as { key?: { id?: string } };
    return data.key?.id ?? null;
  }

  async sendGroupMessage(externalId: string, groupId: string, text: string): Promise<string | null> {
    // O destino é exclusivamente um JID de grupo; nunca o telefone do lead.
    if (!/^\d[\d-]*@g\.us$/.test(groupId)) throw new Error("ID de grupo inválido.");
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/message/sendText/${externalId}`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ number: groupId, text }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Evolution sendText para grupo falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as { key?: { id?: string } };
    return data.key?.id ?? null;
  }

  async listGroups(externalId: string): Promise<WhatsAppGroup[]> {
    // `getParticipants=false` é obrigatório na v2 e deixa a resposta leve: com
    // participantes, uma conta com muitos grupos grandes demora dezenas de
    // segundos. O timeout maior que o padrão é pelo mesmo motivo.
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/group/fetchAllGroups/${externalId}?getParticipants=false`,
      { headers: this.headers() },
      20_000,
    );
    if (!res.ok) {
      throw new Error(
        `Evolution fetchAllGroups falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) throw new Error("Evolution fetchAllGroups devolveu uma resposta inesperada");

    return data
      .map((g: { id?: unknown; subject?: unknown; size?: unknown }) => ({
        id: typeof g?.id === "string" ? g.id : "",
        name: typeof g?.subject === "string" ? g.subject.trim() : "",
        size: typeof g?.size === "number" ? g.size : null,
      }))
      .filter((g) => g.id.endsWith("@g.us"))
      .map((g) => ({ ...g, name: g.name || g.id }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  async disconnect(externalId: string): Promise<void> {
    // DELETE, não POST: na Evolution v2 `logout` e `delete` são as duas únicas
    // rotas de instância registradas como DELETE (create/restart/setPresence são
    // POST, connect/connectionState/fetchInstances são GET). Com POST o Express
    // não acha handler para o caminho e cai no 404 genérico — que a tela exibia
    // como "Evolution logout falhou (404)", parecendo instância inexistente.
    const res = await fetch(`${this.baseUrl}/instance/logout/${externalId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Evolution logout falhou (${res.status})`);
  }

  async ensureWebhook(externalId: string): Promise<boolean> {
    const webhook = this.webhookConfig();
    if (!webhook) return false;

    // GET é deliberado: torna a checagem periódica barata e só grava quando a
    // configuração realmente sumiu ou mudou. Se esta rota falhar, tenta o SET
    // mesmo assim — reparar é mais importante que diagnosticar a leitura.
    try {
      const current = await this.fetchWithTimeout(`${this.baseUrl}/webhook/find/${externalId}`, {
        headers: this.headers(),
      });
      if (current.ok && this.webhookMatches(await current.json(), webhook)) return true;
    } catch {
      // Cai no POST abaixo.
    }

    const res = await this.fetchWithTimeout(`${this.baseUrl}/webhook/set/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ webhook }),
    });
    if (!res.ok) {
      throw new Error(
        `Evolution webhook/set falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    console.warn(`[evolution] webhook da instância ${externalId} foi reparado automaticamente`);
    return true;
  }

  async getMediaAsBase64(
    externalId: string,
    messageKeyId: string,
  ): Promise<{ base64: string; mime: string }> {
    // Endpoint oficial da v2 para extrair a mídia de uma mensagem recebida.
    // Precisa do id da mensagem (key.id) e de a mídia estar salva no banco —
    // os dois valem aqui (ver DATABASE_SAVE_DATA_NEW_MESSAGE no docker-compose).
    const res = await fetch(`${this.baseUrl}/chat/getBase64FromMediaMessage/${externalId}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message: { key: { id: messageKeyId } }, convertToMp4: false }),
    });
    if (!res.ok) throw new Error(`Evolution getBase64FromMediaMessage falhou (${res.status})`);
    const data = (await res.json()) as { base64?: string; mimetype?: string };
    if (!data.base64) throw new Error("Evolution não devolveu a mídia da mensagem");
    return { base64: data.base64, mime: data.mimetype ?? "audio/ogg" };
  }

  parseWebhook(payload: unknown): IncomingMessage | null {
    // Formato do evento messages.upsert da Evolution API.
    const p = payload as {
      instance?: string;
      data?: {
        key?: {
          remoteJid?: string;
          remoteJidAlt?: string;
          senderPn?: string;
          fromMe?: boolean;
          id?: string;
        };
        pushName?: string;
        message?: EvolutionMessageContent;
      };
    };
    const data = p?.data;
    // Sem data não dá para processar nada. `fromMe` agora DESCE até o webhook:
    // o dono respondendo pelo próprio WhatsApp é uma mensagem de ida, mas o
    // painel precisa dela no histórico — quem decide é a rota, que deduplica
    // pelo key.id contra o que o app já gravou ao enviar.
    if (!data) return null;

    const message = unwrapEphemeralMessage(data.message);

    // Reação (emoji sobreposta a uma mensagem) nunca dispara um turno nem entra
    // no histórico. O webhook usa `fromMe` para distinguir o comando rápido do
    // atendente (pausar o agente) de uma reação comum do cliente (ignorar).
    const reaction = message?.reactionMessage;
    const text =
      reaction?.text ??
      message?.conversation ??
      message?.extendedTextMessage?.text ??
      "";
    // Voz (pttMessage) e arquivo de áudio (audioMessage) têm a mesma forma,
    // inclusive a duração em `seconds`, que o relatório mensal soma.
    const audio = message?.audioMessage ?? message?.pttMessage;
    const hasAudio = Boolean(audio);
    const audioSeconds = hasAudio ? reportedAudioSeconds(audio?.seconds) : undefined;
    const jid = typeof data.key?.remoteJid === "string" ? data.key.remoteJid : "";
    const isGroup = jid.endsWith("@g.us");
    // O identificador @lid não é um telefone. Em chats privados a Evolution
    // pode trazer o número no JID alternativo. Em versões antigas, senderPn é
    // o telefone do remetente recebido; em mensagens fromMe pode ser o nosso.
    const phoneJid = jid.endsWith("@lid")
      ? [data.key?.remoteJidAlt, data.key?.fromMe ? null : data.key?.senderPn].find(isPhoneJid)
      : jid;
    // Sem telefone não há como associar a mensagem a um bloqueio nem responder
    // com segurança ao contato correto.
    const contactJid = isGroup ? jid : phoneJid;
    if (!contactJid || (!isGroup && !isPhoneJid(contactJid))) return null;
    const fromPhone = contactJid.split("@")[0];
    if ((!text && !hasAudio) || !fromPhone) return null;

    return {
      instanceExternalId: p.instance ?? "",
      fromPhone,
      // Em mensagens enviadas pela própria conta, pushName é o nome do
      // WhatsApp conectado, não o nome do destinatário.
      fromName: data.key?.fromMe ? undefined : data.pushName,
      text,
      // Grupos têm JID com sufixo @g.us (ex: 5511999999999-1615000000@g.us).
      isGroup,
      hasAudio,
      ...(audioSeconds ? { audioSeconds } : {}),
      messageKeyId: data.key?.id,
      isReaction: Boolean(reaction),
      isFromMe: Boolean(data.key?.fromMe),
    };
  }
}
