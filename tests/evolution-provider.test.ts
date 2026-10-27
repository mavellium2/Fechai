import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testes do adapter da Evolution API.
 *
 * Os dois casos aqui vêm de um incidente em produção em que a tela mostrava o
 * número "conectado" e nada funcionava:
 *
 * - `Evolution logout falhou (404)`: o desconectar mandava POST numa rota que
 *   a Evolution v2 registra como DELETE. O Express não acha handler e devolve
 *   o 404 genérico — que parece "instância não existe", e mandava a gente
 *   procurar o problema no lugar errado;
 * - "0 mensagens recebidas": as instâncias ficavam penduradas no webhook
 *   GLOBAL da Evolution, que não sabe mandar header. Como a nossa rota recusa
 *   (401) o que não trouxer `x-webhook-secret`, e 401 está na lista de status
 *   que a Evolution NÃO reentrega, toda mensagem era descartada em silêncio.
 *
 * Verbo e header são invisíveis em code review e só falham em produção. Por
 * isso estão travados aqui.
 */

const URL_BASE = "https://evo.example.test";
const CHAVE = "apikey-de-teste";
const SEGREDO = "segredo-do-webhook";
const WEBHOOK = "https://app.example.test/api/webhooks/whatsapp";

type Chamada = { url: string; init: RequestInit };

let chamadas: Chamada[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

/** Cria o provider já com o ambiente aplicado (os campos leem env no construtor). */
async function novoProvider() {
  const { EvolutionProvider } = await import("@/modules/whatsapp/evolution");
  return new EvolutionProvider();
}

function corpo(chamada: Chamada): Record<string, unknown> {
  return JSON.parse(String(chamada.init.body));
}

beforeEach(() => {
  vi.resetModules();
  process.env.EVOLUTION_API_URL = URL_BASE;
  process.env.EVOLUTION_API_KEY = CHAVE;
  process.env.EVOLUTION_WEBHOOK_URL = WEBHOOK;
  process.env.WHATSAPP_WEBHOOK_SECRET = SEGREDO;
  chamadas = [];
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ key: { id: "MSG1" } }),
      text: async () => "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Desconectar o número (disconnect)", () => {
  it("usa DELETE — POST cai no 404 genérico do Express", async () => {
    const provider = await novoProvider();
    await provider.disconnect("tenant_abc");

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${URL_BASE}/instance/logout/tenant_abc`);
    expect(chamadas[0].init.method).toBe("DELETE");
  });

  it("propaga a falha em vez de fingir que desconectou", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);
    const provider = await novoProvider();
    await expect(provider.disconnect("tenant_abc")).rejects.toThrow(/404/);
  });
});

describe("Webhook da instância", () => {
  it("manda o segredo no header — sem ele a nossa rota devolve 401", async () => {
    const provider = await novoProvider();
    const configurou = await provider.ensureWebhook("tenant_abc");

    expect(configurou).toBe(true);
    const escrita = chamadas.find((chamada) => chamada.init.method === "POST")!;
    expect(escrita.url).toBe(`${URL_BASE}/webhook/set/tenant_abc`);
    const webhook = corpo(escrita).webhook as Record<string, unknown>;
    expect(webhook.enabled).toBe(true);
    expect(webhook.url).toBe(WEBHOOK);
    expect(webhook.headers).toMatchObject({ "x-webhook-secret": SEGREDO });
  });

  it("assina só os eventos que o app consome", async () => {
    const provider = await novoProvider();
    await provider.ensureWebhook("tenant_abc");

    const escrita = chamadas.find((chamada) => chamada.init.method === "POST")!;
    const webhook = corpo(escrita).webhook as { events: string[] };
    // Lista vazia faz a Evolution assinar TODOS os eventos — aí cada "digitando"
    // de cada contato vira uma request na nossa rota.
    expect(webhook.events.length).toBeGreaterThan(0);
    expect(webhook.events).toContain("MESSAGES_UPSERT");
    expect(webhook.events).not.toContain("PRESENCE_UPDATE");
  });

  it("só lê quando o webhook já está saudável", async () => {
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          enabled: true,
          url: WEBHOOK,
          headers: { "X-Webhook-Secret": SEGREDO },
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
        }),
        text: async () => "",
      } as unknown as Response;
    });
    const provider = await novoProvider();

    expect(await provider.ensureWebhook("tenant_abc")).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${URL_BASE}/webhook/find/tenant_abc`);
    expect(chamadas[0].init.method).toBeUndefined();
  });

  it("repara automaticamente URL, eventos ou header perdidos", async () => {
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ enabled: true, url: "", headers: null, events: [] }),
        text: async () => "",
      } as unknown as Response;
    });
    const provider = await novoProvider();

    expect(await provider.ensureWebhook("tenant_abc")).toBe(true);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].url).toBe(`${URL_BASE}/webhook/set/tenant_abc`);
    expect(chamadas[1].init.method).toBe("POST");
  });

  it("a instância nova já nasce com o webhook configurado", async () => {
    const provider = await novoProvider();
    await provider.createInstance("abc");

    expect(chamadas[0].url).toBe(`${URL_BASE}/instance/create`);
    const webhook = corpo(chamadas[0]).webhook as Record<string, unknown>;
    expect(webhook.headers).toMatchObject({ "x-webhook-secret": SEGREDO });
  });

  it("sem segredo, não configura nada — melhor sem webhook que tomando 401 calado", async () => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    const provider = await novoProvider();

    expect(await provider.ensureWebhook("tenant_abc")).toBe(false);
    expect(chamadas).toHaveLength(0);

    await provider.createInstance("abc");
    expect(corpo(chamadas[0])).not.toHaveProperty("webhook");
  });

  it("sem URL de webhook, idem", async () => {
    delete process.env.EVOLUTION_WEBHOOK_URL;
    const provider = await novoProvider();
    expect(await provider.ensureWebhook("tenant_abc")).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});

