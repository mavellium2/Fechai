import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * URG-02 — o que o prompt do turno diz ao agente: só para lead da campanha de
 * implantes, com a `offerText` da regra quando existir.
 */

const db = vi.hoisted(() => ({
  campaignLead: { findMany: vi.fn() },
  campaignOverride: { findMany: vi.fn() },
  leadAdOrigin: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { findLeadCampaign } from "@/modules/campaigns/active";
import { campaignRulesPrompt } from "@/modules/campaigns/rules";
import { OVERRIDE_PROMPT_LINE } from "@/modules/campaign-override/agent";

const TENANT = "conta-1";
const LINE = "Lead da campanha de implantes: o atendimento é no evento de 18 ou 19/11; o paciente deve chegar às 09h00. Não ofereça outras datas nem horários.";

function setOverride(rules: Record<string, unknown>) {
  const row = {
    id: "o1", key: "implantes-2026-11", adCodes: [], adSourceIds: [], broadcastCampaignIds: [], leadIds: ["lead-1"],
    startsAt: new Date("2026-11-10T00:00:00Z"), endsAt: new Date("2026-11-20T02:59:59Z"),
    rules: { dates: ["2026-11-18", "2026-11-19"], time: "09:00", ...rules },
  };
  // Como o banco: só devolve a regra que vale em `now` (corte rígido no fim).
  db.campaignOverride.findMany.mockImplementation(async ({ where }: { where: { startsAt: { lte: Date }; endsAt: { gte: Date } } }) =>
    row.startsAt <= where.startsAt.lte && row.endsAt >= where.endsAt.gte ? [row] : [],
  );
}

/** O prompt que o orquestrador monta para o lead (mesma função de sempre, sem ramo próprio). */
async function promptFor(leadId: string): Promise<string> {
  const campaign = await findLeadCampaign(TENANT, leadId);
  if (!campaign) return "";
  return campaignRulesPrompt(campaign.campaign, campaign.rules, { handoffAvailable: true, assets: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  db.campaignLead.findMany.mockResolvedValue([]);
  db.leadAdOrigin.findMany.mockResolvedValue([]);
  setOverride({ capacityPerDay: 10 });
});
afterEach(() => vi.useRealTimers());

describe("prompt do lead da campanha de implantes", () => {
  it("a linha do card é exatamente esta", () => {
    expect(OVERRIDE_PROMPT_LINE).toBe(LINE);
  });

  it("lead da campanha recebe a linha, as duas opções e a chegada às 09h00", async () => {
    const prompt = await promptFor("lead-1");
    expect(prompt).toContain(LINE);
    expect(prompt).toContain("SOMENTE estas opções — 18/11/2026 às 09:00; 19/11/2026 às 09:00");
    expect(prompt).toContain("chegar às 09h00");
    expect(prompt).toContain("não há lembretes automáticos");
  });

  it("lead fora da campanha não recebe nada disso", async () => {
    expect(await promptFor("lead-9")).toBe("");
  });

  it("depois do corte rígido (20/11 03:00Z) o lead também não recebe", async () => {
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    expect(await promptFor("lead-1")).toBe("");
  });

  it("a offerText da regra entra no prompt quando existe", async () => {
    setOverride({ capacityPerDay: 10, offerText: "Avaliação de implante sem custo no evento." });
    const prompt = await promptFor("lead-1");
    expect(prompt).toContain(LINE);
    expect(prompt).toContain("Oferta e condições da campanha (use na conversa, sem inventar outras): Avaliação de implante sem custo no evento.");
  });

  it("sem offerText não há bloco de oferta", async () => {
    const prompt = await promptFor("lead-1");
    expect(prompt).not.toContain("Oferta e condições");
  });
});
