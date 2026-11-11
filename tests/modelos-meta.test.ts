import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bodyVariables,
  managedTemplate,
  templateName,
  templatePayload,
  templateStatusLabel,
  validateTemplateDraft,
} from "@/modules/broadcasts/template-draft";
import { supportedTemplate } from "@/modules/broadcasts/template";
import { MetaCloudProvider, MetaTemplateRejected, templateErrorMessage } from "@/modules/whatsapp/meta";

/**
 * Modelos criados pelo fechai (`/disparos/modelos`). Quem aprova é a Meta; o
 * que se trava aqui é o pedido sair no formato que ela aceita — e que, aprovado,
 * os Disparos e os lembretes conseguem usar (`supportedTemplate`).
 */

const BODY =
  "Olá {{1}}, tudo bem? Passando para lembrar da sua consulta em {{2}} às {{3}}. Até breve!";
const valid = (over: Record<string, unknown> = {}) =>
  validateTemplateDraft({
    name: "lembrete_consulta",
    category: "UTILITY",
    header: "",
    body: BODY,
    footer: "",
    examples: ["Maria", "16/10", "15:00"],
    ...over,
  });

describe("Nome do modelo", () => {
  it("converte o que a pessoa digitou no formato da Meta", () => {
    expect(templateName("Lembrete de Consulta!")).toBe("lembrete_de_consulta");
    expect(templateName("  Confirmação   amanhã ")).toBe("confirmacao_amanha");
    expect(templateName("***")).toBe("");
  });
});

describe("Validação do rascunho", () => {
  it("aceita um lembrete de utilidade com exemplos para cada variável", () => {
    const result = valid();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.examples).toEqual(["Maria", "16/10", "15:00"]);
  });

  it("exige um exemplo por variável", () => {
    const result = valid({ examples: ["Maria", ""] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.examples).toBeTruthy();
  });

  it("recusa variáveis fora de sequência", () => {
    const result = valid({ body: "Olá {{1}}, sua consulta é {{3}}, ok?", examples: ["a", "b"] });
    expect(!result.ok && result.errors.body).toMatch(/sequência/);
  });

  it("recusa corpo que começa ou termina com variável (regra da Meta)", () => {
    expect(!valid({ body: "{{1}}, sua consulta.", examples: ["a"] }).ok).toBe(true);
    expect(!valid({ body: "Sua consulta é {{1}}", examples: ["a"] }).ok).toBe(true);
  });

  it("recusa chaves soltas, categoria desconhecida e variável no rodapé", () => {
    expect(!valid({ body: "Olá {nome}}, tudo bem?", examples: [] }).ok).toBe(true);
    expect(!valid({ category: "AUTHENTICATION" }).ok).toBe(true);
    expect(!valid({ footer: "Equipe {{1}}" }).ok).toBe(true);
  });

  it("aceita texto sem variáveis e sem exemplos", () => {
    expect(valid({ body: "Sua consulta está confirmada. Até breve!", examples: [] }).ok).toBe(true);
  });
});

describe("Pedido enviado à Meta", () => {
  it("monta o corpo com idioma, categoria e exemplos aninhados", () => {
    const result = valid({ header: "Instituto do Sorriso", footer: "Não responda se já confirmou" });
    if (!result.ok) throw new Error("rascunho deveria ser válido");
    expect(templatePayload(result.draft)).toEqual({
      name: "lembrete_consulta",
      language: "pt_BR",
      category: "UTILITY",
      components: [
        { type: "HEADER", format: "TEXT", text: "Instituto do Sorriso" },
        { type: "BODY", text: BODY, example: { body_text: [["Maria", "16/10", "15:00"]] } },
        { type: "FOOTER", text: "Não responda se já confirmou" },
      ],
    });
  });

  it("aprovado, o modelo criado aqui serve para Disparos e lembretes", () => {
    const result = valid();
    if (!result.ok) throw new Error("rascunho deveria ser válido");
    const payload = templatePayload(result.draft);
    const approved = supportedTemplate({
      id: "t1",
      name: payload.name,
      language: payload.language,
      status: "APPROVED",
      components: payload.components,
    });
    expect(approved?.parameterCount).toBe(bodyVariables(BODY).length);
  });
});

describe("Recusa da Meta em uma frase", () => {
  it("conta sem autorização para modelos aponta o suporte, não o texto", () => {
    expect(
      templateErrorMessage(400, { error: { code: 100, error_subcode: 2494160, error_user_msg: "x" } }),
    ).toMatch(/suporte da Meta/);
  });

  it("usa a mensagem escrita pela Meta para o usuário quando é curta", () => {
    expect(
      templateErrorMessage(400, { error: { code: 100, error_user_msg: "Já existe um modelo com esse nome." } }),
    ).toBe("Já existe um modelo com esse nome.");
  });

  it("token revogado e falha da Meta têm frases próprias", () => {
    expect(templateErrorMessage(401, { error: { code: 190 } })).toMatch(/token/);
    expect(templateErrorMessage(503, {})).toMatch(/Tente de novo/);
  });

  it("referência de mídia recusada orienta reenviar o exemplo, sem pedir mudança no texto", () => {
    const message = templateErrorMessage(400, {
      error: {
        code: 131009,
        error_subcode: 2494102,
        error_user_msg: "Check the handle provided for the uploaded media in the request.",
      },
    });
    expect(message).toMatch(/arquivo de exemplo/);
    expect(message).not.toMatch(/handle|request|nome e o texto/);
  });
});