describe("Telefone do contato no webhook", () => {
  function mensagem(key: {
    remoteJid: string;
    remoteJidAlt?: string;
    senderPn?: string;
    fromMe?: boolean;
  }) {
    return {
      instance: "tenant_abc",
      data: { key: { ...key, id: "MSG1" }, message: { conversation: "Oi" } },
    };
  }

  it("usa o telefone principal quando o JID já contém o número", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({
      remoteJid: "5511987654321@s.whatsapp.net",
      remoteJidAlt: "123456789012345@lid",
    }))).toMatchObject({ fromPhone: "5511987654321", isGroup: false });
  });

  it("usa o telefone alternativo quando a Evolution entrega um LID", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "5511987654321@s.whatsapp.net",
    }))).toMatchObject({ fromPhone: "5511987654321", isGroup: false });
  });

  it("também resolve mensagens enviadas à mão para um contato com LID", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "5511987654321@c.us",
      fromMe: true,
    }))).toMatchObject({ fromPhone: "5511987654321", isFromMe: true });
  });

  it("não atribui o nome do WhatsApp conectado ao destinatário", async () => {
    const provider = await novoProvider();
    const outbound = mensagem({ remoteJid: "5511987654321@s.whatsapp.net", fromMe: true });
    expect(provider.parseWebhook({ ...outbound, data: { ...outbound.data, pushName: "Vinicius Mota" } })).toMatchObject({
      fromPhone: "5511987654321",
      isFromMe: true,
      fromName: undefined,
    });

    const inbound = mensagem({ remoteJid: "5511987654321@s.whatsapp.net", fromMe: false });
    expect(provider.parseWebhook({ ...inbound, data: { ...inbound.data, pushName: "Maria" } })).toMatchObject({ fromName: "Maria" });
  });

  it("aceita senderPn de uma mensagem recebida quando falta JID alternativo", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({
      remoteJid: "123456789012345@lid",
      senderPn: "5511987654321@s.whatsapp.net",
      fromMe: false,
    }))).toMatchObject({ fromPhone: "5511987654321", isFromMe: false });
  });

  it("não confunde senderPn de mensagem fromMe com o telefone do contato", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({
      remoteJid: "123456789012345@lid",
      senderPn: "5511999999999@s.whatsapp.net",
      fromMe: true,
    }))).toBeNull();
  });

  it("ignora JID alternativo sem telefone e usa senderPn válido", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "invalido@s.whatsapp.net",
      senderPn: "5511987654321@s.whatsapp.net",
      fromMe: false,
    }))).toMatchObject({ fromPhone: "5511987654321" });
  });

  it("lê a duração do áudio informada pela Evolution", async () => {
    const provider = await novoProvider();
    const audio = (message: Record<string, unknown>) => ({ instance: "tenant_abc",
      data: { key: { remoteJid: "5511987654321@s.whatsapp.net", id: "AUD1" }, message } });
    expect(provider.parseWebhook(audio({ audioMessage: { seconds: 256, ptt: true } }))).toMatchObject({ hasAudio: true, audioSeconds: 256 });
    expect(provider.parseWebhook(audio({ pttMessage: { seconds: "288" } }))).toMatchObject({ hasAudio: true, audioSeconds: 288 });
    // Sem duração no payload: fica para a leitura do arquivo, nunca zero.
    expect(provider.parseWebhook(audio({ audioMessage: { seconds: 0 } }))).not.toHaveProperty("audioSeconds");
    expect(provider.parseWebhook(audio({ audioMessage: {} }))).not.toHaveProperty("audioSeconds");
  });

  it("não trata LID sem telefone alternativo como número de contato", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({ remoteJid: "123456789012345@lid" }))).toBeNull();
    expect(provider.parseWebhook(mensagem({
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "987654321012345@lid",
    }))).toBeNull();
  });

  it("preserva a identificação de grupos", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(mensagem({ remoteJid: "120363123456789@g.us" }))).toMatchObject({
      fromPhone: "120363123456789",
      isGroup: true,
    });
  });
});

