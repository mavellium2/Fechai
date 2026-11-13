import { describe, expect, it } from "vitest";
import {
  allowedActions,
  CAMPAIGN_STATUSES,
  campaignStatus,
  isReadOnly,
  parseStatusFilter,
  statusWhere,
  type CampaignStatus,
  type CampaignTimeline,
} from "@/modules/campaigns/status";
import {
  DEFAULT_CAMPAIGN_TIMEZONE,
  dayOf,
  endOfDayUtc,
  formatDateTime,
  formatPeriod,
  isAcceptableDay,
  isRealDay,
  periodToUtc,
  startOfDayUtc,
} from "@/modules/campaigns/period";
import { campaignFormSchema, parseCampaignForm } from "@/modules/campaigns/schema";

/**
 * CMP-01 — o que decide o status de uma campanha e como o dia da tela vira
 * instante. Regra pura, sem banco: é onde um erro de fronteira (um milissegundo
 * a mais no fim, uma pausa que vence o término) vira campanha no estado errado
 * sem ninguém perceber.
 */

const SP = DEFAULT_CAMPAIGN_TIMEZONE;

const line = (over: Partial<CampaignTimeline> = {}): CampaignTimeline => ({
  startsAt: null,
  endsAt: null,
  pausedAt: null,
  archivedAt: null,
  ...over,
});

const at = (iso: string) => new Date(iso);

describe("status — os cinco estados", () => {
  const now = at("2026-11-15T15:00:00.000Z");

  it("sem datas é rascunho", () => {
    expect(campaignStatus(line(), now)).toBe("draft");
  });

  it("sem início é rascunho mesmo com fim, pausa e término já passados", () => {
    // "Ativa" exige início: sem `startsAt` a campanha nunca saiu do rascunho.
    expect(campaignStatus(line({ endsAt: at("2026-01-01T00:00:00Z") }), now)).toBe("draft");
    expect(campaignStatus(line({ pausedAt: at("2026-11-01T00:00:00Z") }), now)).toBe("draft");
  });

  it("início no futuro continua rascunho", () => {
    expect(campaignStatus(line({ startsAt: at("2026-12-01T03:00:00Z") }), now)).toBe("draft");
  });

  it("dentro do período é ativa, com ou sem data de fim", () => {
    expect(campaignStatus(line({ startsAt: at("2026-11-01T03:00:00Z") }), now)).toBe("active");
    expect(
      campaignStatus(line({ startsAt: at("2026-11-01T03:00:00Z"), endsAt: at("2026-12-01T02:59:59Z") }), now),
    ).toBe("active");
  });

  it("pausada dentro do período", () => {
    expect(
      campaignStatus(
        line({ startsAt: at("2026-11-01T03:00:00Z"), endsAt: at("2026-12-01T02:59:59Z"), pausedAt: at("2026-11-10T12:00:00Z") }),
        now,
      ),
    ).toBe("paused");
  });

  it("passou do fim é terminada", () => {
    expect(
      campaignStatus(line({ startsAt: at("2026-10-01T03:00:00Z"), endsAt: at("2026-11-01T02:59:59Z") }), now),
    ).toBe("finished");
  });

  it("arquivada", () => {
    expect(campaignStatus(line({ archivedAt: at("2026-11-14T12:00:00Z") }), now)).toBe("archived");
  });
});

