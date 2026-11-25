import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: vi.fn() }));

import { crmBoardWhere } from "@/modules/crm/board";
import { CRM_SEARCH_MAX, crmBoardHref, readCrmFilters, readCrmSearches } from "@/modules/crm/board-filters";

const tenantId = "conta-a";
const unassigned = { OR: [{ conversation: null }, { conversation: { is: { tenantId, assignedUserId: null } } }] };
const human = { stage: { is: { tenantId, kind: "human" } } };

describe("filtro de responsável no Kanban", () => {
  it("lê o parâmetro da URL e recusa valor fora do formato", () => {
    expect(readCrmFilters({ responsavel: "user_1" }).assignees).toEqual(["user_1"]);
    expect(readCrmFilters({ responsavel: "sem" }).assignees).toEqual(["sem"]);
    expect(readCrmFilters({ responsavel: "nao-identificado" }).assignees).toEqual(["nao-identificado"]);
    expect(readCrmFilters({ responsavel: "x' OR 1=1" }).assignees).toEqual([]);
    expect(readCrmFilters({ responsavel: ["a", "b"] }).assignees).toEqual([]);
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

  it("aceita vários valores por filtro, separados por vírgula, sem repetir nem aceitar lixo", () => {
    const filters = readCrmFilters({ etapa: "e1,e2,e1", responsavel: "user_1,sem,x' OR 1=1", origem: "anuncio,widget,inventada", etiqueta: "t1,t2" });
    expect(filters.stages).toEqual(["e1", "e2"]);
    expect(filters.assignees).toEqual(["user_1", "sem"]);
    expect(filters.origins).toEqual(["anuncio", "widget"]);
    expect(filters.tags).toEqual(["t1", "t2"]);
  });

  it("dentro do filtro vale qualquer um (ou); entre filtros, todos (e)", () => {
    const where = crmBoardWhere(tenantId, readCrmFilters({ etapa: "e1,e2", etiqueta: "t1,t2", responsavel: "user_1,sem", origem: "widget,manual" }));
    expect(where.stageId).toEqual({ in: ["e1", "e2"] });
    expect(where.leadTags).toEqual({ some: { tenantId, tagId: { in: ["t1", "t2"] } } });
    expect(where.AND).toEqual([
      { OR: [{ conversation: { is: { tenantId, assignedUserId: "user_1" } } }, { AND: [unassigned, { NOT: human }] }] },
      { OR: [{ originChannel: "widget" }, { originChannel: "manual" }] },
    ]);
  });

  it("o link compartilhado preserva o responsável", () => {
    expect(crmBoardHref({ responsavel: "sem", etapa: "e1" }, { lead: "l1" })).toBe("/crm?responsavel=sem&etapa=e1&lead=l1");
  });
});

describe("busca no Kanban", () => {
  it("lê a busca geral e a de cada etapa, aparadas e sem controle", () => {
    expect(readCrmSearches({ q: "  Ana\u0000 ", q_e1: " 55119999 ", q_e2: "", "q_x' OR 1=1": "x", ["q_e3" as string]: ["a", "b"] }))
      .toEqual({ global: "Ana", columns: { e1: "55119999" } });
    expect(readCrmSearches({ q: "a".repeat(CRM_SEARCH_MAX + 20) }).global).toHaveLength(CRM_SEARCH_MAX);
  });

  it("soma a busca aos filtros sem sobrescrever o escopo da conta", () => {
    const where = crmBoardWhere(tenantId, readCrmFilters({ responsavel: "user_1" }), " 55119999 ");
    expect(where.tenantId).toBe(tenantId);
    expect(where.OR).toEqual([{ conversation: null }, { conversation: { is: { tenantId, isTest: false } } }]);
    expect(where.AND).toEqual([
      { conversation: { is: { tenantId, assignedUserId: "user_1" } } },
      { OR: [
        { name: { contains: "55119999", mode: "insensitive" } },
        { phone: { contains: "55119999" } },
      ] },
    ]);
  });

  it("o link compartilhado preserva as buscas e descarta paginação antiga", () => {
    expect(crmBoardHref({ q: "ana", q_e1: "999", p_e1: "3", etapa: "e1" }, { lead: "l1" }))
      .toBe("/crm?q=ana&q_e1=999&etapa=e1&lead=l1");
  });

  it("trocar o texto de uma busca não derruba os outros filtros", () => {
    const href = crmBoardHref({
      etapa: "e1,e2", responsavel: "user_1,sem", etiqueta: "t1", origem: "anuncio,widget",
      periodo: "atividade", de: "2026-11-01", ate: "2026-11-30", q: "ana", q_e1: "999",
    }, { q: "carla" });
    expect(Object.fromEntries(new URL(href, "http://localhost").searchParams)).toEqual({
      etapa: "e1,e2", responsavel: "user_1,sem", etiqueta: "t1", origem: "anuncio,widget",
      periodo: "atividade", de: "2026-11-01", ate: "2026-11-30", q: "carla", q_e1: "999",
    });
  });
});
