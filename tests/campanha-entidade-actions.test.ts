import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CMP-01 — as actions e as consultas de campanha, com o Prisma trocado por
 * mocks (estilo de `disparos-access.test.ts`). O que se trava aqui:
 *
 * - o tenant vem da sessão, nunca do formulário;
 * - id de outra conta é "não encontrada", sem escrita e sem auditoria;
 * - terminada e arquivada ficam só para leitura;
 * - cada mutação grava o evento certo na trilha;
 * - sem permissão (`canEdit` falso) ou com o guarda redirecionando, nada acontece.
 */

const mocks = vi.hoisted(() => ({
  product: vi.fn(),
  canEdit: { value: true },
  tooLarge: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
  tenantFind: vi.fn(),
  campaignFindUnique: vi.fn(),
  campaignUpdate: vi.fn(),
  logFind: vi.fn(),
  logClaim: vi.fn(),
  logUpdate: vi.fn(),
  logFindFirst: vi.fn(),
  agentFind: vi.fn(),
  agentUpdate: vi.fn(),
  audit: vi.fn(),
  change: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/require-product", () => ({ requireProductAccess: mocks.product }));
// A permissão é a única parte trocada: o resto de `access.ts` é o real. É assim
// que se simula o "só o dono ou um administrador edita" que a SEG-05 vai trazer.
vi.mock("@/modules/campaigns/access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/campaigns/access")>();
  return {
    ...original,
    requireCampaignActor: async () => ({ ...(await original.requireCampaignActor()), canEdit: mocks.canEdit.value }),
  };
});
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: mocks.tooLarge }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
// As páginas chamam `notFound()` e os componentes de cliente importam `useRouter`
// (só importam: aqui nada é renderizado).
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/campanhas",
}));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit, recordChange: mocks.change }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      create: mocks.create,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      count: mocks.count,
      findUnique: mocks.campaignFindUnique,
      update: mocks.campaignUpdate,
    },
    tenant: { findUnique: mocks.tenantFind },
    agent: { findUnique: mocks.agentFind, update: mocks.agentUpdate },
    auditLog: {
      findUnique: mocks.logFind,
      updateMany: mocks.logClaim,
      update: mocks.logUpdate,
      findFirst: mocks.logFindFirst,
    },
  },
}));

import {
  archiveCampaign,
  createCampaign,
  pauseCampaign,
  resumeCampaign,
  unarchiveCampaign,
  updateCampaign,
} from "@/app/(dashboard)/campanhas/actions";
import { requireCampaignActor } from "@/modules/campaigns/access";
import { countCampaigns, getCampaign, hasMetaBroadcasts, listCampaigns } from "@/modules/campaigns/queries";
import { CAMPAIGN_STATUS_FILTERS, CAMPAIGN_STATUSES, campaignStatus } from "@/modules/campaigns/status";
import { AUDIT_EVENTS, eventLabel, isRevertibleEvent, type AuditEventDef } from "@/modules/audit/events";
import { isRevertibleTarget, revertAuditLog } from "@/modules/audit/revert";

const NOW = new Date("2026-11-15T15:00:00.000Z");
const START = new Date("2026-11-01T03:00:00.000Z");
const END = new Date("2026-12-01T02:59:59.000Z");