describe("status — fronteiras e precedência", () => {
  const startsAt = startOfDayUtc("2026-11-01", SP);
  const endsAt = endOfDayUtc("2026-11-30", SP);

  it("o início é inclusivo: no instante exato já está ativa", () => {
    expect(campaignStatus(line({ startsAt, endsAt }), new Date(startsAt.getTime() - 1))).toBe("draft");
    expect(campaignStatus(line({ startsAt, endsAt }), startsAt)).toBe("active");
  });

  it("o fim é inclusivo no 23:59:59 locais do último dia: só termina no instante seguinte", () => {
    // `endsAt` = 23:59:59 do dia 30 em São Paulo = 02:59:59Z do dia 1º.
    expect(endsAt.toISOString()).toBe("2026-12-01T02:59:59.000Z");
    expect(campaignStatus(line({ startsAt, endsAt }), new Date(endsAt.getTime() - 1))).toBe("active");
    expect(campaignStatus(line({ startsAt, endsAt }), endsAt)).toBe("active");
    expect(campaignStatus(line({ startsAt, endsAt }), new Date(endsAt.getTime() + 1))).toBe("finished");
  });

  it("à meia-noite do dia seguinte, em São Paulo, já terminou — sem ninguém gravar nada", () => {
    const midnight = at("2026-12-01T03:00:00.000Z"); // 00:00 de 01/12 em SP
    expect(campaignStatus(line({ startsAt, endsAt }), midnight)).toBe("finished");
  });

  it("a pausa só vale dentro do período: terminada vence a pausa", () => {
    const paused = line({ startsAt, endsAt, pausedAt: at("2026-11-20T12:00:00Z") });
    expect(campaignStatus(paused, at("2026-11-25T12:00:00Z"))).toBe("paused");
    expect(campaignStatus(paused, at("2026-12-02T12:00:00Z"))).toBe("finished");
  });

  it("a pausa também não vale antes do início (volta a ser rascunho)", () => {
    const paused = line({ startsAt, endsAt, pausedAt: at("2026-10-20T12:00:00Z") });
    expect(campaignStatus(paused, at("2026-10-25T12:00:00Z"))).toBe("draft");
  });

  it("arquivada vence tudo, em qualquer momento do ciclo", () => {
    const archivedAt = at("2026-11-02T12:00:00Z");
    for (const moment of ["2026-10-15T12:00:00Z", "2026-11-15T12:00:00Z", "2026-12-15T12:00:00Z"]) {
      expect(campaignStatus(line({ startsAt, endsAt, archivedAt }), at(moment))).toBe("archived");
      expect(campaignStatus(line({ startsAt, endsAt, archivedAt, pausedAt: archivedAt }), at(moment))).toBe("archived");
    }
    expect(campaignStatus(line({ archivedAt }), at("2026-11-15T12:00:00Z"))).toBe("archived");
  });

  it("desarquivar devolve o status que as datas mandam", () => {
    const base = { startsAt, endsAt };
    expect(campaignStatus(line({ ...base, archivedAt: at("2026-11-02T12:00:00Z") }), at("2026-12-10T12:00:00Z"))).toBe("archived");
    expect(campaignStatus(line(base), at("2026-12-10T12:00:00Z"))).toBe("finished");
  });
});

describe("somente leitura e o que cada status permite", () => {
  const startsAt = startOfDayUtc("2026-11-01", SP);
  const endsAt = endOfDayUtc("2026-11-30", SP);
  const now = at("2026-11-15T15:00:00.000Z");

  it("terminada e arquivada ficam só para leitura; as outras não", () => {
    expect(isReadOnly(line({ startsAt, endsAt }), at("2026-12-05T00:00:00Z"))).toBe(true);
    expect(isReadOnly(line({ startsAt, endsAt, archivedAt: now }), now)).toBe(true);
    expect(isReadOnly(line(), now)).toBe(false);
    expect(isReadOnly(line({ startsAt, endsAt }), now)).toBe(false);
    expect(isReadOnly(line({ startsAt, endsAt, pausedAt: now }), now)).toBe(false);
  });

  it("tabela de ações por status", () => {
    const table: Record<CampaignStatus, ReturnType<typeof allowedActions>> = {
      draft: { edit: true, pause: false, resume: false, archive: true, unarchive: false },
      active: { edit: true, pause: true, resume: false, archive: true, unarchive: false },
      paused: { edit: true, pause: false, resume: true, archive: true, unarchive: false },
      finished: { edit: false, pause: false, resume: false, archive: true, unarchive: false },
      archived: { edit: false, pause: false, resume: false, archive: false, unarchive: true },
    };
    for (const status of CAMPAIGN_STATUSES) expect(allowedActions(status), status).toEqual(table[status]);
  });

  it("?status= desconhecido cai em 'todas', nunca em erro", () => {
    expect(parseStatusFilter(undefined)).toBe("all");
    expect(parseStatusFilter("")).toBe("all");
    expect(parseStatusFilter("nao-existe")).toBe("all");
    expect(parseStatusFilter("paused")).toBe("paused");
    expect(parseStatusFilter(["finished", "draft"])).toBe("finished");
    expect(parseStatusFilter("all")).toBe("all");
  });
});

