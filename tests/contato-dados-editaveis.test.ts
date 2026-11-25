import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  lead: { findFirst: vi.fn(), update: vi.fn() },
  $executeRaw: vi.fn(),
}));
const trail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } }));
vi.mock("@/modules/crm/admission", () => ({ lockCrmAdmission: vi.fn() }));
vi.mock("@/modules/crm/trail", () => ({ recordCrmTrail: trail }));

import { editContactProfile, readContactProfileForm } from "@/modules/crm/contact-profile";

const custom = [{ key: "convenio", description: "Convênio" }];

function lead(overrides: Record<string, unknown> = {}, conversation: Record<string, unknown> = {}) {
  return {
    id: "lead-1", name: "Ana", whatsappName: "Ana 💅", nameEditedAt: null,
    conversation: {
      id: "conv-1", tenantId: "tenant-1", variables: { nome: "Ana", endereco: "Rua A" }, editedVariables: [],
      agent: { tenantId: "tenant-1", variableDefinitions: custom }, ...conversation,
    },
    ...overrides,
  };
}

const edit = (name: string, variables: Record<string, string> = {}) =>
  editContactProfile({ tenantId: "tenant-1", leadId: "lead-1", profile: { name, variables }, via: "contatos", actorUserId: "user-1" });

/** Valores gravados pelo SQL cru: [variables json, editedVariables]. */
function written() {
  const call = tx.$executeRaw.mock.calls[0];
  return { variables: JSON.parse(call[1] as string), edited: call[2] as string[] };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.lead.findFirst.mockResolvedValue(lead());
});

describe("dados do contato editados pela equipe", () => {
  it("nome novo vale, trava e vira o {{nome}}; o original do WhatsApp não é tocado", async () => {
    expect(await edit("Ana Paula")).toEqual({ status: "ok", fields: ["nome"] });
    const data = tx.lead.update.mock.calls[0][0].data;
    expect(data.name).toBe("Ana Paula");
    expect(data.nameEditedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("whatsappName");
    expect(data).not.toHaveProperty("phone");
    expect(written()).toEqual({ variables: { nome: "Ana Paula", endereco: "Rua A" }, edited: ["nome"] });
    expect(trail).toHaveBeenCalledWith(expect.objectContaining({ event: "crm.contact_edited", meta: { fields: "nome", via: "contatos" } }));
  });

  it("nome em branco volta ao do WhatsApp e destrava", async () => {
    tx.lead.findFirst.mockResolvedValue(lead({ name: "Ana Paula", nameEditedAt: new Date() },
      { variables: { nome: "Ana Paula" }, editedVariables: ["nome"] }));
    await edit("");
    expect(tx.lead.update.mock.calls[0][0].data).toEqual({ name: "Ana 💅", nameEditedAt: null });
    expect(written()).toEqual({ variables: {}, edited: [] });
  });

  it("variável editada trava; apagada destrava", async () => {
    await edit("Ana", { convenio: "Plano Azul", endereco: "" });
    expect(tx.lead.update).not.toHaveBeenCalled();
    expect(written()).toEqual({ variables: { nome: "Ana", convenio: "Plano Azul" }, edited: ["convenio"] });
  });

  it("sem mudança não grava nem registra na trilha", async () => {
    expect(await edit("Ana", { endereco: "Rua A" })).toEqual({ status: "ok", fields: [] });
    expect(tx.lead.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(trail).not.toHaveBeenCalled();
  });

  it("ignora chave que o agente não tem", async () => {
    expect(await edit("Ana", { segredo: "x" })).toEqual({ status: "ok", fields: [] });
  });

  it("contato de outra conta ou de teste não é encontrado", async () => {
    tx.lead.findFirst.mockResolvedValue(null);
    expect(await edit("Ana Paula")).toEqual({ status: "unavailable" });
    expect(tx.lead.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "tenant-1", id: "lead-1", isTest: false });
  });

  it("o formulário recusa token de variável e ignora {{numero}}", () => {
    const form = new FormData();
    form.set("name", "  Ana   Paula ");
    form.set("var:numero", "5511");
    form.set("var:endereco", " Rua B ");
    expect(readContactProfileForm(form)).toEqual({ name: "Ana Paula", variables: { endereco: "Rua B" } });
    form.set("var:endereco", "{{nome}}");
    expect(readContactProfileForm(form)).toHaveProperty("error");
  });
});