/** Linha do banco: por padrão uma campanha ATIVA em 15/11/2026. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "camp-1",
  tenantId: "tenant-a",
  name: "Black Friday",
  objective: "Encher a agenda de novembro",
  startsAt: START,
  endsAt: END,
  timezone: "America/Sao_Paulo",
  pausedAt: null,
  archivedAt: null,
  createdById: "user-a",
  createdAt: new Date("2026-10-20T12:00:00.000Z"),
  updatedAt: new Date("2026-10-20T12:00:00.000Z"),
  ...over,
});

const DRAFT = { startsAt: null, endsAt: null };
const PAUSED = { pausedAt: new Date("2026-11-10T12:00:00.000Z") };
const FINISHED = { endsAt: new Date("2026-11-10T02:59:59.000Z") };
const ARCHIVED = { archivedAt: new Date("2026-11-12T12:00:00.000Z") };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const FILLED = { name: "Black Friday", objective: "Encher a agenda de novembro", startsOn: "2026-11-01", endsOn: "2026-11-30" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.canEdit.value = true;
  mocks.product.mockResolvedValue({
    session: { user: { tenantId: "tenant-a", id: "user-a", email: "dono@example.test", name: "Dono" } },
  });
  mocks.tooLarge.mockReturnValue(null);
  mocks.create.mockResolvedValue(row({ id: "camp-new" }));
  mocks.findFirst.mockResolvedValue(row());
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.count.mockResolvedValue(0);
  mocks.tenantFind.mockResolvedValue({ metaWhatsappEnabled: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("criar campanha", () => {
  it("grava o tenant e o usuário da SESSÃO e ignora o que o formulário disser", async () => {
    const result = await createCampaign(
      null,
      form({ ...FILLED, tenantId: "tenant-b", createdById: "user-b", status: "active", timezone: "UTC" }),
    );

    expect(result).toEqual({ ok: true, id: "camp-new" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-a",
        name: "Black Friday",
        objective: "Encher a agenda de novembro",
        startsAt: START,
        endsAt: END,
        timezone: "America/Sao_Paulo",
        createdById: "user-a",
      },
    });
  });

  it("sem datas nasce como rascunho: início e fim nulos, e o fuso padrão gravado", async () => {
    await createCampaign(null, form({ name: "Rascunho livre" }));
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ startsAt: null, endsAt: null, objective: null, timezone: "America/Sao_Paulo" }),
    });
  });

  it("converte o dia da tela em instante UTC (início 03:00Z, fim 02:59:59Z do dia seguinte)", async () => {
    await createCampaign(null, form({ name: "Natal", startsOn: "2026-12-01", endsOn: "2026-12-24" }));
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.startsAt.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(data.endsAt.toISOString()).toBe("2026-12-25T02:59:59.000Z");
  });

  it("audita como campaign.created, com o nome da campanha", async () => {
    await createCampaign(null, form(FILLED));
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "campaign.created",
        target: { type: "Campaign", id: "camp-new", label: "Black Friday" },
      }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/campanhas");
  });

  it("recusa dados inválidos por campo, sem gravar nem auditar", async () => {
    const result = await createCampaign(null, form({ name: "", startsOn: "2026-11-30", endsOn: "2026-11-01" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("validation");
    expect(result.fieldErrors).toEqual({
      name: "Dê um nome à campanha.",
      endsOn: expect.stringMatching(/antes do início/),
    });
    expect(result.error).toBe("Dê um nome à campanha.");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("recusa o fim antes do início", async () => {
    const result = await createCampaign(null, form({ name: "Natal", startsOn: "2026-12-24", endsOn: "2026-12-01" }));
    expect(result).toMatchObject({ ok: false, code: "validation", fieldErrors: { endsOn: expect.any(String) } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("recusa formulário grande demais antes de ler qualquer campo", async () => {
    mocks.tooLarge.mockReturnValue("Os dados enviados são grandes demais para esta operação.");
    const result = await createCampaign(null, form(FILLED));
    expect(result.ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("falha do banco vira mensagem de gente, sem auditoria", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.create.mockRejectedValue(new Error("connection refused"));
    const result = await createCampaign(null, form(FILLED));
    expect(result).toMatchObject({ ok: false, code: "server" });
    expect(result.error).not.toMatch(/connection|refused/i);
    expect(mocks.audit).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("editar campanha", () => {
  const edit = (over: Record<string, string> = {}) =>
    updateCampaign(null, form({ id: "camp-1", ...FILLED, name: "Black Friday 2026", ...over }));

  it("grava só nome, objetivo e datas, pelo id E pelo tenant da sessão", async () => {
    const result = await edit({ tenantId: "tenant-b" });

    expect(result).toEqual({ ok: true, id: "camp-1" });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "camp-1", tenantId: "tenant-a" } });
    // O `archivedAt: null` é a condição de estado: arquivada no meio da edição não é editada.
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "camp-1", tenantId: "tenant-a", archivedAt: null },
      data: { name: "Black Friday 2026", objective: "Encher a agenda de novembro", startsAt: START, endsAt: END },
    });
  });

  it("audita como campaign.updated com o antes e o depois", async () => {
    await edit();
    expect(mocks.change).toHaveBeenCalledTimes(1);
    expect(mocks.change).toHaveBeenCalledWith({
      event: "campaign.updated",
      target: { type: "Campaign", id: "camp-1", label: "Black Friday 2026" },
      before: { name: "Black Friday", objective: "Encher a agenda de novembro", startsAt: START, endsAt: END },
      after: { name: "Black Friday 2026", objective: "Encher a agenda de novembro", startsAt: START, endsAt: END },
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/campanhas");
    expect(mocks.revalidate).toHaveBeenCalledWith("/campanhas/camp-1");
  });

  it("lê as datas novas no fuso GRAVADO na campanha, não no padrão", async () => {
    mocks.findFirst.mockResolvedValue(row({ timezone: "America/Manaus" }));
    await edit({ startsOn: "2026-11-02", endsOn: "2026-11-30" });
    const data = mocks.updateMany.mock.calls[0][0].data;
    expect(data.startsAt.toISOString()).toBe("2026-11-02T04:00:00.000Z");
    expect(data.endsAt.toISOString()).toBe("2026-12-01T03:59:59.000Z");
  });

  it.each([
    ["rascunho", DRAFT],
    ["ativa", {}],
    ["pausada", PAUSED],
  ])("campanha %s pode ser editada", async (_label, over) => {
    mocks.findFirst.mockResolvedValue(row(over));
    expect((await edit()).ok).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("campanha de OUTRA conta: não encontrada, sem escrita e sem auditoria", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await updateCampaign(null, form({ id: "camp-de-outra-conta", ...FILLED }));
    expect(result).toEqual({ ok: false, error: "Campanha não encontrada." });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "camp-de-outra-conta", tenantId: "tenant-a" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("achou a campanha mas o updateMany não casou (o estado mudou no meio): 'o status mudou', sem auditoria", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const result = await edit();
    expect(result).toEqual({ ok: false, error: "O status da campanha mudou. Atualize a página e tente de novo." });
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("id ausente ou que não é texto nunca chega ao banco", async () => {
    expect((await updateCampaign(null, form({ ...FILLED }))).error).toBe("Campanha não encontrada.");
    expect((await updateCampaign(null, form({ id: "", ...FILLED }))).error).toBe("Campanha não encontrada.");
    const withFile = new FormData();
    withFile.set("id", new File(["x"], "x.txt"));
    expect((await updateCampaign(null, withFile)).error).toBe("Campanha não encontrada.");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("campanha terminada não aceita edição (nem para prorrogar o fim)", async () => {
    mocks.findFirst.mockResolvedValue(row(FINISHED));
    const result = await edit({ endsOn: "2026-12-31" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/terminada/);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it("terminada pela passagem do fim é terminada mesmo estando pausada", async () => {
    mocks.findFirst.mockResolvedValue(row({ ...FINISHED, ...PAUSED }));
    expect((await edit()).ok).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("campanha arquivada não aceita edição", async () => {
    mocks.findFirst.mockResolvedValue(row(ARCHIVED));
    const result = await edit();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/arquivada/);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("recusa o fim antes do início, sem escrever", async () => {
    const result = await edit({ startsOn: "2026-11-30", endsOn: "2026-11-01" });
    expect(result).toMatchObject({ ok: false, code: "validation", fieldErrors: { endsOn: expect.any(String) } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("nada mudou: responde ok sem gravar e sem lotar a trilha", async () => {
    const result = await updateCampaign(null, form({ id: "camp-1", ...FILLED }));
    expect(result).toEqual({ ok: true, id: "camp-1", info: "Nenhuma alteração para salvar." });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });
});

/**
 * A pausa só vale dentro do período. Editar uma campanha pausada para que ela
 * deixe de ter começado não pode deixar a pausa gravada: quando a data chegasse
 * a campanha reapareceria "Pausada" sem ninguém ter pausado.
 */
