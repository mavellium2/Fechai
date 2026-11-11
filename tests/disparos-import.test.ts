import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { normalizeBroadcastPhone } from "@/modules/broadcasts/phone";
import {
  MAX_IMPORT_BYTES,
  parseBroadcastFile,
  parseBroadcastRows,
} from "@/modules/broadcasts/import";
import {
  sameBroadcastTemplate,
  supportedTemplate,
  type BroadcastTemplate,
} from "@/modules/broadcasts/template";

const template: BroadcastTemplate = {
  id: "t1",
  name: "convite",
  language: "pt_BR",
  header: "Convite",
  body: "Olá {{1}}, confira {{2}}. {{1}}!",
  footer: "Obrigado",
  parameterCount: 2,
};
const record = {
  telefone: "+55 (11) 98765-4321",
  nome: "Ana",
  var_1: "Ana",
  var_2: "a novidade",
};

describe("importação de disparos", () => {
  it("normaliza números e remove duplicados preservando a primeira linha", () => {
    const result = parseBroadcastRows(
      [
        { row: 2, value: record },
        { row: 3, value: { ...record, telefone: "5511987654321" } },
      ],
      template,
    );
    expect(result.duplicates).toBe(1);
    expect(result.recipients).toEqual([
      {
        row: 2,
        phone: "5511987654321",
        name: "Ana",
        parameters: ["Ana", "a novidade"],
        content: "Convite\n\nOlá Ana, confira a novidade. Ana!\n\nObrigado",
      },
    ]);
  });
  it.each([
    "abc5511987654321",
    "1e12",
    "000000000000",
    "55119876",
    "55119999999999999",
    null,
  ])("recusa telefone inválido %s", (phone) => {
    expect(normalizeBroadcastPhone(phone)).toBeNull();
  });
  it("deduplica celular brasileiro com e sem nono dígito", () => {
    const result = parseBroadcastRows(
      [
        { row: 2, value: record },
        { row: 3, value: { ...record, telefone: "551187654321" } },
      ],
      template,
    );
    expect(result.recipients).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });
  it("preserva número internacional e números como valor numérico", () => {
    expect(normalizeBroadcastPhone("+44 20 7946 0958")).toBe("442079460958");
    expect(normalizeBroadcastPhone(5511987654321)).toBe("5511987654321");
  });
  it("aponta linha e variável ausente e não inventa valores", () => {
    const result = parseBroadcastRows(
      [
        { row: 4, value: { ...record, var_2: "" } },
        { row: 8, value: { ...record, var_1: "Ana\nMaria" } },
      ],
      template,
    );
    expect(result.recipients).toHaveLength(0);
    expect(result.issues).toEqual([
      { row: 4, error: expect.stringContaining("var_2") },
      { row: 8, error: expect.stringContaining("var_1") },
    ]);
  });
  it("recusa objetos aninhados, fórmulas e linhas que não são objetos", () => {
    const result = parseBroadcastRows(
      [
        {
          row: 2,
          value: {
            ...record,
            telefone: { formula: "1+1", result: 5511987654321 },
          },
        },
        { row: 3, value: null },
      ],
      template,
    );
    expect(result.issues).toHaveLength(2);
  });
  it("aplica limite de contatos", () => {
    expect(() =>
      parseBroadcastRows(
        Array.from({ length: 1001 }, (_, i) => ({ row: i + 1, value: record })),
        template,
      ),
    ).toThrow("1000");
  });
  it("lê JSON real com BOM e rejeita estrutura incorreta", async () => {
    const result = await parseBroadcastFile(
      new File(["\uFEFF" + JSON.stringify([record])], "contatos.json"),
      template,
    );
    expect(result.recipients).toHaveLength(1);
    await expect(
      parseBroadcastFile(new File(["{}"], "contatos.json"), template),
    ).rejects.toThrow("lista");
    await expect(
      parseBroadcastFile(new File(["["], "contatos.json"), template),
    ).rejects.toThrow("JSON inválido");
  });
  it("lê XLSX real, primeira aba, cabeçalhos sem depender de posição", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Contatos");
    sheet.addRow(["Nome", "VAR_2", "Telefone", "var_1"]);
    sheet.addRow(["Ana", "a novidade", 5511987654321, "Ana"]);
    workbook.addWorksheet("Ignorada").addRow(["Não é um contato"]);
    const file = new File(
      [new Uint8Array(await workbook.xlsx.writeBuffer())],
      "lista.xlsx",
    );
    const result = await parseBroadcastFile(file, template);
    expect(result.recipients[0]).toMatchObject({
      row: 2,
      phone: "5511987654321",
      parameters: ["Ana", "a novidade"],
    });
  });
  it("recusa extensão, arquivo grande e Excel inválido", async () => {
    await expect(
      parseBroadcastFile(new File(["abc"], "lista.xls"), template),
    ).rejects.toThrow(".xlsx");
    await expect(
      parseBroadcastFile(
        new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "lista.json"),
        template,
      ),
    ).rejects.toThrow("2 MB");
    await expect(
      parseBroadcastFile(new File(["Não sou ZIP"], "lista.xlsx"), template),
    ).rejects.toThrow("Excel inválido");
  });
});

