import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: vi.fn() }));

import { crmBoardWhere } from "@/modules/crm/board";
import { crmBoardHref, readCrmFilters } from "@/modules/crm/board-filters";

const tenantId = "conta-a";
const unassigned = { OR: [{ conversation: null }, { conversation: { is: { tenantId, assignedUserId: null } } }] };
const human = { stage: { is: { tenantId, kind: "human" } } };

describe("filtro de responsável no Kanban", () => {
  it("lê o parâmetro da URL e recusa valor fora do formato", () => {
    expect(readCrmFilters({ responsavel: "user_1" }).assignee).toBe("user_1");
    expect(readCrmFilters({ responsavel: "sem" }).assignee).toBe("sem");
    expect(readCrmFilters({ responsavel: "nao-identificado" }).assignee).toBe("nao-identificado");
    expect(readCrmFilters({ responsavel: "x' OR 1=1" }).assignee).toBe("");
    expect(readCrmFilters({ responsavel: ["a", "b"] }).assignee).toBe("");
  });

  it("filtra pela pessoa da conversa, sempre dentro da conta", () => {
    const where = crmBoardWhere(tenantId, readCrmFilters({ responsavel: "user_1" }));
    expect(where.tenantId).toBe(tenantId);
    expect(where.AND).toEqual([{ conversation: { is: { tenantId, assignedUserId: "user_1" } } }]);
  });

  it("'sem responsável' e 'humano não identificado' não se sobrepõem", () => {
    expect(crmBoardWhere(tenantId, readCrmFilters({ responsavel: "sem" })).AND)
      .toEqual([{ AND: [unassigned, { NOT: human }] }]);
    expect(crmBoardWhere(tenantId, readCrmFilters({ responsavel: "nao-identificado" })).AND)
      .toEqual([{ AND: [unassigned, human] }]);
  });

  it("combina com origem e período sem perder nenhum filtro", () => {
    const where = crmBoardWhere(tenantId, readCrmFilters({
      responsavel: "user_1", origem: "anuncio", periodo: "atividade", de: "2026-11-01", ate: "2026-11-30",
    }));
    const and = where.AND as unknown[];
    expect(and).toHaveLength(3);
    expect(and[0]).toEqual({ conversation: { is: { tenantId, assignedUserId: "user_1" } } });
    expect(and[1]).toEqual({ OR: [{ originChannel: "ad" }, { originChannel: null, adOrigin: { is: { tenantId } } }] });
    expect(and[2]).toHaveProperty("OR");
  });

  it("o link compartilhado preserva o responsável", () => {
    expect(crmBoardHref({ responsavel: "sem", etapa: "e1" }, { lead: "l1" })).toBe("/crm?responsavel=sem&etapa=e1&lead=l1");
  });
});