describe("Mensagens temporárias da Evolution", () => {
  const event = (message: Record<string, unknown>, fromMe = false) => ({
    instance: "tenant_abc",
    data: {
      key: { remoteJid: "5511987654321@s.whatsapp.net", id: "TEMP1", fromMe },
      pushName: "Contato",
      message,
    },
  });
  const ephemeral = (message: Record<string, unknown>) => ({ ephemeralMessage: { message } });

  it("recebe texto temporário com anúncio sem confundir anúncio e fala do contato", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(event(ephemeral({ extendedTextMessage: {
      text: "Olá! Tenho interesse e queria mais informações, por favor.",
      contextInfo: { externalAdReply: { title: "Anúncio de teste" } },
    } })))).toMatchObject({
      instanceExternalId: "tenant_abc",
      fromPhone: "5511987654321",
      fromName: "Contato",
      messageKeyId: "TEMP1",
      text: "Olá! Tenho interesse e queria mais informações, por favor.",
      isFromMe: false,
      hasAudio: false,
    });
  });

  it("lê texto simples dentro de envelopes temporários aninhados", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(event(ephemeral(ephemeral({ conversation: "Oi" }))))).toMatchObject({ text: "Oi" });
  });

  it("preserva o áudio temporário e a duração medida", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(event(ephemeral({ audioMessage: { seconds: 18 } })))).toMatchObject({
      hasAudio: true, audioSeconds: 18, messageKeyId: "TEMP1",
    });
  });

  it("preserva a identificação do atendente e de reações", async () => {
    const provider = await novoProvider();
    expect(provider.parseWebhook(event(ephemeral({ reactionMessage: { text: "👍" } }), true))).toMatchObject({
      isReaction: true, isFromMe: true, fromName: undefined, text: "👍",
    });
  });

  it("ignora configuração, envelope vazio e texto apenas citado", async () => {
    const provider = await novoProvider();
    for (const message of [
      { ephemeralMessage: {} },
      { ephemeralMessage: { message: null } },
      ephemeral({ protocolMessage: { type: "EPHEMERAL_SETTING" } }),
      ephemeral({ extendedTextMessage: { contextInfo: { quotedMessage: { conversation: "Não é uma nova mensagem" } } } }),
    ]) {
      expect(provider.parseWebhook(event(message))).toBeNull();
    }
  });

  it("limita a profundidade e não trava com envelope cíclico", async () => {
    const provider = await novoProvider();
    let message: Record<string, unknown> = { conversation: "Oi" };
    for (let depth = 0; depth < 6; depth++) message = ephemeral(message);
    expect(provider.parseWebhook(event(message))).toBeNull();
    const cycle: Record<string, unknown> = {};
    cycle.ephemeralMessage = { message: cycle };
    expect(provider.parseWebhook(event(cycle))).toBeNull();
  });
});
