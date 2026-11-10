import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaCloudProvider } from "@/modules/whatsapp/meta";
import {
  mediaFileProblem,
  mediaFilenameFromUrl,
  mediaLinkProblem,
  mediaMime,
  parseCampaignMedia,
} from "@/modules/broadcasts/media";
import {
  findNamelessVersion,
  renderBroadcast,
  sameBroadcastTemplate,
  supportedTemplate,
  type BroadcastTemplate,
} from "@/modules/broadcasts/template";
import { parseBroadcastRows } from "@/modules/broadcasts/import";
import { templatePayload, validateTemplateDraft } from "@/modules/broadcasts/template-draft";

const provider = new MetaCloudProvider({
  phoneNumberId: "123",
  businessAccountId: "456",
  accessToken: "secret-test",
});

const imageRecord = {
  id: "img",
  name: "folheto",
  language: "pt_BR",
  status: "APPROVED",
  components: [
    { type: "HEADER", format: "IMAGE" },
    { type: "BODY", text: "Oi {{1}}, veja a novidade." },
  ],
};

const imageTemplate: BroadcastTemplate = {
  id: "img",
  name: "folheto",
  language: "pt_BR",
  body: "Oi {{1}}, veja a novidade.",
  header: "",
  footer: "",
  parameterCount: 1,
  mediaFormat: "IMAGE",
};

afterEach(() => vi.unstubAllGlobals());

describe("Disparos com mídia: modelos", () => {
  it("só os Disparos enxergam modelo com mídia; lembretes continuam só com texto", () => {
    expect(supportedTemplate(imageRecord)).toBeNull();
    expect(supportedTemplate(imageRecord, { media: true })).toEqual(imageTemplate);
    expect(
      supportedTemplate(
        { ...imageRecord, components: [{ type: "HEADER", format: "LOCATION" }, imageRecord.components[1]] },
        { media: true },
      ),
    ).toBeNull();
  });

  it("modelo trocado de texto para imagem não passa como o mesmo", () => {
    const text = { ...imageTemplate, mediaFormat: undefined };
    expect(sameBroadcastTemplate(imageTemplate, imageTemplate)).toBe(true);
    expect(sameBroadcastTemplate(text, imageTemplate)).toBe(false);
    // Rascunho antigo sem a chave continua igual ao modelo de texto atual.
    const { mediaFormat: _ignored, ...legacy } = text;
    void _ignored;
    expect(sameBroadcastTemplate(legacy, text)).toBe(true);
  });

  it("a conversa registra o tipo do arquivo no lugar do topo", () => {
    expect(renderBroadcast(imageTemplate, ["Ana"])).toBe("[Imagem]\n\nOi Ana, veja a novidade.");
  });

  it("versão sem nome precisa ter o mesmo tipo de arquivo", () => {
    const nameless = { ...imageTemplate, id: "sem", name: "folheto_sem_nome", body: "Veja a novidade.", parameterCount: 0 };
    expect(findNamelessVersion(imageTemplate, [nameless], [1])?.id).toBe("sem");
    expect(findNamelessVersion(imageTemplate, [{ ...nameless, mediaFormat: undefined }], [1])).toBeUndefined();
  });
});

