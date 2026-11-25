import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM-06: todo transbordo registra a espera (`HandoffNotice`), move o card,
 * avisa o grupo uma vez com o link do card e guarda o id da mensagem. A pausa
 * da IA é escolha da conta. Conta só com a Meta transborda sem grupo e sem erro.
 */

const db = vi.hoisted(() => {
  const client = {
    tenantAction: { findUnique: vi.fn() },
    whatsappInstance: { findMany: vi.fn() },
    conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
    handoffNotice: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    // Trilha do CRM (CRM-11): o evento de transbordo pedido.
    user: { findFirst: vi.fn(async () => null) },
    tenant: { findUnique: vi.fn(async () => ({ name: "Clínica" })) },
    auditLog: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return client;
});
const provider = vi.hoisted(() => ({
  sendGroupMessage: vi.fn<(instance: string, group: string, text: string) => Promise<string | null>>(),
  isConfigured: vi.fn(() => true),
}));
const stage = vi.hoisted(() => ({ moveLeadToStage: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/crm/automatic-stage", () => ({ moveLeadToStage: stage.moveLeadToStage }));
vi.mock("@/modules/knowledge-gaps/register", () => ({ registerKnowledgeGap: vi.fn(async () => ({ status: "registered", mode: "keep" })) }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: (name: string) => (name === "meta" ? { isConfigured: () => true } : provider),
}));

import { closeHandoffNotices } from "@/modules/agent-engine/handoff-notice";
import { runToolHandler } from "@/modules/agent-engine/tools";

const TENANT = "tenant-1";
const CONVERSA = "conversa-1";
const GRUPO = "120363012345678901@g.us";
const ctx = { tenantId: TENANT, agentId: "agente-1", leadId: "lead-1", conversationId: CONVERSA };
const QR = { provider: "evolution", externalId: "tenant_tenant-1", status: "connected" };
const META = { provider: "meta", externalId: "phone-1", status: "connected", metaPhoneNumberId: "phone-1", metaBusinessAccountId: null, metaAccessTokenEncrypted: null };

function acao(whileWaiting?: string) {
  db.tenantAction.findUnique.mockResolvedValue({ enabled: true, config: { notifyGroup: true, groupId: GRUPO, ...(whileWaiting ? { whileWaiting } : {}) } });
}

function conversa(crmEnabled = true) {
  db.conversation.findFirst.mockResolvedValue({
    isTest: false, summary: "Quer fechar o orçamento hoje.", leadId: "lead-1",
    tenant: { crmEnabled, status: "active" },
    lead: { name: "Luciane", phone: "5514997631563", isTest: false, originChannel: "ad", adOrigin: null },
    messages: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_URL", "https://app.fechai.test/");
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  db.handoffNotice.findFirst.mockResolvedValue(null);
  db.handoffNotice.findMany.mockResolvedValue([{ id: "aviso-1", createdAt: new Date("2026-11-24T11:50:00Z") }]);
  db.handoffNotice.create.mockResolvedValue({ id: "aviso-1" });
  db.handoffNotice.updateMany.mockResolvedValue({ count: 1 });
  db.whatsappInstance.findMany.mockResolvedValue([QR]);
  provider.sendGroupMessage.mockResolvedValue("msg-grupo-1");
  stage.moveLeadToStage.mockResolvedValue("moved");
  acao();
  conversa();
});

afterEach(() => vi.unstubAllEnvs());

describe("transbordo de teste, ponta a ponta", () => {
  it("move o card, manda o aviso com o link do card e grava o HandoffNotice com o messageId", async () => {
    await runToolHandler("handoff_human", ctx, { reason: "Pediu para falar com a recepção." });

    expect(stage.moveLeadToStage).toHaveBeenCalledWith(TENANT, "lead-1", "waiting_human", "ai", expect.objectContaining({ reason: "handoff", conversationId: CONVERSA }));
    expect(db.handoffNotice.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, conversationId: CONVERSA, trigger: "agent", reason: "Pediu para falar com a recepção." },
      select: { id: true },
    });
    const text = provider.sendGroupMessage.mock.calls[0][2];
    expect(provider.sendGroupMessage.mock.calls[0][1]).toBe(GRUPO);
    expect(text).toContain("Origem: Anúncio");
    expect(text).toContain("Motivo: Pediu para falar com a recepção.");
    expect(text).toContain("Card: https://app.fechai.test/crm?lead=lead-1");
    expect(db.handoffNotice.updateMany).toHaveBeenCalledWith({
      where: { id: "aviso-1", tenantId: TENANT },
      data: { groupId: GRUPO, messageId: "msg-grupo-1", sentAt: expect.any(Date) },
    });
  });

  it("sem CRM ligado o aviso sai sem link (não há card para abrir)", async () => {
    conversa(false);
    await runToolHandler("handoff_human", ctx, { reason: "Prioridade" });
    expect(provider.sendGroupMessage.mock.calls[0][2]).not.toContain("Card:");
  });

  it("pergunta sem resposta e regra da campanha ficam registradas com a origem do transbordo", async () => {
    await runToolHandler("handoff_human", ctx, { reason: "Não soube responder", unanswered: true, question: "Aceita convênio?" });
    expect(db.handoffNotice.create.mock.calls[0][0].data.trigger).toBe("unanswered");
  });
});

describe("enquanto aguarda humano, a IA", () => {
  it("com 'pausa', a mesma escrita do transbordo pausa o agente nesta conversa", async () => {
    acao("pause");
    await runToolHandler("handoff_human", ctx, { reason: "Prioridade" });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: CONVERSA, tenantId: TENANT, needsHuman: false },
      data: { needsHuman: true, agentPaused: true },
    });
  });

  it("com 'continua' (ou config antiga), responde como hoje", async () => {
    for (const value of ["continue", undefined, "qualquer coisa"]) {
      db.conversation.updateMany.mockClear();
      acao(value);
      await runToolHandler("handoff_human", ctx, { reason: "Prioridade" });
      expect(db.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: CONVERSA, tenantId: TENANT, needsHuman: false },
        data: { needsHuman: true },
      });
    }
  });

  it("ação desligada nunca pausa", async () => {
    db.tenantAction.findUnique.mockResolvedValue({ enabled: false, config: { whileWaiting: "pause" } });
    await runToolHandler("handoff_human", ctx, { reason: "Prioridade" });
    expect(db.conversation.updateMany.mock.calls[0][0].data).toEqual({ needsHuman: true });
  });
});