describe("editar o período de uma campanha pausada", () => {
  const edit = (over: Record<string, string>) =>
    updateCampaign(null, form({ id: "camp-1", ...FILLED, name: "Black Friday 2026", ...over }));
  const written = () => mocks.updateMany.mock.calls[0][0].data as Record<string, unknown>;

  beforeEach(() => {
    mocks.findFirst.mockResolvedValue(row(PAUSED));
  });

  it("início no futuro: a pausa sai junto com a edição (pausedAt: null)", async () => {
    const result = await edit({ startsOn: "2026-12-10", endsOn: "2026-12-31" });

    expect(result.ok).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "camp-1", tenantId: "tenant-a", archivedAt: null },
      data: {
        name: "Black Friday 2026",
        objective: "Encher a agenda de novembro",
        startsAt: new Date("2026-12-10T03:00:00.000Z"),
        endsAt: new Date("2027-01-01T02:59:59.000Z"),
        pausedAt: null,
      },
    });
  });

  it("sem data de início: a campanha volta a ser rascunho e a pausa sai", async () => {
    await edit({ startsOn: "", endsOn: "" });
    expect(written()).toMatchObject({ startsAt: null, endsAt: null, pausedAt: null });
  });

  it("início amanhã já é futuro: a pausa sai", async () => {
    await edit({ startsOn: "2026-11-16" });
    expect(written()).toHaveProperty("pausedAt", null);
  });

  it("o registro fica na trilha, no contexto do evento — fora do antes/depois que o desfazer usa", async () => {
    await edit({ startsOn: "2026-12-10", endsOn: "2026-12-31" });
    const call = mocks.change.mock.calls[0][0];
    expect(call.meta).toEqual({ pausaRemovida: true });
    expect(call.before).not.toHaveProperty("pausedAt");
    expect(call.after).not.toHaveProperty("pausedAt");
  });

  it("início que continua no passado: a pausa é mantida (nenhum pausedAt é escrito)", async () => {
    await edit({ startsOn: "2026-11-05", endsOn: "2026-11-30" });
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(written()).not.toHaveProperty("pausedAt");
    expect(mocks.change.mock.calls[0][0]).not.toHaveProperty("meta");
  });

  it("início hoje já começou: a pausa é mantida", async () => {
    await edit({ startsOn: "2026-11-15" });
    expect(written()).not.toHaveProperty("pausedAt");
  });

  it("mudar só o nome ou o fim não mexe na pausa", async () => {
    await edit({});
    expect(written()).not.toHaveProperty("pausedAt");

    mocks.updateMany.mockClear();
    await edit({ endsOn: "2026-12-15" });
    expect(written()).not.toHaveProperty("pausedAt");
  });

  it("campanha que não estava pausada nunca ganha pausedAt na edição", async () => {
    mocks.findFirst.mockResolvedValue(row());
    await edit({ startsOn: "2026-12-10", endsOn: "2026-12-31" });
    expect(written()).not.toHaveProperty("pausedAt");
  });

  it("o efeito que importa: depois de editar, a campanha NÃO reaparece pausada quando o início chega", async () => {
    const before = row(PAUSED);
    mocks.findFirst.mockResolvedValue(before);
    await edit({ startsOn: "2026-12-10", endsOn: "2026-12-31" });

    const stored = { ...before, ...written() } as unknown as Parameters<typeof campaignStatus>[0];
    // Hoje (15/11) ela voltou a ser rascunho...
    expect(campaignStatus(stored, NOW)).toBe("draft");
    // ...e no meio da campanha nova está ativa, não pausada.
    expect(campaignStatus(stored, new Date("2026-12-20T15:00:00.000Z"))).toBe("active");
    // Sem a limpeza, o mesmo dia mostraria "paused".
    expect(campaignStatus({ ...stored, pausedAt: PAUSED.pausedAt }, new Date("2026-12-20T15:00:00.000Z"))).toBe("paused");
  });
});