/**
 * `statusWhere` é a mesma regra escrita como filtro de banco. Aqui ele roda
 * contra um avaliador mínimo do `where` do Prisma (igualdade, null, gt/gte/lt/lte,
 * not, OR) e precisa concordar com `campaignStatus` em TODA combinação de datas
 * — incluindo as fronteiras ao milissegundo. Se um dia alguém mexer numa das
 * duas pontas, a lista (banco) e a etiqueta (código) passariam a discordar.
 */
type Row = Record<string, Date | null>;
type Cond = null | Date | { lt?: Date; lte?: Date; gt?: Date; gte?: Date; not?: null };

function matchesField(cond: Cond | undefined, value: Date | null): boolean {
  if (cond === undefined) return true;
  if (cond === null) return value === null;
  if (cond instanceof Date) return value !== null && value.getTime() === cond.getTime();
  // Em SQL, comparar com NULL nunca é verdadeiro.
  if ("not" in cond && cond.not === null && value === null) return false;
  if (cond.lt && !(value !== null && value.getTime() < cond.lt.getTime())) return false;
  if (cond.lte && !(value !== null && value.getTime() <= cond.lte.getTime())) return false;
  if (cond.gt && !(value !== null && value.getTime() > cond.gt.getTime())) return false;
  if (cond.gte && !(value !== null && value.getTime() >= cond.gte.getTime())) return false;
  return true;
}

function matches(where: Record<string, unknown>, row: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, unknown>[]).some((branch) => matches(branch, row));
    if (key === "AND") return (cond as Record<string, unknown>[]).every((branch) => matches(branch, row));
    return matchesField(cond as Cond, row[key] ?? null);
  });
}

describe("statusWhere — o filtro do banco concorda com a regra", () => {
  const now = at("2026-11-15T15:00:00.000Z");
  const ms = (delta: number) => new Date(now.getTime() + delta);

  const starts = [null, ms(-86_400_000), ms(-1), ms(0), ms(1), ms(86_400_000)];
  const ends = [null, ms(-86_400_000), ms(-1), ms(0), ms(1), ms(86_400_000)];
  const pauses = [null, ms(-3_600_000)];
  const archives = [null, ms(-3_600_000)];

  const rows: Row[] = [];
  for (const startsAt of starts)
    for (const endsAt of ends)
      for (const pausedAt of pauses)
        for (const archivedAt of archives) rows.push({ startsAt, endsAt, pausedAt, archivedAt });

  it("cada campanha cai em exatamente um status, e em exatamente um filtro", () => {
    expect(rows.length).toBe(6 * 6 * 2 * 2);
    for (const row of rows) {
      const status = campaignStatus(row as CampaignTimeline, now);
      const hits = CAMPAIGN_STATUSES.filter((s) => matches(statusWhere(s, now) as Record<string, unknown>, row));
      expect(hits, JSON.stringify(row)).toEqual([status]);
    }
  });

  it("'todas' é tudo que não está arquivado", () => {
    for (const row of rows) {
      const status = campaignStatus(row as CampaignTimeline, now);
      expect(matches(statusWhere("all", now) as Record<string, unknown>, row), JSON.stringify(row)).toBe(status !== "archived");
    }
  });

  it("os filtros não carregam tenantId: quem monta a consulta é que o soma", () => {
    for (const filter of ["all", ...CAMPAIGN_STATUSES] as const) {
      expect(Object.keys(statusWhere(filter, now))).not.toContain("tenantId");
    }
  });
});