describe("conta só com a Meta", () => {
  it("o card vai para Aguardando humano e a espera fica registrada, sem envio e sem erro", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([META]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runToolHandler("handoff_human", ctx, { reason: "Prioridade" })).resolves.toContain("precisa atenção");
    expect(stage.moveLeadToStage).toHaveBeenCalledWith(TENANT, "lead-1", "waiting_human", "ai", expect.anything());
    expect(db.handoffNotice.create).toHaveBeenCalled();
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
    // A espera nova vira um evento na trilha, sem o motivo (texto livre).
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      event: "handoff.requested", actorRole: "SYSTEM", targetType: "Lead", targetId: "lead-1",
      meta: { trigger: "agent", conversationId: CONVERSA, noticeId: "aviso-1" },
    }) });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("transbordo repetido com a espera aberta", () => {
  it("não manda outro aviso ao grupo: só atualiza a espera", async () => {
    db.handoffNotice.findFirst.mockResolvedValue({ id: "aviso-aberto" });
    await runToolHandler("handoff_human", ctx, { reason: "Pediu de novo" });
    expect(db.handoffNotice.create).not.toHaveBeenCalled();
    expect(db.handoffNotice.updateMany).toHaveBeenCalledWith({
      where: { id: "aviso-aberto", tenantId: TENANT },
      data: { repeatCount: { increment: 1 }, reason: "Pediu de novo" },
    });
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("trava a conversa antes de procurar a espera aberta (dois transbordos ao mesmo tempo)", async () => {
    await runToolHandler("handoff_human", ctx, { reason: "Prioridade" });
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.handoffNotice.findFirst.mock.invocationCallOrder[0]);
  });

  it("falha ao registrar a espera não cala o aviso do grupo", async () => {
    db.$transaction.mockRejectedValueOnce(new Error("banco indisponível"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await runToolHandler("handoff_human", ctx, { reason: "Prioridade" });
    expect(provider.sendGroupMessage).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});

describe("fechar a espera (closeHandoffNotices)", () => {
  it("assumido grava quem, por onde e quando", async () => {
    const at = new Date("2026-11-24T12:00:00Z");
    await closeHandoffNotices(TENANT, CONVERSA, { status: "assumed", via: "panel", userId: "user-1" }, at);
    expect(db.handoffNotice.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, conversationId: CONVERSA, status: "waiting", id: { in: ["aviso-1"] } },
      data: { status: "assumed", assumedVia: "panel", assumedAt: at, closedAt: at, assignedUserId: "user-1" },
    });
  });

  it("devolvido para a IA não tem responsável; falha no banco não lança", async () => {
    const at = new Date("2026-11-24T12:00:00Z");
    await closeHandoffNotices(TENANT, CONVERSA, { status: "returned" }, at);
    expect(db.handoffNotice.updateMany).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT, conversationId: CONVERSA, status: "waiting", id: { in: ["aviso-1"] } }, data: { status: "returned", closedAt: at },
    });
    db.handoffNotice.updateMany.mockRejectedValueOnce(new Error("banco"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(closeHandoffNotices(TENANT, CONVERSA, { status: "returned" })).resolves.toBe(0);
    log.mockRestore();
  });
});

describe("todo caminho que tira a conversa da espera fecha o aviso", () => {
  // Um aviso esquecido em aberto calaria o próximo transbordo do contato.
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }
  const root = join(__dirname, "..", "src");
  const writers = sourceFiles(root).filter((file) => /data:\s*\{[^}]*needsHuman:\s*false/.test(readFileSync(file, "utf8")));

  it("encontra os caminhos de hoje", () => {
    expect(writers.length).toBeGreaterThanOrEqual(4);
  });

  it.each(writers.map((file) => [file.slice(root.length + 1)]))("%s chama closeHandoffNotices", (file) => {
    // A variante com o tempo de espera (CRM-11) fecha do mesmo jeito.
    expect(readFileSync(join(root, file), "utf8")).toMatch(/closeHandoffNotices(Timed)?\(/);
  });
});