describe("pausar, retomar, arquivar e desarquivar", () => {
  type Case = {
    name: string;
    run: (id: string) => ReturnType<typeof pauseCampaign>;
    event: string;
    from: Record<string, unknown>;
    /** A condição de estado que o `updateMany` leva além de id e tenantId. */
    onlyIf: Record<string, unknown>;
    data: Record<string, unknown>;
    statusBefore: string;
    statusAfter: string;
  };

  const cases: Case[] = [
    { name: "pausar", run: pauseCampaign, event: "campaign.paused", from: {}, onlyIf: { archivedAt: null, pausedAt: null }, data: { pausedAt: NOW }, statusBefore: "active", statusAfter: "paused" },
    { name: "retomar", run: resumeCampaign, event: "campaign.resumed", from: PAUSED, onlyIf: { archivedAt: null, pausedAt: { not: null } }, data: { pausedAt: null }, statusBefore: "paused", statusAfter: "active" },
    { name: "arquivar", run: archiveCampaign, event: "campaign.archived", from: {}, onlyIf: { archivedAt: null }, data: { archivedAt: NOW }, statusBefore: "active", statusAfter: "archived" },
    { name: "desarquivar", run: unarchiveCampaign, event: "campaign.unarchived", from: ARCHIVED, onlyIf: { archivedAt: { not: null } }, data: { archivedAt: null }, statusBefore: "archived", statusAfter: "active" },
  ];

  it.each(cases)("$name: escreve pelo id, pelo tenant da sessão e pelo estado em que leu, e audita $event", async (c) => {
    mocks.findFirst.mockResolvedValue(row(c.from));
    const result = await c.run("camp-1");

    expect(result.ok).toBe(true);
    expect(result.id).toBe("camp-1");
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "camp-1", tenantId: "tenant-a" } });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "camp-1", tenantId: "tenant-a", ...c.onlyIf },
      data: c.data,
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith({
      event: c.event,
      target: { type: "Campaign", id: "camp-1", label: "Black Friday" },
      before: { status: c.statusBefore },
      after: { status: c.statusAfter },
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/campanhas");
    expect(mocks.revalidate).toHaveBeenCalledWith("/campanhas/camp-1");
  });

  it.each(cases)("$name: campanha de OUTRA conta é 'não encontrada', sem escrita e sem auditoria", async (c) => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await c.run("camp-de-outra-conta")).toEqual({ ok: false, error: "Campanha não encontrada." });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "camp-de-outra-conta", tenantId: "tenant-a" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(cases)("$name: achou a campanha mas o updateMany não casou (estado mudou no meio): 'o status mudou', sem auditoria", async (c) => {
    mocks.findFirst.mockResolvedValue(row(c.from));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect(await c.run("camp-1")).toEqual({
      ok: false,
      error: "O status da campanha mudou. Atualize a página e tente de novo.",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("id que não é texto nunca chega ao banco", async () => {
    for (const run of [pauseCampaign, resumeCampaign, archiveCampaign, unarchiveCampaign]) {
      expect((await run(undefined as never)).error).toBe("Campanha não encontrada.");
      expect((await run({ $ne: "" } as never)).error).toBe("Campanha não encontrada.");
    }
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  describe("só pausa quem está ativa", () => {
    it.each([
      ["rascunho", DRAFT, /não começou/],
      ["já pausada", PAUSED, /já está pausada/],
      ["terminada", FINISHED, /terminada/],
      ["arquivada", ARCHIVED, /arquivada/],
    ])("recusa pausar campanha %s", async (_label, over, message) => {
      mocks.findFirst.mockResolvedValue(row(over));
      const result = await pauseCampaign("camp-1");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(message);
      expect(mocks.updateMany).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("pausada que passou do fim está terminada: não pausa nem retoma", async () => {
      mocks.findFirst.mockResolvedValue(row({ ...PAUSED, ...FINISHED }));
      expect((await pauseCampaign("camp-1")).ok).toBe(false);
      expect((await resumeCampaign("camp-1")).ok).toBe(false);
      expect(mocks.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("só retoma quem está pausada", () => {
    it.each([
      ["rascunho", DRAFT],
      ["ativa", {}],
      ["terminada", FINISHED],
      ["arquivada", ARCHIVED],
    ])("recusa retomar campanha %s", async (_label, over) => {
      mocks.findFirst.mockResolvedValue(row(over));
      expect((await resumeCampaign("camp-1")).ok).toBe(false);
      expect(mocks.updateMany).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });
  });

  describe("arquivar e desarquivar", () => {
    it.each([
      ["rascunho", DRAFT],
      ["ativa", {}],
      ["pausada", PAUSED],
      ["terminada", FINISHED],
    ])("arquiva campanha %s (terminada também: é como se tira da lista)", async (_label, over) => {
      mocks.findFirst.mockResolvedValue(row(over));
      expect((await archiveCampaign("camp-1")).ok).toBe(true);
      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: { id: "camp-1", tenantId: "tenant-a", archivedAt: null },
        data: { archivedAt: NOW },
      });
    });

    it("recusa arquivar duas vezes e desarquivar o que não está arquivado", async () => {
      mocks.findFirst.mockResolvedValue(row(ARCHIVED));
      expect((await archiveCampaign("camp-1")).error).toMatch(/já está arquivada/);
      mocks.findFirst.mockResolvedValue(row());
      expect((await unarchiveCampaign("camp-1")).error).toMatch(/não está arquivada/);
      expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it("desarquivar uma campanha vencida volta como terminada, não como ativa", async () => {
      mocks.findFirst.mockResolvedValue(row({ ...ARCHIVED, ...FINISHED }));
      expect((await unarchiveCampaign("camp-1")).ok).toBe(true);
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ before: { status: "archived" }, after: { status: "finished" } }),
      );
    });

    it("desarquivar uma campanha pausada volta pausada", async () => {
      mocks.findFirst.mockResolvedValue(row({ ...ARCHIVED, ...PAUSED }));
      await unarchiveCampaign("camp-1");
      expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ after: { status: "paused" } }));
    });
  });
});

/**
 * Corrida entre duas escritas. O banco de mentira abaixo aplica o `where` do
 * `updateMany` de verdade (igualdade e `null`/`{ not: null }`) sobre a linha
 * que está "gravada" — enquanto a LEITURA devolve a foto antiga, como quem leu
 * antes de a outra aba escrever. Sem a condição de estado no `where`, a
 * segunda escrita passaria por cima da primeira.
 */
describe("concorrência — a escrita só vale no estado em que a leitura viu a campanha", () => {
  type Stored = Record<string, unknown>;

  function rowMatches(where: Record<string, unknown>, stored: Stored): boolean {
    return Object.entries(where).every(([key, condition]) => {
      const value = stored[key] ?? null;
      if (condition === null) return value === null;
      if (typeof condition === "object" && condition !== null && "not" in condition) return value !== null;
      return value === condition;
    });
  }

  /** A linha "no banco", e o updateMany que só escreve se o where casar com ela. */
  function database(initial: Stored) {
    let stored = { ...initial };
    mocks.updateMany.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Stored }) => {
      if (!rowMatches(where, stored)) return { count: 0 };
      stored = { ...stored, ...data };
      return { count: 1 };
    });
    return { read: () => stored };
  }

  const CHANGED = { ok: false, error: "O status da campanha mudou. Atualize a página e tente de novo." };

  it("duas pessoas pausam ao mesmo tempo: uma pausa, a outra é avisada, e só uma auditoria", async () => {
    const db = database(row());
    mocks.findFirst.mockResolvedValue(row()); // as duas leram a campanha ativa

    const [first, second] = await Promise.all([pauseCampaign("camp-1"), pauseCampaign("camp-1")]);

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect([first, second].find((r) => !r.ok)).toEqual(CHANGED);
    expect(db.read().pausedAt).toEqual(NOW);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("arquivada em outra aba antes de pausar: a pausa não é gravada na arquivada", async () => {
    const db = database(row(ARCHIVED));
    mocks.findFirst.mockResolvedValue(row()); // a leitura ainda via a campanha ativa

    expect(await pauseCampaign("camp-1")).toEqual(CHANGED);
    expect(db.read().pausedAt).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("duas pessoas retomam ao mesmo tempo: uma retoma, a outra é avisada", async () => {
    const db = database(row(PAUSED));
    mocks.findFirst.mockResolvedValue(row(PAUSED));

    const [first, second] = await Promise.all([resumeCampaign("camp-1"), resumeCampaign("camp-1")]);

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(db.read().pausedAt).toBeNull();
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("retomar uma campanha que acabou de ser arquivada não mexe nela", async () => {
    const db = database(row({ ...PAUSED, ...ARCHIVED }));
    mocks.findFirst.mockResolvedValue(row(PAUSED)); // leu antes do arquivamento

    expect(await resumeCampaign("camp-1")).toEqual(CHANGED);
    expect(db.read().pausedAt).toEqual(PAUSED.pausedAt);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("duas pessoas arquivam ao mesmo tempo: fica a data da primeira, e só uma auditoria", async () => {
    const db = database(row());
    mocks.findFirst.mockResolvedValue(row());

    const [first, second] = await Promise.all([archiveCampaign("camp-1"), archiveCampaign("camp-1")]);

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(db.read().archivedAt).toEqual(NOW);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("desarquivada em outra aba antes de desarquivar de novo: nada é escrito", async () => {
    const db = database(row());
    mocks.findFirst.mockResolvedValue(row(ARCHIVED)); // leu a campanha ainda arquivada

    expect(await unarchiveCampaign("camp-1")).toEqual(CHANGED);
    expect(db.read().archivedAt).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("arquivada em outra aba no meio de uma edição: a edição não é gravada", async () => {
    const db = database(row(ARCHIVED));
    mocks.findFirst.mockResolvedValue(row()); // abriu a edição com a campanha ativa

    const result = await updateCampaign(null, form({ id: "camp-1", ...FILLED, name: "Nome novo" }));

    expect(result).toEqual(CHANGED);
    expect(db.read().name).toBe("Black Friday");
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("campanha de OUTRA conta continua 'não encontrada': a corrida não vaza que o id existe", async () => {
    database(row({ tenantId: "tenant-b" }));
    // A leitura filtra pelo tenant da sessão: de outra conta, nem chega ao updateMany.
    mocks.findFirst.mockResolvedValue(null);

    for (const run of [pauseCampaign, resumeCampaign, archiveCampaign, unarchiveCampaign]) {
      expect(await run("camp-1")).toEqual({ ok: false, error: "Campanha não encontrada." });
    }
    expect(await updateCampaign(null, form({ id: "camp-1", ...FILLED }))).toEqual({
      ok: false,
      error: "Campanha não encontrada.",
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("acesso e permissão", () => {
  const everyAction = [
    ["createCampaign", () => createCampaign(null, form(FILLED))],
    ["updateCampaign", () => updateCampaign(null, form({ id: "camp-1", ...FILLED }))],
    ["pauseCampaign", () => pauseCampaign("camp-1")],
    ["resumeCampaign", () => resumeCampaign("camp-1")],
    ["archiveCampaign", () => archiveCampaign("camp-1")],
    ["unarchiveCampaign", () => unarchiveCampaign("camp-1")],
  ] as const;

  it.each(everyAction)("%s: sem permissão (canEdit falso) recusa, e nada é lido nem escrito", async (_name, run) => {
    mocks.canEdit.value = false;
    const result = await run();
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(result.error).toMatch(/dono ou um administrador/);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it.each(everyAction)("%s: o guarda do produto redirecionando (quem só é afiliado) bloqueia a action", async (_name, run) => {
    mocks.product.mockRejectedValue(new Error("REDIRECT:/afiliado"));
    await expect(run()).rejects.toThrow("REDIRECT:/afiliado");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("o ator vem da sessão: tenant, usuário e rótulo (e-mail, senão nome, senão id)", async () => {
    const { requireCampaignActor: real } = await vi.importActual<typeof import("@/modules/campaigns/access")>(
      "@/modules/campaigns/access",
    );
    expect(await real()).toEqual({ tenantId: "tenant-a", userId: "user-a", label: "dono@example.test", canEdit: true });

    mocks.product.mockResolvedValue({ session: { user: { tenantId: "t", id: "u", email: null, name: "Maria" } } });
    expect((await real()).label).toBe("Maria");
    mocks.product.mockResolvedValue({ session: { user: { tenantId: "t", id: "u", email: null, name: null } } });
    expect((await real()).label).toBe("u");
  });

  it("repassa o redirect do guarda do produto (a página não chega a consultar nada)", async () => {
    mocks.product.mockRejectedValue(new Error("REDIRECT:/afiliado"));
    await expect(requireCampaignActor()).rejects.toThrow("REDIRECT:/afiliado");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe("páginas — guarda do produto e conta da sessão", () => {
  const redirecting = () => mocks.product.mockRejectedValue(new Error("REDIRECT:/afiliado"));

  // Importadas uma vez, com folga: as páginas puxam os componentes de UI, e o
  // primeiro import não pode estourar o tempo de um teste qualquer.
  let Layout: typeof import("@/app/(dashboard)/campanhas/layout").default;
  let ListPage: typeof import("@/app/(dashboard)/campanhas/page").default;
  let DetailPage: typeof import("@/app/(dashboard)/campanhas/[id]/page").default;
  beforeAll(async () => {
    [Layout, ListPage, DetailPage] = await Promise.all([
      import("@/app/(dashboard)/campanhas/layout").then((m) => m.default),
      import("@/app/(dashboard)/campanhas/page").then((m) => m.default),
      import("@/app/(dashboard)/campanhas/[id]/page").then((m) => m.default),
    ]);
  }, 30_000);

  it("o layout bloqueia (quem só é afiliado vai para o painel de afiliado)", async () => {
    redirecting();
    await expect(Layout({ children: null })).rejects.toThrow("REDIRECT:/afiliado");
    // Com acesso, o layout deixa passar.
    mocks.product.mockResolvedValue({ session: { user: { tenantId: "tenant-a", id: "user-a" } } });
    await expect(Layout({ children: null })).resolves.toBeTruthy();
  });

  it("a lista bloqueia antes de consultar qualquer coisa", async () => {
    redirecting();
    await expect(ListPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/afiliado");
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("o detalhe bloqueia antes de consultar qualquer coisa", async () => {
    redirecting();
    await expect(DetailPage({ params: Promise.resolve({ id: "camp-1" }) })).rejects.toThrow("REDIRECT:/afiliado");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("a lista consulta pelo tenant da sessão e pelo filtro da URL", async () => {
    await ListPage({ searchParams: Promise.resolve({ status: "paused" }) });
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a", pausedAt: { not: null } });
    for (const [args] of mocks.count.mock.calls) expect(args.where.tenantId).toBe("tenant-a");
  });

  it("filtro inválido na URL cai em 'todas' (sem arquivadas), nunca num erro", async () => {
    await ListPage({ searchParams: Promise.resolve({ status: "qualquer-coisa" }) });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", archivedAt: null });
  });

  it("o detalhe de campanha de OUTRA conta é 404, igual a um id que não existe", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(DetailPage({ params: Promise.resolve({ id: "camp-de-outra-conta" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "camp-de-outra-conta", tenantId: "tenant-a" } }),
    );
  });

  it("o detalhe da própria campanha abre (e `canEdit` falso esconde os botões)", async () => {
    mocks.findFirst.mockResolvedValue({ ...row(), createdBy: { name: "Dono", email: "dono@example.test" } });
    const open = await DetailPage({ params: Promise.resolve({ id: "camp-1" }) });
    expect(open.props).toMatchObject({ canEdit: true, notice: null, campaign: { id: "camp-1", status: "active" } });

    mocks.canEdit.value = false;
    const readOnly = await DetailPage({ params: Promise.resolve({ id: "camp-1" }) });
    expect(readOnly.props.canEdit).toBe(false);
  });

  it("terminada e arquivada abrem com o aviso de 'só para consulta' e sem ações de edição", async () => {
    mocks.findFirst.mockResolvedValue({ ...row(FINISHED), createdBy: null });
    const finished = await DetailPage({ params: Promise.resolve({ id: "camp-1" }) });
    expect(finished.props.notice).toBe("Campanha terminada em 09/11/2026. Fica só para consulta e segue nos relatórios.");
    expect(finished.props.campaign.allowed).toMatchObject({ edit: false, pause: false, resume: false, archive: true });

    mocks.findFirst.mockResolvedValue({ ...row(ARCHIVED), createdBy: null });
    const archived = await DetailPage({ params: Promise.resolve({ id: "camp-1" }) });
    expect(archived.props.notice).toBe("Campanha arquivada. Fica só para consulta e segue nos relatórios.");
    expect(archived.props.campaign.allowed).toMatchObject({ edit: false, archive: false, unarchive: true });
  });
});

describe("consultas — uma conta nunca vê as campanhas de outra", () => {
  it("listCampaigns sempre leva o tenantId, em toda aba", async () => {
    for (const status of CAMPAIGN_STATUS_FILTERS) {
      mocks.findMany.mockClear();
      await listCampaigns("tenant-a", { status, now: NOW });
      expect(mocks.findMany).toHaveBeenCalledTimes(1);
      expect(mocks.findMany.mock.calls[0][0].where.tenantId, status).toBe("tenant-a");
    }
  });

  it("a aba é filtrada no banco, com o `now` do servidor, e a lista é limitada", async () => {
    await listCampaigns("tenant-a", { status: "paused", now: NOW });
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ tenantId: "tenant-a", archivedAt: null, pausedAt: { not: null }, startsAt: { lte: NOW } });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(200);
  });

  it("'todas' não traz as arquivadas; 'arquivadas' traz só elas", async () => {
    await listCampaigns("tenant-a", { now: NOW });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", archivedAt: null });
    await listCampaigns("tenant-a", { status: "archived", now: NOW });
    expect(mocks.findMany.mock.calls[1][0].where).toEqual({ tenantId: "tenant-a", archivedAt: { not: null } });
  });

  it("nenhuma consulta de listagem filtra por 'ativa' sem o usuário pedir (terminada continua existindo)", async () => {
    await listCampaigns("tenant-a", { now: NOW });
    const where = JSON.stringify(mocks.findMany.mock.calls[0][0].where);
    expect(where).not.toContain("endsAt");
    expect(where).not.toContain("pausedAt");
  });

  it("countCampaigns conta cada aba com o tenantId da sessão", async () => {
    mocks.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.archivedAt === null ? 3 : 1));
    const counts = await countCampaigns("tenant-a", NOW);
    expect(mocks.count).toHaveBeenCalledTimes(CAMPAIGN_STATUS_FILTERS.length);
    for (const [args] of mocks.count.mock.calls) expect(args.where.tenantId).toBe("tenant-a");
    expect(Object.keys(counts).sort()).toEqual([...CAMPAIGN_STATUS_FILTERS].sort());
    expect(counts.archived).toBe(1);
    expect(counts.all).toBe(3);
  });

  it("getCampaign procura pelo id E pelo tenantId, e devolve null quando não acha", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await getCampaign("tenant-a", "camp-de-outra-conta")).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "camp-de-outra-conta", tenantId: "tenant-a" } }),
    );
  });

  it("getCampaign traz só nome e e-mail de quem criou", async () => {
    await getCampaign("tenant-a", "camp-1");
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ include: { createdBy: { select: { name: true, email: true } } } }),
    );
  });

  it("getCampaign sem id não consulta o banco", async () => {
    expect(await getCampaign("tenant-a", "")).toBeNull();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("hasMetaBroadcasts lê a liberação da própria conta", async () => {
    expect(await hasMetaBroadcasts("tenant-a")).toBe(false);
    mocks.tenantFind.mockResolvedValue({ metaWhatsappEnabled: true });
    expect(await hasMetaBroadcasts("tenant-a")).toBe(true);
    mocks.tenantFind.mockResolvedValue(null);
    expect(await hasMetaBroadcasts("tenant-a")).toBe(false);
    expect(mocks.tenantFind).toHaveBeenCalledWith({ where: { id: "tenant-a" }, select: { metaWhatsappEnabled: true } });
  });

  it("os cinco estados têm aba própria", () => {
    expect([...CAMPAIGN_STATUS_FILTERS].sort()).toEqual(["all", ...CAMPAIGN_STATUSES].sort());
  });
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
      startsAt: START,
      endsAt: END,
      pausedAt: null,
      archivedAt: null,
      ...current,
    });
    mocks.campaignUpdate.mockResolvedValue({});
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
      where: { id: "camp-1" },
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
      where: { id: "camp-1" },
      select: { id: true, startsAt: true, endsAt: true, pausedAt: true, archivedAt: true },
    });
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
