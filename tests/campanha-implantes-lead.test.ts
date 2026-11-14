import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-01 — a regra provisória da campanha de implantes. `isCampaignLead` decide quem
 * é "lead da campanha" até 19/11/2026 23:59:59 (-03:00), com corte rígido, e nunca lança.
 */

type Override = {
  id: string;
  tenantId: string;
  key: string;
  adCodes: string[];
  adSourceIds: string[];
  broadcastCampaignIds: string[];
  leadIds: string[];
  startsAt: Date;
  endsAt: Date;
  rules: unknown;
  createdAt: Date;
};

const db = vi.hoisted(() => ({
  overrides: [] as unknown[],
  adOrigins: [] as { tenantId: string; leadId: string; code: string | null; sourceId: string | null }[],
  leads: [] as { id: string; tenantId: string; phone: string; conversationId: string | null }[],
  recipients: [] as {
    campaignId: string;
    campaignTenantId: string;
    phone: string;
    conversationId: string | null;
    status: string;
    isTest: boolean;
  }[],
  fail: false,
}));

vi.mock("@/lib/prisma", () => {
  const guard = () => {
    if (db.fail) throw new Error("banco fora do ar");
  };
  return {
    prisma: {
      campaignOverride: {
        findMany: vi.fn(async ({ where }: { where: { tenantId: string; startsAt: { lte: Date }; endsAt: { gte: Date } } }) => {
          guard();
          return (db.overrides as Override[]).filter(
            (o) => o.tenantId === where.tenantId && o.startsAt <= where.startsAt.lte && o.endsAt >= where.endsAt.gte,
          );
        }),
      },
      leadAdOrigin: {
        findMany: vi.fn(async ({ where }: { where: { tenantId: string; leadId: { in: string[] } } }) => {
          guard();
          return db.adOrigins.filter((o) => o.tenantId === where.tenantId && where.leadId.in.includes(o.leadId));
        }),
      },
      lead: {
        findMany: vi.fn(async ({ where }: { where: { tenantId: string; id: { in: string[] } } }) => {
          guard();
          return db.leads
            .filter((l) => l.tenantId === where.tenantId && where.id.in.includes(l.id))
            .map((l) => ({ id: l.id, phone: l.phone, conversation: l.conversationId ? { id: l.conversationId } : null }));
        }),
      },
      broadcastRecipient: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              campaignId: { in: string[] };
              campaign: { tenantId: string };
              isTest: boolean;
              status: { in: string[] };
              OR: [{ conversationId: { in: string[] } }, { phone: { in: string[] } }];
            };
          }) => {
            guard();
            return db.recipients.filter(
              (r) =>
                where.campaignId.in.includes(r.campaignId) &&
                r.campaignTenantId === where.campaign.tenantId &&
                r.isTest === where.isTest &&
                where.status.in.includes(r.status) &&
                ((r.conversationId && where.OR[0].conversationId.in.includes(r.conversationId)) || where.OR[1].phone.in.includes(r.phone)),
            );
          },
        ),
      },
    },
  };
});

import { campaignLeadOrigin, getCampaignOverrideForLead, isCampaignLead } from "@/modules/campaign-override/lead";
import { IMPLANTES_ENDS_AT, parseOverrideRules } from "@/modules/campaign-override/config";
import { buildOverrideUpdate } from "@/modules/campaign-override/update";

const TENANT = "t1";
const NOW = new Date("2026-11-13T15:00:00Z");

function override(patch: Partial<Override> = {}): Override {
  return {
    id: "o1",
    tenantId: TENANT,
    key: "implantes-2026-11",
    adCodes: ["AD27", "AD31"],
    adSourceIds: [],
    broadcastCampaignIds: [],
    leadIds: [],
    startsAt: new Date("2026-11-10T00:00:00Z"),
    endsAt: IMPLANTES_ENDS_AT,
    rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00" },
    createdAt: new Date("2026-11-10T00:00:00Z"),
    ...patch,
  };
}

beforeEach(() => {
  db.overrides = [override()];
  db.adOrigins = [];
  db.leads = [];
  db.recipients = [];
  db.fail = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isCampaignLead — anúncio", () => {
  it("código da lista é lead da campanha, sem diferença de maiúsculas", async () => {
    db.adOrigins = [{ tenantId: TENANT, leadId: "l1", code: "ad27", sourceId: null }];
    expect(await isCampaignLead(TENANT, "l1", NOW)).toBe(true);
    expect(await campaignLeadOrigin(TENANT, "l1", NOW)).toEqual({ kind: "anuncio", label: "anúncio AD27" });
  });

  it("id do anúncio da lista também vale", async () => {
    db.overrides = [override({ adCodes: [], adSourceIds: ["120251508234490338"] })];
    db.adOrigins = [{ tenantId: TENANT, leadId: "l1", code: null, sourceId: "120251508234490338" }];
    expect(await isCampaignLead(TENANT, "l1", NOW)).toBe(true);
  });

  it("outro código ou lead orgânico não é da campanha", async () => {
    db.adOrigins = [{ tenantId: TENANT, leadId: "l1", code: "AD99", sourceId: "x" }];
    expect(await isCampaignLead(TENANT, "l1", NOW)).toBe(false);
    expect(await isCampaignLead(TENANT, "organico", NOW)).toBe(false);
    expect(await getCampaignOverrideForLead(TENANT, "organico", NOW)).toBeNull();
  });
});