describe("Disparos com mídia: envio na Meta", () => {
  it("manda o link no cabeçalho e as variáveis no corpo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.img" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await provider.sendBroadcastTemplate("5511987654321", imageTemplate, ["Ana"], {
      link: "https://cdn.exemplo.com/a.jpg",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.exemplo.com/a.jpg" } }] },
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]);
  });

  it("documento leva o nome do arquivo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.doc" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await provider.sendBroadcastTemplate(
      "5511987654321",
      { ...imageTemplate, mediaFormat: "DOCUMENT", parameterCount: 0, body: "Segue o orçamento." },
      [],
      { link: "https://cdn.exemplo.com/o.pdf", filename: "orcamento.pdf" },
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).template.components).toEqual([
      {
        type: "header",
        parameters: [
          { type: "document", document: { link: "https://cdn.exemplo.com/o.pdf", filename: "orcamento.pdf" } },
        ],
      },
    ]);
  });

  it("sem arquivo nem chega a chamar a Meta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      provider.sendBroadcastTemplate("5511987654321", imageTemplate, ["Ana"], null),
    ).rejects.toThrow("arquivo");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Disparos com mídia: arquivos e planilha", () => {
  it("aceita só os formatos e tamanhos que a Meta aceita", () => {
    expect(mediaFileProblem("IMAGE", { name: "a.jpg", type: "image/jpeg", size: 1000 })).toBeNull();
    expect(mediaFileProblem("IMAGE", { name: "a.gif", type: "image/gif", size: 1000 })).toMatch(/Formato/);
    expect(mediaFileProblem("IMAGE", { name: "a.png", type: "image/png", size: 6 * 1024 * 1024 })).toMatch(/grande/);
    expect(mediaFileProblem("VIDEO", { name: "a.mp4", type: "video/mp4", size: 0 })).toMatch(/vazio/);
    // Windows costuma mandar .docx sem tipo: vale a extensão.
    expect(mediaMime("DOCUMENT", { name: "Proposta.DOCX", type: "" })).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("link da planilha precisa ser https e em uma linha", () => {
    expect(mediaLinkProblem("https://site.com/a.jpg")).toBeNull();
    expect(mediaLinkProblem("http://site.com/a.jpg")).toMatch(/https/);
    expect(mediaLinkProblem("")).toMatch(/Preencha/);
    expect(mediaLinkProblem("https://user:senha@site.com/a.jpg")).toMatch(/senha/);
    expect(mediaFilenameFromUrl("https://site.com/pasta/Or%C3%A7amento%201.pdf?x=1")).toBe("Orçamento 1.pdf");
  });

  it("cada linha recebe o próprio link e linha sem link é apontada", () => {
    const result = parseBroadcastRows(
      [
        { row: 2, value: { telefone: "5511987654321", nome: "Ana", var_1: "Ana", link: "https://s.com/a.jpg" } },
        { row: 3, value: { telefone: "5521987654321", nome: "Bia", var_1: "Bia", link: "" } },
      ],
      imageTemplate,
      { phone: "telefone", name: "nome", parameters: ["var_1"], media: "link" },
    );
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0]).toMatchObject({ mediaUrl: "https://s.com/a.jpg", mediaFilename: "a.jpg" });
    expect(result.recipients[0].content).toBe("[Imagem]\n\nOi Ana, veja a novidade.");
    expect(result.issues).toEqual([{ row: 3, error: "Preencha o link do arquivo." }]);
  });

  it("lê de volta só o arquivo salvo no formato certo", () => {
    expect(parseCampaignMedia({ format: "IMAGE", mode: "column", column: "link" })).toEqual({
      format: "IMAGE",
      mode: "column",
      column: "link",
    });
    expect(parseCampaignMedia({ format: "AUDIO", mode: "column", column: "link" })).toBeNull();
    expect(parseCampaignMedia(null)).toBeNull();
  });
});

describe("Criar modelo com mídia no topo", () => {
  const base = { name: "folheto", category: "MARKETING", body: "Oi, temos novidade para você." };

  it("exige o arquivo de exemplo e monta o cabeçalho com ele", () => {
    const missing = validateTemplateDraft({ ...base, headerMedia: "IMAGE" });
    expect(missing.ok).toBe(false);
    const ok = validateTemplateDraft({ ...base, headerMedia: "IMAGE", headerHandle: "4::aW1n", header: "ignorado" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(templatePayload(ok.draft).components[0]).toEqual({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["4::aW1n"] },
    });
  });

  it("áudio não é topo de modelo: vira modelo sem mídia", () => {
    const result = validateTemplateDraft({ ...base, headerMedia: "AUDIO", headerHandle: "x" });
    expect(result.ok && result.draft.headerMedia).toBe(null);
  });
});