describe("Provider", () => {
  const provider = () =>
    new MetaCloudProvider({
      phoneNumberId: "1234567890",
      businessAccountId: "9876543210",
      accessToken: "token-de-teste",
    });

  beforeEach(() => {
    process.env.META_GRAPH_API_VERSION = "v26.0";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("cria o modelo no WABA e devolve o status inicial", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "tpl-1", status: "PENDING", category: "UTILITY" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = valid();
    if (!result.ok) throw new Error("rascunho deveria ser válido");

    await expect(provider().createMessageTemplate(templatePayload(result.draft))).resolves.toEqual({
      id: "tpl-1",
      status: "PENDING",
      category: "UTILITY",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/9876543210/message_templates");
    expect(init.method).toBe("POST");
  });

  it("recusa explícita vira MetaTemplateRejected sem o corpo bruto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: 100, error_subcode: 2494160, fbtrace_id: "rastreio-secreto" } }),
          { status: 400 },
        ),
      ),
    );
    const result = valid();
    if (!result.ok) throw new Error("rascunho deveria ser válido");
    const error = await provider()
      .createMessageTemplate(templatePayload(result.draft))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaTemplateRejected);
    expect((error as Error).message).toMatch(/suporte da Meta/);
    expect((error as Error).message).not.toMatch(/rastreio-secreto/);
  });

  it("lista inclusive modelos em análise e recusados, com o motivo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "a", name: "lembrete", language: "pt_BR", status: "PENDING", category: "UTILITY", components: [{ type: "BODY", text: "Oi" }] },
              { id: "b", name: "promo", language: "pt_BR", status: "REJECTED", category: "MARKETING", rejected_reason: "PROMOTIONAL" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const list = await provider().listManagedTemplates();
    expect(list.map((t) => [t.name, t.status, t.rejectedReason])).toEqual([
      ["lembrete", "PENDING", null],
      ["promo", "REJECTED", "PROMOTIONAL"],
    ]);
  });
});

describe("Upload do exemplo para aprovação", () => {
  const handle = "4::dmlkZW8vbXA0:ZXhlbXBsby5tcDQ=:assinatura";
  const sessionId = "upload:session-id?sig=assinatura-da-sessao";
  const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]);
  const provider = () => new MetaCloudProvider({
    phoneNumberId: "1234567890",
    businessAccountId: "9876543210",
    accessToken: "token-da-conta",
  });

  beforeEach(() => {
    vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    vi.stubEnv("META_APP_ID", "app-global");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["", "app-global-diferente"])(
    "usa o app do token, mesmo com META_APP_ID=%s, e preserva bytes e referência até o modelo",
    async (appId) => {
      vi.stubEnv("META_APP_ID", appId);
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(Response.json({ id: sessionId }))
        .mockResolvedValueOnce(Response.json({ h: handle }))
        .mockResolvedValueOnce(Response.json({ id: "modelo-video", status: "PENDING" }));
      vi.stubGlobal("fetch", fetchMock);
      const meta = provider();
      const uploaded = await meta.uploadTemplateExample({
        bytes, mime: "video/mp4", name: "WhatsApp Video 2026-11-10 at 10.13.33.mp4",
      });
      const draft = valid({ headerMedia: "VIDEO", headerHandle: uploaded });
      if (!draft.ok) throw new Error("rascunho deveria ser válido");
      await meta.createMessageTemplate(templatePayload(draft.draft));

      const [sessionUrl, sessionRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
      const url = new URL(sessionUrl);
      expect(url.pathname).toBe("/v26.0/app/uploads");
      expect(url.searchParams.get("file_name")).toBe("WhatsApp Video 2026-11-10 at 10.13.33.mp4");
      expect(url.searchParams.get("file_length")).toBe(String(bytes.length));
      expect(url.searchParams.get("file_type")).toBe("video/mp4");
      expect(new Headers(sessionRequest.headers).get("Authorization")).toBe("Bearer token-da-conta");

      const [uploadUrl, uploadRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(uploadUrl).toBe(`https://graph.facebook.com/v26.0/${sessionId}`);
      expect(new Headers(uploadRequest.headers).get("Authorization")).toBe("OAuth token-da-conta");
      expect(new Headers(uploadRequest.headers).get("file_offset")).toBe("0");
      expect(uploadRequest.body).toEqual(new Uint8Array(bytes));

      const [, createRequest] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(JSON.parse(createRequest.body as string).components[0]).toEqual({
        type: "HEADER", format: "VIDEO", example: { header_handle: [handle] },
      });
    },
  );

  it.each([undefined, "", "1234567890", "https://example.com/video.mp4", { id: "media" }])(
    "não anuncia upload concluído quando a Meta não devolve um handle de exemplo: %j",
    async (h) => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(Response.json({ id: sessionId }))
        .mockResolvedValueOnce(Response.json({ h })));
      await expect(provider().uploadTemplateExample({ bytes, mime: "video/mp4", name: "video.mp4" }))
        .rejects.toBeInstanceOf(MetaTemplateRejected);
    },
  );
});

describe("Status para a tela", () => {
  it("traduz o status da Meta e ignora o motivo NONE", () => {
    expect(templateStatusLabel("PENDING").label).toBe("Em análise");
    expect(templateStatusLabel("APPROVED").tone).toBe("success");
    expect(managedTemplate({ id: "x", name: "y", rejected_reason: "NONE" })?.rejectedReason).toBeNull();
  });
});
