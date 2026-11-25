import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  withLock: vi.fn(),
  lock: vi.fn(),
  stage: vi.fn(),
  findLead: vi.fn(),
  createLead: vi.fn(),
  deleteLead: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction, lead: { delete: mocks.deleteLead } },
}));
vi.mock("@/modules/agent-engine/conversation-lock", () => ({ withConversationContactLock: mocks.withLock }));
vi.mock("@/modules/crm/admission", () => ({ lockCrmAdmission: mocks.lock }));

import {
  createManualCrmLead, deleteManualCrmLead, normalizeCrmName, normalizeCrmPhone,
} from "@/modules/crm/manual-leads";

const db = {
  lead: { findFirst: mocks.findLead, create: mocks.createLead, delete: mocks.deleteLead },
  pipelineStage: { findFirst: mocks.stage },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  mocks.withLock.mockImplementation((_tenant: string, _phone: string, work: (tx: typeof db) => Promise<unknown>) => work(db));
  mocks.lock.mockResolvedValue(undefined);
});

describe("cadastro manual de lead no quadro", () => {
  it("normaliza o telefone do Brasil para E.164 e recusa o que não dá para discar", () => {
    expect(normalizeCrmPhone("(11) 99999-9999")).toBe("5511999999999");
    expect(normalizeCrmPhone("11 3333-4444")).toBe("551133334444");
    expect(normalizeCrmPhone("+55 11 99999-9999")).toBe("5511999999999");
    expect(normalizeCrmPhone("1234")).toBeNull();
    expect(normalizeCrmPhone("01999999999")).toBeNull();
    expect(normalizeCrmPhone("")).toBeNull();
  });

  it("limpa o nome opcional: sem caractere de controle, espaço duplicado ou sobra", () => {
    expect(normalizeCrmName("  Ana \t  Souza  ")).toBe("Ana Souza");
    expect(normalizeCrmName("   ")).toBeNull();
    expect(normalizeCrmName("A".repeat(200))).toHaveLength(80);
  });

  it("não cadastra em Perdido: a etapa perdida pede motivo e justificativa", async () => {
    mocks.stage.mockResolvedValue({ id: "perdido", name: "Perdido", kind: "lost" });
    expect(await createManualCrmLead({ tenantId: "t1", userId: "u1", name: "Ana", phone: "5511999999999", stageId: "perdido" }))
      .toEqual({ status: "stage_unavailable" });
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("não duplica número que já existe na conta", async () => {
    mocks.stage.mockResolvedValue({ id: "novo", name: "Novo lead", kind: "new" });
    mocks.findLead.mockResolvedValue({ id: "lead-antigo" });
    expect(await createManualCrmLead({ tenantId: "t1", userId: "u1", name: "", phone: "5511999999999", stageId: "novo" }))
      .toEqual({ status: "exists", leadId: "lead-antigo" });
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("cria o lead com a transição de entrada na etapa escolhida", async () => {
    mocks.stage.mockResolvedValue({ id: "novo", name: "Novo lead", kind: "new" });
    mocks.findLead.mockResolvedValue(null);
    mocks.createLead.mockResolvedValue({ id: "lead-novo" });
    const result = await createManualCrmLead({ tenantId: "t1", userId: "u1", name: "Ana", phone: "5511999999999", stageId: "novo" });
    expect(result).toMatchObject({ status: "created", leadId: "lead-novo", stageName: "Novo lead" });
    expect(mocks.createLead).toHaveBeenCalledOnce();
    expect(mocks.createLead.mock.calls[0][0].data).toMatchObject({
      tenantId: "t1", phone: "5511999999999", originChannel: "manual", stageId: "novo",
      transitions: { create: { toStageId: "novo", userId: "u1", source: "user" } },
    });
  });
});

describe("exclusão de lead pelo quadro", () => {
  const lead = {
    id: "lead-1", tenantId: "t1", name: "Ana", phone: "5511999999999", status: "open",
    stageId: "novo", originChannel: "manual", isTest: false,
    createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-02"),
    conversation: { _count: { messages: 0 } }, _count: { appointments: 0 },
  };

  it("exclui o cadastro sem histórico e guarda o retrato para a auditoria", async () => {
    mocks.findLead.mockResolvedValue(lead);
    const result = await deleteManualCrmLead({ tenantId: "t1", leadId: "lead-1" });
    expect(result).toMatchObject({ status: "deleted", label: "Ana" });
    if (result.status !== "deleted") throw new Error("esperava exclusão");
    expect(result.snapshot).not.toHaveProperty("conversation");
    expect(result.snapshot).not.toHaveProperty("_count");
    expect(mocks.deleteLead).toHaveBeenCalledWith({ where: { id: "lead-1", tenantId: "t1" } });
  });

  it("recusa lead com mensagem na conversa", async () => {
    mocks.findLead.mockResolvedValue({ ...lead, conversation: { _count: { messages: 3 } } });
    expect(await deleteManualCrmLead({ tenantId: "t1", leadId: "lead-1" })).toEqual({ status: "has_history" });
    expect(mocks.deleteLead).not.toHaveBeenCalled();
  });

  it("recusa lead com agendamento, mesmo sem conversa", async () => {
    mocks.findLead.mockResolvedValue({ ...lead, conversation: null, _count: { appointments: 1 } });
    expect(await deleteManualCrmLead({ tenantId: "t1", leadId: "lead-1" })).toEqual({ status: "has_history" });
    expect(mocks.deleteLead).not.toHaveBeenCalled();
  });

  it("não apaga lead de outra conta nem lead de teste (fora do quadro)", async () => {
    mocks.findLead.mockResolvedValue(null);
    expect(await deleteManualCrmLead({ tenantId: "t1", leadId: "lead-x" })).toEqual({ status: "not_found" });
    expect(mocks.findLead.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", isTest: false });
    expect(mocks.deleteLead).not.toHaveBeenCalled();
  });
});
