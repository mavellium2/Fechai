import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  addBrazilCountryCode,
  defaultVariables,
  listRows,
  parsePastedContacts,
  validateListInput,
} from "@/modules/broadcasts/contacts";
import { parseBroadcastRows } from "@/modules/broadcasts/import";
import type { BroadcastTemplate } from "@/modules/broadcasts/template";

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { broadcastRecipient: { findMany: db.findMany, updateMany: db.updateMany } },
}));

const template: BroadcastTemplate = {
  id: "t1",
  name: "oferta",
  language: "pt_BR",
  header: "",
  body: "Oi {{1}}, temos {{2}}.",
  footer: "",
  parameterCount: 2,
};

describe("contatos colados", () => {
  it("lê telefone e nome com vírgula, ponto e vírgula, tabulação ou nome antes", () => {
    const lines = parsePastedContacts(
      "+55 11 98765-4321, Ana\n5521998765432;Bruno\nCarla\t+55 (31) 98888-7777\n\n5511987654321",
    );
    expect(lines).toEqual([
      { line: 1, ok: true, phone: "5511987654321", name: "Ana" },
      { line: 2, ok: true, phone: "5521998765432", name: "Bruno" },
      { line: 3, ok: true, phone: "5531988887777", name: "Carla" },
      { line: 5, ok: true, phone: "5511987654321", name: null },
    ]);
  });

  it("aponta número sem DDI e só acrescenta +55 por clique", () => {
    const [line] = parsePastedContacts("11 98765-4321, Ana");
    expect(line).toMatchObject({ ok: false, missingCountry: true });
    const fixed = addBrazilCountryCode("11 98765-4321, Ana\nabc");
    expect(parsePastedContacts(fixed)[0]).toMatchObject({
      ok: true,
      phone: "5511987654321",
      name: "Ana",
    });
    expect(fixed.split("\n")[1]).toBe("abc");
  });
});

describe("variáveis sem arquivo", () => {
  it("usa o nome do contato e o texto para quem não tem nome", () => {
    const variables = defaultVariables(2);
    variables[0].text = "tudo bem";
    variables[1].text = "desconto";
    const { main, issues } = listRows(
      [
        { phone: "5511987654321", name: "Ana Souza" },
        { phone: "5521998765432", name: null },
      ],
      variables,
    );
    expect(issues).toEqual([]);
    const parsed = parseBroadcastRows(main, template);
    expect(parsed.recipients.map((r) => r.content)).toEqual([
      "Oi Ana, temos desconto.",
      "Oi tudo bem, temos desconto.",
    ]);
  });

  it("aponta contato sem nome quando não há texto alternativo", () => {
    const { issues } = listRows(
      [{ phone: "5511987654321", name: null }],
      [
        { source: "name", text: "" },
        { source: "text", text: "x" },
      ],
    );
    expect(issues[0].row).toBe(1);
  });

  it("recusa texto fixo vazio e quantidade errada de variáveis", () => {
    const contacts = [{ phone: "5511987654321", name: "Ana" }];
    expect(() =>
      validateListInput(contacts, [{ source: "name", text: "" }, { source: "text", text: " " }], 2),
    ).toThrow("espaço 2");
    expect(() => validateListInput(contacts, [], 2)).toThrow();
    expect(() => validateListInput([], [], 0)).toThrow("pelo menos um");
  });
});