describe("templates compatíveis", () => {
  it("reconhece template salvo em JsonB mesmo com chaves reordenadas", () => {
    const persisted = Object.fromEntries(
      Object.entries(template).reverse(),
    ) as BroadcastTemplate;
    expect(sameBroadcastTemplate(template, persisted)).toBe(true);
    expect(
      sameBroadcastTemplate(template, { ...persisted, body: "Outro texto" }),
    ).toBe(false);
  });
  const raw = {
    id: "t1",
    name: "convite",
    language: "pt_BR",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Olá {{1}}, {{1}}!" }],
  };
  it("conta variáveis únicas", () =>
    expect(supportedTemplate(raw)?.parameterCount).toBe(1));
  it("aceita texto sem variáveis", () =>
    expect(
      supportedTemplate({
        ...raw,
        components: [{ type: "BODY", text: "Olá!" }],
      })?.parameterCount,
    ).toBe(0));
  it("recusa pendente, nomeadas, buracos na sequência, botões não suportados e mídia", () => {
    expect(supportedTemplate({ ...raw, status: "PENDING" })).toBeNull();
    expect(supportedTemplate({ ...raw, parameter_format: "NAMED" })).toBeNull();
    expect(
      supportedTemplate({
        ...raw,
        components: [{ type: "BODY", text: "{{2}}" }],
      }),
    ).toBeNull();
    expect(
      supportedTemplate({
        ...raw,
        components: [...raw.components, { type: "BUTTONS" }],
      }),
    ).toBeNull();
    expect(
      supportedTemplate({
        ...raw,
        components: [
          ...raw.components,
          { type: "BUTTONS", buttons: [{ type: "PHONE_NUMBER", text: "Ligar" }] },
        ],
      }),
    ).toBeNull();
    expect(
      supportedTemplate({
        ...raw,
        components: [...raw.components, { type: "HEADER", format: "IMAGE" }],
      }),
    ).toBeNull();
  });

  it("aceita botões de resposta rápida", () => {
    expect(
      supportedTemplate({
        ...raw,
        components: [
          ...raw.components,
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Eu quero" }] },
        ],
      })?.buttons,
    ).toEqual([{ type: "QUICK_REPLY", text: "Eu quero" }]);
  });
});

describe("mapeamento de colunas", () => {
  const mappedTemplate = {
    id: "t",
    name: "ola",
    language: "pt_BR",
    body: "Oi {{1}}",
    header: "",
    footer: "",
    parameterCount: 1,
  };
  it("usa cabeçalhos próprios e ignora colunas não selecionadas", () => {
    const result = parseBroadcastRows(
      [
        {
          row: 2,
          value: {
            Celular: "5511987654321",
            Cliente: "Ana",
            Ignorado: { formula: "=1+1" },
          },
        },
      ],
      mappedTemplate,
      { phone: "celular", name: "cliente", parameters: ["cliente"] },
    );
    expect(result.issues).toEqual([]);
    expect(result.recipients[0]).toMatchObject({
      phone: "5511987654321",
      name: "Ana",
      content: "Oi Ana",
    });
  });
  it("não executa fórmulas selecionadas nem aceita coluna ausente", () => {
    const rows = [
      {
        row: 2,
        value: {
          Celular: "5511987654321",
          Cliente: { formula: "=1+1", result: 2 },
        },
      },
    ];
    expect(
      parseBroadcastRows(rows, mappedTemplate, {
        phone: "Celular",
        parameters: ["Cliente"],
      }).issues,
    ).toHaveLength(1);
    expect(
      parseBroadcastRows(rows, mappedTemplate, {
        phone: "inexistente",
        parameters: ["Cliente"],
      }).recipients,
    ).toEqual([]);
  });
  it("recusa mapeamento incompleto enviado diretamente ao servidor", () => {
    expect(() =>
      parseBroadcastRows([{ row: 1, value: {} }], mappedTemplate, {
        phone: "celular",
        parameters: [],
      }),
    ).toThrow(/Associe/);
  });
});