describe("período — do dia da tela ao instante UTC", () => {
  it("início é 00:00 local (03:00Z em São Paulo) e fim é 23:59:59 local (02:59:59Z do dia seguinte)", () => {
    expect(startOfDayUtc("2026-11-01", SP).toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(endOfDayUtc("2026-11-30", SP).toISOString()).toBe("2026-12-01T02:59:59.000Z");
  });

  it("vira o mês e o ano sem errar o fim do dia", () => {
    expect(endOfDayUtc("2026-12-31", SP).toISOString()).toBe("2027-01-01T02:59:59.000Z");
    expect(endOfDayUtc("2028-02-29", SP).toISOString()).toBe("2028-03-01T02:59:59.000Z");
    expect(endOfDayUtc("2027-02-28", SP).toISOString()).toBe("2027-03-01T02:59:59.000Z");
  });

  it("o fim cai no MESMO dia local do início escolhido (ida e volta)", () => {
    for (const day of ["2026-01-01", "2026-02-28", "2026-11-30", "2026-12-31", "2028-02-29"]) {
      expect(dayOf(startOfDayUtc(day, SP), SP), day).toBe(day);
      expect(dayOf(endOfDayUtc(day, SP), SP), day).toBe(day);
    }
  });

  it("respeita o fuso guardado na campanha, não o do servidor", () => {
    expect(startOfDayUtc("2026-11-01", "America/Manaus").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(endOfDayUtc("2026-11-30", "America/Manaus").toISOString()).toBe("2026-12-01T03:59:59.000Z");
    expect(startOfDayUtc("2026-11-01", "UTC").toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("os dois dias da tela viram o par de instantes (ou null, sem data)", () => {
    const both = periodToUtc("2026-11-01", "2026-11-30", SP);
    expect(both.startsAt?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(both.endsAt?.toISOString()).toBe("2026-12-01T02:59:59.000Z");
    expect(periodToUtc(null, null, SP)).toEqual({ startsAt: null, endsAt: null });
    expect(periodToUtc(null, "2026-11-30", SP).startsAt).toBeNull();
  });

  it("reconhece dia que não existe no calendário", () => {
    expect(isRealDay("2026-11-30")).toBe(true);
    expect(isRealDay("2028-02-29")).toBe(true);
    expect(isRealDay("2027-02-29")).toBe(false);
    expect(isRealDay("2026-04-31")).toBe(false);
    expect(isRealDay("2026-13-01")).toBe(false);
    expect(isRealDay("30/11/2026")).toBe(false);
    expect(isRealDay("0050-01-01")).toBe(false);
    expect(isAcceptableDay("1999-12-31")).toBe(false);
    expect(isAcceptableDay("2101-01-01")).toBe(false);
    expect(isAcceptableDay("2026-11-30")).toBe(true);
  });

  it("mostra o período em uma linha", () => {
    const d = (day: string, end = false) => (end ? endOfDayUtc(day, SP) : startOfDayUtc(day, SP));
    expect(formatPeriod(d("2026-11-01"), d("2026-11-30", true), SP)).toBe("01/11 a 30/11/2026");
    expect(formatPeriod(d("2026-12-15"), d("2027-01-15", true), SP)).toBe("15/12/2026 a 15/01/2027");
    expect(formatPeriod(d("2026-11-25"), d("2026-11-25", true), SP)).toBe("25/11/2026");
    expect(formatPeriod(d("2026-11-01"), null, SP)).toBe("A partir de 01/11/2026");
    expect(formatPeriod(null, d("2026-11-30", true), SP)).toBe("Até 30/11/2026");
    expect(formatPeriod(null, null, SP)).toBe("Sem período definido");
  });

  it("mostra data e hora no fuso da campanha", () => {
    expect(formatDateTime(at("2026-11-13T17:30:00Z"), SP)).toBe("13/11/2026 às 14:30");
    // 02:59Z já é o dia anterior em São Paulo.
    expect(formatDateTime(at("2026-12-01T02:59:59Z"), SP)).toBe("30/11/2026 às 23:59");
  });
});

describe("formulário — o que a tela pode mandar", () => {
  const ok = { name: "Black Friday", objective: "Encher a agenda de novembro", startsOn: "2026-11-01", endsOn: "2026-11-30" };

  it("aceita o preenchimento completo e tira os espaços das pontas", () => {
    const parsed = parseCampaignForm({ ...ok, name: "  Black Friday  " });
    expect(parsed).toEqual({ ok: true, data: ok });
  });

  it("objetivo e datas são opcionais: vazio vira null (rascunho)", () => {
    const parsed = parseCampaignForm({ name: "Rascunho", objective: "  ", startsOn: "", endsOn: "" });
    expect(parsed).toEqual({ ok: true, data: { name: "Rascunho", objective: null, startsOn: null, endsOn: null } });
  });

  it("nome: obrigatório, de 2 a 80 caracteres, sem quebra de linha", () => {
    const err = (name: string) => {
      const r = parseCampaignForm({ ...ok, name });
      return r.ok ? null : r.errors.name;
    };
    expect(err("")).toBe("Dê um nome à campanha.");
    expect(err("   ")).toBe("Dê um nome à campanha.");
    expect(err("A")).toMatch(/pelo menos 2/);
    expect(err("AB")).toBeNull();
    expect(err("x".repeat(80))).toBeNull();
    expect(err("x".repeat(81))).toMatch(/até 80/);
    expect(err("Linha 1\nLinha 2")).toMatch(/quebra de linha/);
    expect(err("Nome\u0000")).not.toBeNull();
  });

  it("objetivo: até 280, e a quebra de linha do textarea (CRLF) conta uma vez", () => {
    const err = (objective: string) => {
      const r = parseCampaignForm({ ...ok, objective });
      return r.ok ? null : r.errors.objective;
    };
    expect(err("x".repeat(280))).toBeNull();
    expect(err("x".repeat(281))).toMatch(/até 280/);
    // 139 + CRLF + 140 = 280 depois de normalizar; contado cru seriam 281.
    expect(err(`${"x".repeat(139)}\r\n${"y".repeat(140)}`)).toBeNull();
  });

  it("datas: precisam existir e estar entre 2000 e 2100", () => {
    const err = (field: "startsOn" | "endsOn", value: string) => {
      const r = parseCampaignForm({ ...ok, [field]: value });
      return r.ok ? null : r.errors[field];
    };
    expect(err("startsOn", "2026-02-30")).toMatch(/data válida/);
    expect(err("startsOn", "01/11/2026")).toMatch(/data válida/);
    expect(err("endsOn", "0001-01-01")).toMatch(/data válida/);
    expect(err("endsOn", "2101-01-01")).toMatch(/data válida/);
  });

  it("o fim antes do início é recusado, no campo do fim", () => {
    const r = parseCampaignForm({ ...ok, startsOn: "2026-11-30", endsOn: "2026-11-01" });
    expect(r).toEqual({ ok: false, errors: { endsOn: "O fim não pode ser antes do início." } });
  });

  it("fim no mesmo dia do início vale (campanha de um dia)", () => {
    expect(parseCampaignForm({ ...ok, startsOn: "2026-11-25", endsOn: "2026-11-25" }).ok).toBe(true);
  });

  it("só início, ou só fim, é aceito — a comparação só existe com os dois", () => {
    expect(parseCampaignForm({ ...ok, endsOn: "" }).ok).toBe(true);
    expect(parseCampaignForm({ ...ok, startsOn: "" }).ok).toBe(true);
  });

  it("campos desconhecidos (tenantId, createdById, status) não entram no resultado", () => {
    const parsed = parseCampaignForm({ ...ok, tenantId: "outra-conta", createdById: "x", status: "active" } as never);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.data).sort()).toEqual(["endsOn", "name", "objective", "startsOn"]);
  });

  it("devolve um erro por campo, na ordem do formulário", () => {
    const r = parseCampaignForm({ name: "", objective: "x".repeat(300), startsOn: "x", endsOn: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["name", "objective", "startsOn", "endsOn"]);
  });

  it("o schema é o mesmo que a action usa (sem segunda cópia da regra)", () => {
    expect(campaignFormSchema.safeParse({ name: "ab", objective: "", startsOn: "", endsOn: "" }).success).toBe(true);
  });
});