describe("isCampaignLead — marcação manual e disparo", () => {
  it("lead marcado à mão vale, inclusive lead de teste", async () => {
    db.overrides = [override({ leadIds: ["teste-1"] })];
    expect(await isCampaignLead(TENANT, "teste-1", NOW)).toBe(true);
    expect(await campaignLeadOrigin(TENANT, "teste-1", NOW)).toEqual({ kind: "manual", label: "manual" });
    expect((await getCampaignOverrideForLead(TENANT, "teste-1", NOW))?.key).toBe("implantes-2026-11");
  });

  it("destinatário real de um disparo da lista é da campanha (por conversa ou telefone, com ou sem o nono dígito)", async () => {
    db.overrides = [override({ broadcastCampaignIds: ["b1"] })];
    db.leads = [
      { id: "l1", tenantId: TENANT, phone: "5514998586900", conversationId: "c1" },
      { id: "l2", tenantId: TENANT, phone: "5514998586911", conversationId: null },
      { id: "l3", tenantId: TENANT, phone: "5514998586922", conversationId: "c3" },
    ];
    db.recipients = [
      { campaignId: "b1", campaignTenantId: TENANT, phone: "551499999", conversationId: "c1", status: "sent", isTest: false },
      { campaignId: "b1", campaignTenantId: TENANT, phone: "551498586911", conversationId: null, status: "sent", isTest: false },
      { campaignId: "b1", campaignTenantId: TENANT, phone: "5514998586922", conversationId: "c3", status: "sent", isTest: true },
    ];
    expect(await campaignLeadOrigin(TENANT, "l1", NOW)).toEqual({ kind: "disparo", label: "disparo" });
    expect(await isCampaignLead(TENANT, "l2", NOW)).toBe(true);
    expect(await isCampaignLead(TENANT, "l3", NOW)).toBe(false); // destinatário de teste não conta
  });

  it("disparo de outra conta não vale", async () => {
    db.overrides = [override({ broadcastCampaignIds: ["b1"] })];
    db.leads = [{ id: "l1", tenantId: TENANT, phone: "5514998586900", conversationId: "c1" }];
    db.recipients = [{ campaignId: "b1", campaignTenantId: "outra", phone: "5514998586900", conversationId: "c1", status: "sent", isTest: false }];
    expect(await isCampaignLead(TENANT, "l1", NOW)).toBe(false);
  });
});

describe("isCampaignLead — prazo e falhas", () => {
  beforeEach(() => {
    db.overrides = [override({ leadIds: ["l1"] })];
  });

  it("corte rígido: 02:59:59Z do dia 20 ainda vale; 03:00:00Z não", async () => {
    expect(await isCampaignLead(TENANT, "l1", new Date("2026-11-20T02:59:59.000Z"))).toBe(true);
    expect(await isCampaignLead(TENANT, "l1", new Date("2026-11-20T03:00:00.000Z"))).toBe(false);
  });

  it("antes do início não vale", async () => {
    expect(await isCampaignLead(TENANT, "l1", new Date("2026-11-09T23:59:59Z"))).toBe(false);
  });

  it("sem regra da conta ou com regra de outra conta é falso", async () => {
    db.overrides = [];
    expect(await isCampaignLead(TENANT, "l1", NOW)).toBe(false);
    db.overrides = [override({ tenantId: "outra", leadIds: ["l1"] })];
    expect(await isCampaignLead(TENANT, "l1", NOW)).toBe(false);
  });

  it("erro no banco devolve falso e nunca lança", async () => {
    db.fail = true;
    await expect(isCampaignLead(TENANT, "l1", NOW)).resolves.toBe(false);
    await expect(getCampaignOverrideForLead(TENANT, "l1", NOW)).resolves.toBeNull();
    await expect(campaignLeadOrigin(TENANT, "l1", NOW)).resolves.toBeNull();
  });
});

describe("parseOverrideRules", () => {
  it("nunca lança e cai no padrão com null ou lixo", () => {
    for (const junk of [null, undefined, 42, "texto", [], [1, 2], { dates: "x", time: 9 }, { dates: [1, "2026-13-40"], time: "25:99" }]) {
      expect(() => parseOverrideRules(junk)).not.toThrow();
      expect(parseOverrideRules(junk)).toEqual({ dates: ["2026-11-18", "2026-11-19"], time: "09:00" });
    }
  });

  it("lê o que está certo e descarta o resto", () => {
    expect(parseOverrideRules({ dates: ["2026-11-19", "2026-11-18", "lixo"], time: "10:30", capacityPerDay: 12, offerText: " Avaliação " })).toEqual({
      dates: ["2026-11-18", "2026-11-19"],
      time: "10:30",
      capacityPerDay: 12,
      offerText: "Avaliação",
    });
    expect(parseOverrideRules({ capacityPerDay: 0 }).capacityPerDay).toBeUndefined();
    expect(parseOverrideRules({ capacityPerDay: 2.5 }).capacityPerDay).toBeUndefined();
  });
});

describe("validação antes de gravar", () => {
  const state = { adCodes: [], adSourceIds: [], broadcastCampaignIds: [], leadIds: ["a"], rules: null };

  it("recusa código vazio, vagas inválidas e lead de outra conta", () => {
    const bad = buildOverrideUpdate(state, { codes: ["AD27", " "], capacityPerDay: 0, addLeads: ["x"] }, new Set());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(3);
    expect(buildOverrideUpdate(state, { capacityPerDay: 2.5 }, new Set()).ok).toBe(false);
    expect(buildOverrideUpdate(state, { offerText: "  " }, new Set()).ok).toBe(false);
  });

  it("normaliza códigos e aplica as mudanças", () => {
    const built = buildOverrideUpdate(state, { codes: ["ad 27", "AD27", "ad31"], capacityPerDay: 12, addLeads: ["b"], removeLeads: ["a"] }, new Set(["b"]));
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.next.adCodes).toEqual(["AD27", "AD31"]);
      expect(built.next.leadIds).toEqual(["b"]);
      expect(built.next.rules.capacityPerDay).toBe(12);
    }
  });
});
