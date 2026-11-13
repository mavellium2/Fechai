import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CMP-01 — a trilha de auditoria das campanhas e o desfazer do admin, com o
 * Prisma trocado por mocks (as actions que gravam os eventos estão em
 * `campanha-entidade-actions.test.ts`).
 *
 * O desfazer regrava no banco o que um log guardou, então ele confere o estado
 * de HOJE da campanha antes de escrever: arquivada e terminada ficam só para
 * consulta, e o período resultante precisa continuar existindo.
 */

const mocks = vi.hoisted(() => ({
  campaignFindUnique: vi.fn(),
  campaignUpdate: vi.fn(),
  logFind: vi.fn(),
  logClaim: vi.fn(),
  logUpdate: vi.fn(),
  logFindFirst: vi.fn(),
  agentFind: vi.fn(),
  agentUpdate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit, recordChange: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: mocks.campaignFindUnique, updateMany: mocks.campaignUpdate },
    agent: { findUnique: mocks.agentFind, update: mocks.agentUpdate },
    auditLog: {
      findUnique: mocks.logFind,
      updateMany: mocks.logClaim,
      update: mocks.logUpdate,
      findFirst: mocks.logFindFirst,
    },
  },
}));

import { AUDIT_EVENTS, eventLabel, isRevertibleEvent, type AuditEventDef } from "@/modules/audit/events";
import { isRevertibleTarget, revertAuditLog } from "@/modules/audit/revert";

const NOW = new Date("2026-11-15T15:00:00.000Z");
const START = new Date("2026-11-01T03:00:00.000Z");
const END = new Date("2026-12-01T02:59:59.000Z");

