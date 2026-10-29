import { describe, expect, it } from "vitest";
import { extractEvolutionAdOrigin, extractMetaAdOrigin, parseAdCode } from "@/modules/whatsapp/ad-origin";
import { EvolutionProvider } from "@/modules/whatsapp/evolution";
import { parseMetaMessages } from "@/modules/whatsapp/meta-events";

/**
 * De qual anúncio o lead veio. O formato da Evolution é o conferido em produção
 * (29/10/2026): `contextInfo.externalAdReply` na mensagem do próprio lead, com a
 * saudação automática do WhatsApp Business em `greetingMessageBody`.
 */

const adReply = (overrides: Record<string, unknown> = {}) => ({
  sourceId: "120251508234490338",
  sourceUrl: "https://fb.me/8HzSTpw3s",
  sourceType: "ad",
  sourceApp: "facebook",
  ctwaClid: "AfhSecretClickId",
  greetingMessageBody: "Oi! Como podemos ajudar? [AD37 - Prótese Protocolo]",
  automatedGreetingMessageShown: true,
  thumbnail: "AAAA".repeat(500),
  ...overrides,
});

const contextInfo = (reply: Record<string, unknown> = adReply()) => ({
  externalAdReply: reply,
  conversionSource: "FB_Ads",
  entryPointConversionApp: "facebook",
  entryPointConversionSource: "ctwa_ad",
});

const evolutionPayload = (extra: Record<string, unknown> = {}, fromMe = false) => ({
  instance: "tenant_x",
  data: {
    key: { remoteJid: "5514998586900@s.whatsapp.net", fromMe, id: "ABC123" },
    pushName: "Contato",
    message: { conversation: "Olá! Tenho interesse e queria mais informações, por favor." },
    contextInfo: contextInfo(),
    ...extra,
  },
});

describe("parseAdCode", () => {
  it("lê código e nome do texto escrito pelo gestor de tráfego", () => {
    expect(parseAdCode("Oi! Como podemos ajudar? [AD28 - Prótese Protocolo]")).toEqual({ code: "AD28", name: "Prótese Protocolo" });
    expect(parseAdCode("[AD19 - O fim do copo d'água]")).toEqual({ code: "AD19", name: "O fim do copo d'água" });
    expect(parseAdCode("[ad 4 – Depoimento Emerson]")).toEqual({ code: "AD4", name: "Depoimento Emerson" });
  });

  it("aceita código sem nome e recusa o que não é código", () => {
    expect(parseAdCode("[AD27]")).toEqual({ code: "AD27", name: null });
    expect(parseAdCode("Oi! Como podemos ajudar?")).toBeNull();
    expect(parseAdCode("[Promoção - 10%]")).toBeNull();
    expect(parseAdCode(undefined)).toBeNull();
    expect(parseAdCode(42)).toBeNull();
  });
});

describe("extractEvolutionAdOrigin", () => {
  it("extrai id, código, nome, link e plataforma", () => {
    expect(extractEvolutionAdOrigin(evolutionPayload().data)).toEqual({
      sourceId: "120251508234490338",
      code: "AD37",
      name: "Prótese Protocolo",
      sourceUrl: "https://fb.me/8HzSTpw3s",
      platform: "facebook",
    });
  });

  it("nunca devolve o identificador do clique nem a miniatura", () => {
    const json = JSON.stringify(extractEvolutionAdOrigin(evolutionPayload().data));
    expect(json).not.toContain("AfhSecretClickId");
    expect(json).not.toContain("AAAA");
  });

  it("acha o anúncio também dentro de extendedTextMessage", () => {
    const data = {
      key: { remoteJid: "5514998586900@s.whatsapp.net", fromMe: false, id: "X" },
      message: { extendedTextMessage: { text: "oi", contextInfo: contextInfo() } },
    };
    expect(extractEvolutionAdOrigin(data)?.code).toBe("AD37");
  });

  it("guarda o id mesmo sem código na saudação", () => {
    const origin = extractEvolutionAdOrigin({ contextInfo: contextInfo(adReply({ greetingMessageBody: "Oi! Como podemos ajudar?" })) });
    expect(origin).toMatchObject({ sourceId: "120251508234490338", code: null, name: null });
  });

  it("ignora pré-visualização de link (externalAdReply que não é anúncio)", () => {
    const preview = { externalAdReply: { title: "Notícia", body: "Texto", sourceUrl: "https://exemplo.com", sourceType: "" } };
    expect(extractEvolutionAdOrigin({ contextInfo: preview })).toBeNull();
    expect(extractEvolutionAdOrigin({ message: { conversation: "oi" } })).toBeNull();
    expect(extractEvolutionAdOrigin(null)).toBeNull();
  });

  it("descarta id e link com cara de lixo", () => {
    const origin = extractEvolutionAdOrigin({
      contextInfo: contextInfo(adReply({ sourceId: "abc", sourceUrl: "javascript:alert(1)" })),
    });
    expect(origin).toMatchObject({ sourceId: null, sourceUrl: null, code: "AD37" });
  });
});

describe("parseWebhook da Evolution", () => {
  const provider = new EvolutionProvider();

  it("leva o anúncio da mensagem recebida", () => {
    const incoming = provider.parseWebhook(evolutionPayload());
    expect(incoming?.adOrigin).toMatchObject({ code: "AD37", sourceId: "120251508234490338" });
    expect(incoming?.fromPhone).toBe("5514998586900");
  });

  it("não atribui anúncio ao que a própria clínica enviou", () => {
    expect(provider.parseWebhook(evolutionPayload({}, true))?.adOrigin).toBeUndefined();
  });

  it("mensagem comum segue sem anúncio", () => {
    const payload = evolutionPayload({ contextInfo: undefined });
    expect(provider.parseWebhook(payload)?.adOrigin).toBeUndefined();
  });
});

describe("Meta", () => {
  it("lê o referral do anúncio", () => {
    expect(
      extractMetaAdOrigin({
        source_url: "https://fb.me/abc",
        source_id: "120251508234490338",
        source_type: "ad",
        headline: "[AD28 - Prótese Protocolo]",
        ctwa_clid: "segredo",
      }),
    ).toEqual({
      sourceId: "120251508234490338",
      code: "AD28",
      name: "Prótese Protocolo",
      sourceUrl: "https://fb.me/abc",
      platform: null,
    });
  });

  it("publicação (post) não é anúncio", () => {
    expect(extractMetaAdOrigin({ source_id: "120251508234490338", source_type: "post" })).toBeNull();
    expect(extractMetaAdOrigin(undefined)).toBeNull();
  });

  it("o webhook da Meta entrega o anúncio junto da mensagem", () => {
    const parsed = parseMetaMessages({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "111" },
        contacts: [{ wa_id: "5514998586900", profile: { name: "Contato" } }],
        messages: [{
          from: "5514998586900", id: "wamid.1", timestamp: "1761750000", type: "text",
          text: { body: "Olá! Tenho interesse." },
          referral: { source_id: "120251508234490338", source_type: "ad", headline: "[AD28 - Prótese Protocolo]", source_url: "https://fb.me/abc" },
        }],
      } }] }],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].adOrigin).toMatchObject({ code: "AD28", sourceId: "120251508234490338" });
  });
});