describe("quem não tem nome", () => {
  const vars = [
    { source: "firstName" as const, text: "" },
    { source: "text" as const, text: "desconto" },
  ];
  const people = [
    { phone: "5511987654321", name: "Daniela Reis" },
    { phone: "5521998765432", name: null },
  ];

  it("outra mensagem: sem nome vai para a versão sem nome, só com os espaços de texto", () => {
    const r = listRows(people, vars, "template");
    expect(r.main.map((x) => x.value.var_1)).toEqual(["Daniela"]);
    expect(r.nameless).toEqual([
      { row: 2, value: { telefone: "5521998765432", nome: "", var_1: "desconto" } },
    ]);
    expect(r.issues).toEqual([]);
  });

  it("não enviar: tira quem não tem nome e conta", () => {
    const r = listRows(people, vars, "skip");
    expect(r.main).toHaveLength(1);
    expect(r.nameless).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it("mensagem sem nome não exige versão sem nome", () => {
    const r = listRows(people, [{ source: "text", text: "x" }], "template");
    expect(r.main).toHaveLength(2);
    expect(r.nameless).toHaveLength(0);
  });

  it("modo outra mensagem exige escolher qual", () => {
    expect(() =>
      validateListInput(people, vars, 2, { mode: "template", templateId: "" }),
    ).toThrow("quem não tem nome");
  });
});

describe("versão sem o nome", () => {
  it("tira o espaço do nome e arruma a pontuação", async () => {
    const { removeVariables } = await import("@/modules/broadcasts/template-draft");
    expect(removeVariables("Oi {{1}}! Aqui é da clínica.", [1])).toBe("Oi! Aqui é da clínica.");
    expect(removeVariables("Olá, {{1}}, temos {{2}} hoje.", [1])).toBe("Olá, temos {{1}} hoje.");
    expect(removeVariables("{{1}}, sua consulta é {{2}}.", [1])).toBe("Sua consulta é {{1}}.");
  });

  it("acha a versão aprovada e escolhe a mensagem de cada contato", async () => {
    const { findNamelessVersion, recipientTemplate, templatesStillApproved } = await import(
      "@/modules/broadcasts/template"
    );
    const main = { ...template, name: "oferta", body: "Oi {{1}}, temos {{2}}." };
    const alt = { ...template, id: "t2", name: "oferta_sem_nome", body: "Oi, temos {{1}}.", parameterCount: 1 };
    expect(findNamelessVersion(main, [main, alt], [1])?.id).toBe("t2");
    expect(findNamelessVersion(main, [main], [1])).toBeUndefined();
    const campaign = { template: main, namelessTemplate: alt };
    expect(recipientTemplate(campaign, { variant: "nameless" }).id).toBe("t2");
    expect(recipientTemplate(campaign, { variant: "main" }).id).toBe("t1");
    expect(templatesStillApproved([main, alt], [main])).toBe(false);
    expect(templatesStillApproved([main, alt], [main, alt])).toBe(true);
  });
});

describe("desbloquear devolve à fila", () => {
  beforeEach(() => {
    db.findMany.mockReset();
    db.updateMany.mockReset();
  });

  it("reabre só o número desbloqueado, em disparos na fila ou pausados", async () => {
    const { reopenUnblockedRecipients } = await import("@/modules/broadcasts/unblock");
    db.findMany.mockResolvedValue([
      { id: "a", phone: "5511987654321" },
      { id: "b", phone: "551187654321" },
      { id: "c", phone: "5521998765432" },
    ]);
    db.updateMany.mockResolvedValue({ count: 2 });
    expect(await reopenUnblockedRecipients("t1", "1187654321")).toBe(2);
    expect(db.findMany.mock.calls[0][0].where).toMatchObject({
      status: "skipped",
      isTest: false,
      campaign: { tenantId: "t1", status: { in: ["queued", "paused"] } },
    });
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, status: "skipped" },
      data: { status: "pending", error: null },
    });
  });

  it("nunca lança", async () => {
    const { reopenUnblockedRecipients } = await import("@/modules/broadcasts/unblock");
    db.findMany.mockRejectedValue(new Error("db fora"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reopenUnblockedRecipients("t1", "1187654321")).toBe(0);
  });
});

describe("Meta simulada", () => {
  it("só liga fora de produção e com a variável", async () => {
    const { isBroadcastSimulation } = await import("@/modules/broadcasts/simulation");
    vi.stubEnv("BROADCASTS_SIMULATE_META", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(isBroadcastSimulation()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(isBroadcastSimulation()).toBe(true);
    vi.stubEnv("BROADCASTS_SIMULATE_META", "");
    expect(isBroadcastSimulation()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("filtro de período", () => {
  it("vai do início do dia inicial ao fim do dia final, em Brasília", async () => {
    const { periodRange } = await import("@/modules/broadcasts/queries");
    const r = periodRange("2026-11-01", "2026-11-09")!;
    expect(r.gte?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(r.lt?.toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(periodRange("ontem", "")).toBeUndefined();
    expect(periodRange("", "2026-11-09")).toEqual({ lt: new Date("2026-11-10T03:00:00.000Z") });
  });
});

describe("ajuda do editor de modelos", () => {
  it("renumera variáveis pela ordem e sugere nome", async () => {
    const m = await import("@/modules/broadcasts/template-draft");
    expect(m.renumberVariables("Oi {{3}}, dia {{1}} e {{3}}.")).toEqual({
      body: "Oi {{1}}, dia {{2}} e {{1}}.",
      order: [3, 1],
    });
    expect(m.variablesOutOfOrder("Oi {{2}} e {{1}}.")).toBe(true);
    expect(m.variablesOutOfOrder("Oi {{1}} e {{2}}.")).toBe(false);
    expect(m.suggestTemplateName("Oi {{1}}, sua avaliação está confirmada")).toBe("sua_avaliacao_esta_confirmada");
    expect(m.looksPromotional("Ganhe 20% de desconto")).toBe(true);
    expect(m.looksPromotional("Sua consulta é amanhã")).toBe(false);
  });
});