// A campanha como está HOJE (15/11/2026): por padrão ativa; estas são as variações.
const DRAFT = { startsAt: null, endsAt: null };
const PAUSED = { pausedAt: new Date("2026-11-10T12:00:00.000Z") };
const FINISHED = { endsAt: new Date("2026-11-10T02:59:59.000Z") };
const ARCHIVED = { archivedAt: new Date("2026-11-12T12:00:00.000Z") };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trilha de auditoria das campanhas", () => {
  const EVENTS = AUDIT_EVENTS as Record<string, AuditEventDef>;

  it("os seis eventos existem, no grupo de campanhas, com rótulo em português", () => {
    for (const key of ["created", "updated", "paused", "resumed", "archived", "unarchived"]) {
      const def = EVENTS[`campaign.${key}`];
      expect(def, key).toBeDefined();
      expect(def.group).toBe("campanhas");
      expect(eventLabel(`campaign.${key}`)).not.toBe(`campaign.${key}`);
    }
  });

  it("só a edição é revertível", () => {
    expect(isRevertibleEvent("campaign.updated")).toBe(true);
    for (const key of ["created", "paused", "resumed", "archived", "unarchived"]) {
      expect(isRevertibleEvent(`campaign.${key}`), key).toBe(false);
    }
  });

  it("o desfazer sabe a que modelo se aplica", () => {
    expect(isRevertibleTarget("Campaign")).toBe(true);
  });

  /** O log de uma edição: `before` é o que o desfazer regrava. */
  const editLog = (before: Record<string, unknown>) => ({
    id: "log-1",
    event: "campaign.updated",
    revertible: true,
    revertedAt: null,
    targetType: "Campaign",
    targetId: "camp-1",
    targetLabel: "Black Friday 2026",
    tenantId: "tenant-a",
    before,
    after: { name: "Black Friday 2026" },
  });

  /** Prepara o desfazer: o log e a campanha como está HOJE (por padrão, ativa). */
  function revertSetup(before: Record<string, unknown>, current: Record<string, unknown> = {}) {
    mocks.logFind.mockResolvedValue(editLog(before));
    mocks.logClaim.mockResolvedValue({ count: 1 });
    mocks.campaignFindUnique.mockResolvedValue({
      id: "camp-1",
      activatedAt: new Date("2026-10-20T12:00:00.000Z"),
      startsAt: START,
      endsAt: END,
      pausedAt: null,
      archivedAt: null,
      ...current,
    });
    mocks.campaignUpdate.mockResolvedValue({ count: 1 });
    mocks.logFindFirst.mockResolvedValue(null);
    mocks.logUpdate.mockResolvedValue({});
  }

  const revert = () => revertAuditLog("log-1", { id: "admin-1", email: "admin@example.test" });

  it("desfazer uma edição regrava nome e datas (datas voltam como Date) e ignora o resto", async () => {
    revertSetup({
      name: "Black Friday",
      endsAt: "2026-12-01T02:59:59.000Z",
      // Um log adulterado não escreve onde não deve.
      tenantId: "tenant-b",
      pausedAt: "2026-11-10T12:00:00.000Z",
      archivedAt: null,
    });

    const result = await revert();

    expect(result.ok).toBe(true);
    expect(mocks.campaignUpdate).toHaveBeenCalledWith({
      where: {
        id: "camp-1",
        tenantId: "tenant-a",
        activatedAt: new Date("2026-10-20T12:00:00.000Z"),
        startsAt: START,
        endsAt: END,
        pausedAt: null,
        archivedAt: null,
      },
      data: { name: "Black Friday", endsAt: new Date("2026-12-01T02:59:59.000Z") },
    });
    const written = mocks.campaignUpdate.mock.calls[0][0].data;
    expect(written.endsAt).toBeInstanceOf(Date);
    expect(written).not.toHaveProperty("tenantId");
    expect(written).not.toHaveProperty("pausedAt");
  });

  it("lê do registro de hoje só o que precisa para conferir (status e período)", async () => {
    revertSetup({ name: "Black Friday" });
    await revert();
    expect(mocks.campaignFindUnique).toHaveBeenCalledWith({
      where: { id: "camp-1", tenantId: "tenant-a" },
      select: { id: true, activatedAt: true, startsAt: true, endsAt: true, pausedAt: true, archivedAt: true },
    });
  });

  it("devolve o log à fila se a campanha muda entre a leitura e a reversão", async () => {
    revertSetup({ name: "Black Friday" });
    mocks.campaignUpdate.mockResolvedValue({ count: 0 });

    expect(await revert()).toEqual({ ok: false, error: expect.stringContaining("mudou durante o desfazer") });
    expect(mocks.logUpdate).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { revertedAt: null, revertedById: null, revertedByEmail: null },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("limpa a pausa ao desfazer uma edição que trouxe o início para o passado", async () => {
    revertSetup({ startsAt: "2026-11-20T03:00:00.000Z" }, PAUSED);

    expect((await revert()).ok).toBe(true);
    expect(mocks.campaignUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { startsAt: new Date("2026-11-20T03:00:00.000Z"), pausedAt: null },
    }));
  });

  describe("recusas do desfazer", () => {
    /** A recusa não escreve na campanha, não audita a reversão e devolve o log à fila de pendentes. */
    function expectRefused(result: Awaited<ReturnType<typeof revert>>, message: RegExp) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(message);
      expect(mocks.campaignUpdate).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
      // O log reservado volta a "pendente": a recusa não pode marcá-lo como desfeito.
      expect(mocks.logUpdate).toHaveBeenCalledWith({
        where: { id: "log-1" },
        data: { revertedAt: null, revertedById: null, revertedByEmail: null },
      });
    }

    it("campanha arquivada: recusa, em português simples", async () => {
      revertSetup({ name: "Black Friday" }, ARCHIVED);
      const result = await revert();
      expectRefused(result, /arquivada e fica só para consulta/);
    });

    it("campanha terminada (passou do fim): recusa — nem para prorrogar o fim pelo desfazer", async () => {
      revertSetup({ endsAt: "2026-12-31T02:59:59.000Z" }, FINISHED);
      const result = await revert();
      expectRefused(result, /já terminou e fica só para consulta/);
    });

    it("terminada que também estava pausada é terminada: recusa", async () => {
      revertSetup({ name: "Black Friday" }, { ...FINISHED, ...PAUSED });
      expectRefused(await revert(), /já terminou/);
    });

    it("arquivada que também já passou do fim diz que está arquivada (arquivada vence)", async () => {
      revertSetup({ name: "Black Friday" }, { ...ARCHIVED, ...FINISHED });
      expectRefused(await revert(), /arquivada/);
    });

    it("o desfazer deixaria o fim antes do início de hoje: recusa", async () => {
      // Hoje a campanha começa em 01/11; o evento restauraria o fim para 25/10.
      revertSetup({ endsAt: "2026-10-25T02:59:59.000Z" });
      expectRefused(await revert(), /fim da campanha antes do início/);
    });

    it("o desfazer restauraria um início depois do fim de hoje: recusa", async () => {
      // Hoje a campanha termina em 30/11; o evento restauraria o início para 20/12.
      revertSetup({ startsAt: "2026-12-20T03:00:00.000Z" });
      expectRefused(await revert(), /fim da campanha antes do início/);
    });

    it("o desfazer restauraria início e fim juntos, e o fim ficaria antes: recusa", async () => {
      revertSetup({ startsAt: "2026-12-20T03:00:00.000Z", endsAt: "2026-12-10T02:59:59.000Z" });
      expectRefused(await revert(), /fim da campanha antes do início/);
    });

    it("a recusa por período diz como seguir (ajustar as datas na campanha)", async () => {
      revertSetup({ endsAt: "2026-10-25T02:59:59.000Z" });
      const result = await revert();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/Ajuste as datas/);
    });
  });

  describe("desfazer que continua valendo", () => {
    it.each([
      ["rascunho", DRAFT],
      ["ativa", {}],
      ["pausada", PAUSED],
    ])("campanha %s aceita o desfazer", async (_label, current) => {
      revertSetup({ name: "Black Friday" }, current);
      expect((await revert()).ok).toBe(true);
      expect(mocks.campaignUpdate).toHaveBeenCalledTimes(1);
    });

    it("restaurar o fim para o mesmo dia do início de hoje vale (campanha de um dia)", async () => {
      revertSetup({ endsAt: "2026-11-01T14:59:59.000Z" }); // 01/11 11:59 em São Paulo, depois do início 00:00
      expect((await revert()).ok).toBe(true);
    });

    it("restaurar 'sem início' (null) vale: a campanha volta a ser rascunho", async () => {
      revertSetup({ startsAt: null, endsAt: "2026-12-01T02:59:59.000Z" });
      expect((await revert()).ok).toBe(true);
      expect(mocks.campaignUpdate.mock.calls[0][0].data).toMatchObject({ startsAt: null });
    });

    it("restaurar 'sem fim' (null) vale", async () => {
      revertSetup({ endsAt: null });
      expect((await revert()).ok).toBe(true);
    });

    it("a conferência é só da campanha: os outros modelos seguem sem guarda extra", async () => {
      // Um evento de agente: o `findUnique` continua pedindo só o id.
      mocks.logFind.mockResolvedValue({
        id: "log-2",
        event: "agent.updated",
        revertible: true,
        revertedAt: null,
        targetType: "Agent",
        targetId: "agent-1",
        targetLabel: "Vendas",
        tenantId: "tenant-a",
        before: { name: "Vendas antigo" },
        after: { name: "Vendas" },
      });
      mocks.logClaim.mockResolvedValue({ count: 1 });
      mocks.logFindFirst.mockResolvedValue(null);
      mocks.logUpdate.mockResolvedValue({});
      mocks.agentFind.mockResolvedValue({ id: "agent-1" });
      mocks.agentUpdate.mockResolvedValue({});

      const result = await revertAuditLog("log-2", { id: "admin-1", email: "admin@example.test" });

      expect(result.ok).toBe(true);
      expect(mocks.agentFind).toHaveBeenCalledWith({ where: { id: "agent-1" }, select: { id: true } });
      expect(mocks.agentUpdate).toHaveBeenCalledWith({ where: { id: "agent-1" }, data: { name: "Vendas antigo" } });
    });
  });
});
