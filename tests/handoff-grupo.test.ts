import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testes da regra "transferiu para humano → aviso no grupo interno".
 *
 * O que está protegido aqui não é a chamada à Evolution, e sim as condições que
 * decidem se ela acontece. Cada uma existe por um estrago concreto:
 *
 * - participantes do grupo nunca mudam;
 * - ação desligada ainda enviando avisos é a tela mentindo;
 * - conversa de teste no grupo real polui o grupo da equipe com um telefone
 *   sintético do sandbox;
 * - uma exceção escapando derruba o webhook, e a Evolution reentrega a mesma
 *   mensagem em laço — a transferência já aconteceu, o grupo é o extra.
 */

const db = vi.hoisted(() => {
  const client = {
    tenantAction: { findUnique: vi.fn(), upsert: vi.fn() },
    whatsappInstance: { findMany: vi.fn() },
    conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
    handoffNotice: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return client;
});
const provider = vi.hoisted(() => ({
  sendGroupMessage: vi.fn<(instance: string, group: string, text: string) => Promise<string | null>>(async () => "aviso-1"),
  isConfigured: vi.fn(() => true),
  listGroups: vi.fn(async (): Promise<{ id: string; name: string; size: number | null }[]> => []),
}));
// A conexão da Meta não tem `listGroups`: é assim que a tela sabe que grupo
// não existe ali.
const metaProvider = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: (name: string) => (name === "meta" ? metaProvider : provider),
}));

import {
  notifyHandoffGroup,
  formatHandoffNotice,
  describeHandoff,
  handoffToolDescription,
  listWhatsAppGroups,
  MAX_GROUP_NAME,
  MAX_GROUP_REASON,
  normalizeGroupId,
  parseHandoffConfig,
  type HandoffConfig,
} from "@/modules/agent-engine/handoff";
import { getToolSchemas, runToolHandler } from "@/modules/agent-engine/tools";
import { handoffConfigSchema } from "@/modules/agent-engine/handoff-form";
import { EvolutionProvider } from "@/modules/whatsapp/evolution";

const TENANT = "tenant-1";
const AGENTE = "agente-1";
const GRUPO = "120363012345678901@g.us";
const TELEFONE = "5514997631563";
const CONVERSA = "conversa-1";
const RESUMO = "Luciane quer fechar o orçamento do tratamento e falar com a recepção.";

function conversaReal() {
  return {
    isTest: false,
    summary: RESUMO,
    leadId: "lead-1",
    tenant: { crmEnabled: false, status: "active" },
    lead: { name: "Luciane Aparecida Dos Santos", phone: TELEFONE, isTest: false, originChannel: null as string | null, adOrigin: null as { tenantId: string } | null },
    messages: [{ content: "Quero fechar meu orçamento hoje." }],
  };
}

/** Nenhuma espera aberta: o transbordo cria uma e avisa o grupo. */
function semEsperaAberta() {
  db.handoffNotice.findFirst.mockResolvedValue(null);
  db.handoffNotice.create.mockResolvedValue({ id: "aviso-db-1" });
  db.handoffNotice.updateMany.mockResolvedValue({ count: 1 });
}

/** Ação de transferência do agente, ligada e com grupo, salvo indicação contrária. */
function acaoConfigurada(over: { enabled?: boolean; notifyGroup?: boolean; groupId?: string } = {}) {
  db.tenantAction.findUnique.mockResolvedValue({
    enabled: over.enabled ?? true,
    config: {
      notifyGroup: over.notifyGroup ?? true,
      groupId: over.groupId ?? GRUPO,
    },
  });
}

/** Número da conta conectado na Evolution. */
function whatsappConectado() {
  db.whatsappInstance.findMany.mockResolvedValue([{
    externalId: "tenant_tenant-1",
    status: "connected",
  }]);
}

describe("ID do grupo (normalizeGroupId)", () => {
  it("aceita o JID completo como está", () => {
    expect(normalizeGroupId(GRUPO)).toBe(GRUPO);
  });

  it("completa o sufixo quando a pessoa cola só os dígitos", () => {
    expect(normalizeGroupId("120363012345678901")).toBe(GRUPO);
  });

  it("ignora espaços em volta (colar do WhatsApp costuma trazer)", () => {
    expect(normalizeGroupId(`  ${GRUPO}  `)).toBe(GRUPO);
  });

  it("recusa um telefone de pessoa, que não é grupo", () => {
    expect(normalizeGroupId("5511999990000@s.whatsapp.net")).toBeNull();
  });

  it("recusa texto qualquer e vazio", () => {
    expect(normalizeGroupId("grupo do atendimento")).toBeNull();
    expect(normalizeGroupId("")).toBeNull();
  });
});

/** Config completa, ligada ao grupo, salvo indicação contrária. */
function config(over: Partial<HandoffConfig> = {}): HandoffConfig {
  return { notifyGroup: true, groupId: GRUPO, groupName: "Recepção", groupReason: "", whileWaiting: "continue", ...over };
}

describe("Leitura da config (parseHandoffConfig)", () => {
  it("nasce desligada quando a ação nunca foi configurada", () => {
    expect(parseHandoffConfig(null)).toEqual({
      notifyGroup: false,
      groupId: null,
      groupName: null,
      groupReason: "",
      whileWaiting: "continue",
    });
  });

  it("lê config de antes do nome e do motivo existirem", () => {
    expect(parseHandoffConfig({ addToGroup: true, groupId: GRUPO })).toEqual({
      notifyGroup: true,
      groupId: GRUPO,
      groupName: null,
      groupReason: "",
      whileWaiting: "continue",
    });
  });

  it("a opção nova desligada prevalece sobre a chave antiga ligada", () => {
    expect(parseHandoffConfig({ notifyGroup: false, addToGroup: true, groupId: GRUPO }).notifyGroup).toBe(false);
  });

  it("config antiga preserva grupo, nome e motivo para o aviso", () => {
    expect(parseHandoffConfig({ addToGroup: true, groupId: GRUPO, groupName: "Recepção", groupReason: "prioridade" }))
      .toEqual(config({ groupReason: "prioridade" }));
  });

  it("não deixa ficar ligada sem grupo — um toggle ligado que não faz nada faz a tela mentir", () => {
    expect(parseHandoffConfig({ notifyGroup: true, groupId: "" }).notifyGroup).toBe(false);
  });

  it("descarta um grupo inválido salvo à mão no banco, e o nome junto", () => {
    const cfg = parseHandoffConfig({ notifyGroup: true, groupId: "não é grupo", groupName: "Recepção" });
    expect(cfg).toMatchObject({ notifyGroup: false, groupId: null, groupName: null });
  });

  it("corta nome e motivo compridos demais editados à mão", () => {
    const cfg = parseHandoffConfig({
      notifyGroup: true,
      groupId: GRUPO,
      groupName: "n".repeat(MAX_GROUP_NAME + 50),
      groupReason: "m".repeat(MAX_GROUP_REASON + 50),
    });
    expect(cfg.groupName).toHaveLength(MAX_GROUP_NAME);
    expect(cfg.groupReason).toHaveLength(MAX_GROUP_REASON);
  });

  it("resume no card o que está valendo, pelo nome do grupo quando existe", () => {
    expect(describeHandoff(config())).toContain("“Recepção”");
    expect(describeHandoff(config({ groupName: null }))).toContain("grupo");
    expect(describeHandoff(config({ notifyGroup: false }))).toContain("precisa de você");
  });
});

describe("Motivo na descrição da tool (handoffToolDescription)", () => {
  const MOTIVO = "o paciente quiser fechar o orçamento";

  it("sem config, não trata mero interesse como prioridade", () => {
    expect(handoffToolDescription()).toContain("Não marque prioridade apenas porque o contato demonstrou interesse.");
  });

  it("com grupo ligado e motivo, diz ao agente quando transferir", () => {
    const d = handoffToolDescription(config({ groupReason: MOTIVO }));
    expect(d).toContain(`Use sempre que: ${MOTIVO}.`);
    expect(d).toContain("grupo");
  });

  it("não duplica a pontuação final nem leva quebra de linha para o LLM", () => {
    const d = handoffToolDescription(config({ groupReason: `${MOTIVO};\nou reclamar.` }));
    expect(d).toContain(`Use sempre que: ${MOTIVO}; ou reclamar.`);
    expect(d).not.toContain("..");
    expect(d).not.toContain("\n");
  });

  it("motivo guardado com o grupo desligado não tem efeito", () => {
    expect(handoffToolDescription(config({ notifyGroup: false, groupReason: MOTIVO }))).toBe(
      handoffToolDescription(),
    );
  });

  it("sem motivo, o agente decide sozinho como antes", () => {
    expect(handoffToolDescription(config())).toContain("O contato nunca é adicionado ao grupo.");
    expect(handoffToolDescription(config())).not.toContain("Use sempre que");
  });

  it("é o texto que chega ao LLM pela lista de tools", () => {
    const tool = getToolSchemas(["handoff_human"], undefined, undefined, config({ groupReason: MOTIVO }))
      .find((s) => s.name === "handoff_human");
    expect(tool?.description).toContain(MOTIVO);
  });
});

/** O schema do formulário é o mesmo da action (`agent-engine/handoff-form.ts`). */
const schema = handoffConfigSchema;

describe("Envio do formulário de transferência", () => {
  it("aceita ligado com grupo válido, nome e motivo", () => {
    const r = schema.safeParse({ notifyGroup: "on", groupId: GRUPO, groupName: "Recepção", groupReason: " orçamento " });
    expect(r.success && r.data).toEqual(config({ groupReason: "orçamento" }));
  });

  it("RECUSA ligado com grupo inválido, em vez de salvar desligado calado", () => {
    expect(schema.safeParse({ notifyGroup: "on", groupId: "grupo errado" }).success).toBe(false);
    expect(schema.safeParse({ notifyGroup: "on", groupId: "" }).success).toBe(false);
  });

  it("desligado NÃO apaga grupo nem motivo — desligar é pausar", () => {
    const r = schema.safeParse({ notifyGroup: "", groupId: GRUPO, groupName: "Recepção", groupReason: "orçamento" });
    expect(r.success && r.data).toEqual(config({ notifyGroup: false, groupReason: "orçamento" }));
  });

  it("recusa motivo acima do limite", () => {
    const r = schema.safeParse({ notifyGroup: "on", groupId: GRUPO, groupReason: "m".repeat(MAX_GROUP_REASON + 1) });
    expect(r.success).toBe(false);
  });

  it("trata como desligado o que não é 'on' — 'false' não pode virar ligado", () => {
    expect(schema.safeParse({ notifyGroup: "false", groupId: "" }).success).toBe(true);
    expect(schema.safeParse({ notifyGroup: "off", groupId: "" }).success).toBe(true);
  });
});

describe("Grupos do número conectado (listWhatsAppGroups)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lista os grupos da Evolution quando o número está conectado", async () => {
    whatsappConectado();
    provider.listGroups.mockResolvedValueOnce([{ id: GRUPO, name: "Recepção", size: 4 }]);
    await expect(listWhatsAppGroups(TENANT)).resolves.toEqual({
      ok: true,
      groups: [{ id: GRUPO, name: "Recepção", size: 4 }],
    });
    expect(provider.listGroups).toHaveBeenCalledWith("tenant_tenant-1");
  });

  it("número desconectado: avisa em vez de tentar", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ externalId: "tenant_tenant-1", status: "disconnected" }]);
    await expect(listWhatsAppGroups(TENANT)).resolves.toMatchObject({ ok: false, reason: "disconnected" });
    expect(provider.listGroups).not.toHaveBeenCalled();
  });

  it("conexão da Meta: grupo não existe ali, e a tela não oferece o ID à mão", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{
      provider: "meta",
      externalId: "phone-1",
      status: "connected",
      metaPhoneNumberId: "phone-1",
      metaBusinessAccountId: null,
      metaAccessTokenEncrypted: null,
    }]);
    await expect(listWhatsAppGroups(TENANT)).resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("nunca lança: Evolution fora do ar vira aviso, e a pessoa ainda pode colar o ID", async () => {
    whatsappConectado();
    provider.listGroups.mockRejectedValueOnce(new Error("Evolution fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(listWhatsAppGroups(TENANT)).resolves.toMatchObject({ ok: false, reason: "failed" });
    log.mockRestore();
  });
});

describe("Resposta da Evolution (EvolutionProvider.listGroups)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fica só com grupos, usa o ID quando não há nome e ordena por nome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { id: "120363000000000002@g.us", subject: "Vendas", size: 3 },
            { id: "5511999990000@s.whatsapp.net", subject: "Não é grupo" },
            { id: "120363000000000001@g.us", subject: "  Atendimento  " },
            { id: "120363000000000003@g.us", subject: "" },
          ]),
        ),
      ),
    );
    const groups = await new EvolutionProvider().listGroups("tenant_tenant-1");
    expect(groups).toEqual([
      { id: "120363000000000003@g.us", name: "120363000000000003@g.us", size: null },
      { id: "120363000000000001@g.us", name: "Atendimento", size: null },
      { id: "120363000000000002@g.us", name: "Vendas", size: 3 },
    ]);
  });

  it("lança em resposta de erro — quem decide o que mostrar é listWhatsAppGroups", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 500 })));
    await expect(new EvolutionProvider().listGroups("tenant_tenant-1")).rejects.toThrow("500");
  });
});

describe("Avisar a equipe no grupo (notifyHandoffGroup)", () => {
  beforeEach(() => {
    whatsappConectado();
    semEsperaAberta();
    db.conversation.findFirst.mockResolvedValue(conversaReal());
    provider.isConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("envia nome, número, origem e resumo ao grupo, nunca ao telefone do lead", async () => {
    acaoConfigurada();
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).toHaveBeenCalledWith(
      "tenant_tenant-1",
      GRUPO,
      `Nome: Luciane Aparecida Dos Santos\nNúmero: +55 14 99763-1563\nOrigem: não registrada\nResumo: ${RESUMO}`
        + "\nResponda *assumo* ou reaja 👍 para ficar com este lead. *#ia* devolve para a IA.",
    );
    expect(provider.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(db.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CONVERSA, tenantId: TENANT },
    }));
    expect(db.tenantAction.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId_key: { agentId: AGENTE, key: "handoff_human" }, tenantId: TENANT },
    }));
  });

  it("inclui o motivo atual da prioridade junto do resumo salvo", async () => {
    acaoConfigurada();
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA, { reason: "Quer fechar hoje." });
    expect(provider.sendGroupMessage).toHaveBeenCalledWith(
      "tenant_tenant-1", GRUPO,
      expect.stringContaining(`Resumo: ${RESUMO}\nMotivo: Quer fechar hoje.`),
    );
  });

  it("sem resumo salvo, usa falas recentes em ordem cronológica e o motivo, sem IA", async () => {
    acaoConfigurada();
    db.conversation.findFirst.mockResolvedValue({ ...conversaReal(), summary: null,
      messages: [{ content: "Quero fechar hoje." }, { content: "Preciso de implante." }],
    });
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA, { reason: "Pediu a recepção." });
    expect(provider.sendGroupMessage).toHaveBeenCalledWith("tenant_tenant-1", GRUPO,
      expect.stringContaining("Resumo: Preciso de implante. · Quero fechar hoje.\nMotivo: Pediu a recepção."));
  });

  it.each(["conversa", "lead"])("não envia quando o banco marca %s como teste, mesmo sem a opção do chamador", async (kind) => {
    acaoConfigurada();
    const conversation = conversaReal();
    if (kind === "conversa") conversation.isTest = true;
    else conversation.lead.isTest = true;
    db.conversation.findFirst.mockResolvedValue(conversation);
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("não envia aviso de uma conversa que não pertence ao tenant", async () => {
    acaoConfigurada();
    db.conversation.findFirst.mockResolvedValue(null);
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("Meta não recebe tentativa de envio para grupo, mas a espera fica registrada no Fechai", async () => {
    acaoConfigurada();
    db.whatsappInstance.findMany.mockResolvedValue([{ externalId: "phone-1", status: "connected", provider: "meta" }]);
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
    expect(db.handoffNotice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: TENANT, conversationId: CONVERSA }),
    }));
  });

  it("não envia com provider sem credenciais", async () => {
    acaoConfigurada();
    provider.isConfigured.mockReturnValue(false);
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("NÃO avisa com a ação desligada, mesmo com grupo cadastrado", async () => {
    acaoConfigurada({ enabled: false });
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("NÃO avisa quando a opção de grupo está desligada na config", async () => {
    acaoConfigurada({ notifyGroup: false });
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("NÃO avisa conversa de teste: o telefone do sandbox não vai para o grupo da equipe", async () => {
    acaoConfigurada();
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA, { isTest: true });
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
    // Nem chega a consultar a config: teste não é atendimento.
    expect(db.tenantAction.findUnique).not.toHaveBeenCalled();
  });

  it("NÃO avisa sem agente resolvido", async () => {
    await notifyHandoffGroup(TENANT, null, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("NÃO avisa com o WhatsApp desconectado — não há conexão para enviar", async () => {
    acaoConfigurada();
    db.whatsappInstance.findMany.mockResolvedValue([{
      externalId: "tenant_tenant-1",
      status: "disconnected",
    }]);
    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);
    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("engole a falha da Evolution: a transferência não pode cair junto", async () => {
    acaoConfigurada();
    provider.sendGroupMessage.mockRejectedValueOnce(new Error("Evolution fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyHandoffGroup(TENANT, AGENTE, CONVERSA)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("engole falha do BANCO também — no webhook, lançar viraria 500 e reentrega em laço", async () => {
    db.tenantAction.findUnique.mockRejectedValueOnce(new Error("banco indisponível"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyHandoffGroup(TENANT, AGENTE, CONVERSA)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("Transferência com a Evolution e a Meta conectadas", () => {
  const QR = { provider: "evolution", externalId: "tenant_tenant-1", status: "connected" };
  const META = {
    provider: "meta", externalId: "phone-1", status: "connected",
    metaPhoneNumberId: "phone-1", metaBusinessAccountId: null, metaAccessTokenEncrypted: null,
  };

  beforeEach(() => {
    semEsperaAberta();
    provider.isConfigured.mockReturnValue(true);
    db.conversation.findFirst.mockResolvedValue(conversaReal());
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("o aviso vai pelo grupo do QR code, com a Meta também de pé", async () => {
    acaoConfigurada();
    db.whatsappInstance.findMany.mockResolvedValue([META, QR]);

    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);

    expect(provider.sendGroupMessage).toHaveBeenCalledOnce();
    expect(provider.sendGroupMessage.mock.calls[0][0]).toBe("tenant_tenant-1");
    expect(provider.sendGroupMessage.mock.calls[0][1]).toBe(GRUPO);
  });

  it("QR desconectado e Meta de pé: sem aviso (grupo não existe na Meta)", async () => {
    acaoConfigurada();
    db.whatsappInstance.findMany.mockResolvedValue([{ ...QR, status: "disconnected" }, META]);

    await notifyHandoffGroup(TENANT, AGENTE, CONVERSA);

    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("a lista de grupos vem do QR, e a Meta de pé não a substitui", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([META, QR]);
    provider.listGroups.mockResolvedValueOnce([{ id: GRUPO, name: "Recepção", size: 4 }]);

    await expect(listWhatsAppGroups(TENANT)).resolves.toEqual({
      ok: true,
      groups: [{ id: GRUPO, name: "Recepção", size: 4 }],
    });
    expect(provider.listGroups).toHaveBeenCalledWith("tenant_tenant-1");
  });

  it("só a Meta conectada: a tela sabe que grupo não existe e manda conectar o QR", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([META]);

    const res = await listWhatsAppGroups(TENANT);

    expect(res).toMatchObject({ ok: false, reason: "unsupported" });
    expect(res.ok ? "" : res.error).toMatch(/QR/);
  });

  it("nenhuma conexão de pé: desconectado, e a pessoa pode colar o ID depois", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ ...QR, status: "disconnected" }, { ...META, status: "disconnected" }]);

    await expect(listWhatsAppGroups(TENANT)).resolves.toMatchObject({ ok: false, reason: "disconnected" });
  });
});

describe("Formato do aviso", () => {
  it("uma informação por linha, mesmo com quebras nos dados, e limita o resumo", () => {
    const notice = formatHandoffNotice({ name: "Luciane\nSantos", phone: TELEFONE, summary: "texto\n".repeat(200), reason: "Orçamento\nurgente.", origin: "Anúncio\nfalso" });
    expect(notice.split("\n")).toHaveLength(5);
    expect(notice).toContain("Nome: Luciane Santos");
    expect(notice).toContain("Origem: Anúncio falso");
    expect(notice).toContain("…\nMotivo: Orçamento urgente.");
    expect(notice.length).toBeLessThan(1100);
  });

  it("não inventa nome, origem nem resumo quando não existem", () => {
    expect(formatHandoffNotice({ name: null, phone: TELEFONE, summary: null }))
      .toBe("Nome: Não informado\nNúmero: +55 14 99763-1563\nOrigem: não registrada\nResumo: Atendimento humano solicitado.");
  });

  it("motivo que o resumo já diz não se repete; link só http(s)", () => {
    const notice = formatHandoffNotice({ name: "Ana", phone: TELEFONE, summary: "Quer fechar hoje.", reason: "quer fechar hoje", link: "javascript:alert(1)" });
    expect(notice).not.toContain("Motivo:");
    expect(notice).not.toContain("Card:");
    expect(formatHandoffNotice({ name: "Ana", phone: TELEFONE, summary: null, link: "https://app.fechai.test/crm?lead=lead-1" }))
      .toContain("\nCard: https://app.fechai.test/crm?lead=lead-1");
  });

  it("a linha dos comandos do grupo só entra quando a leitura do grupo existir (CRM-08)", () => {
    expect(formatHandoffNotice({ name: "Ana", phone: TELEFONE, summary: null })).not.toContain("assumo");
    expect(formatHandoffNotice({ name: "Ana", phone: TELEFONE, summary: null, commands: true }))
      .toMatch(/\nResponda \*assumo\* ou reaja 👍 para ficar com este lead\. \*#ia\* devolve para a IA\.$/);
  });
});

describe("Simulação de lead prioritário: tool → aviso Evolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    semEsperaAberta();
    whatsappConectado();
    db.conversation.findFirst.mockResolvedValue(conversaReal());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    provider.sendGroupMessage.mockReset();
    provider.sendGroupMessage.mockResolvedValue("aviso-1");
  });

  it("config antiga envia só uma mensagem e preserva exatamente os participantes", async () => {
    db.tenantAction.findUnique.mockResolvedValue({ enabled: true, config: { addToGroup: true, groupId: GRUPO } });
    const participants = new Set(["5514999991111", "5514999992222"]);
    const before = [...participants];
    const delivered: { number: string; text: string }[] = [];
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      // Simula a API antiga: qualquer tentativa de convite muda a lista.
      if (url.includes("/group/updateParticipant")) {
        for (const phone of body.participants) participants.add(phone);
      } else if (url === "https://evolution.test/message/sendText/tenant_tenant-1") {
        delivered.push(body);
      } else throw new Error(`Endpoint inesperado: ${url}`);
      return new Response(JSON.stringify({ key: { id: "aviso-1" } }));
    });
    vi.stubGlobal("fetch", transport);
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.test");
    vi.stubEnv("EVOLUTION_API_KEY", "teste");
    const evolution = new EvolutionProvider();
    provider.sendGroupMessage.mockImplementation((...args) => evolution.sendGroupMessage(...args));
    provider.isConfigured.mockReturnValue(true);
    db.conversation.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const ctx = { tenantId: TENANT, agentId: AGENTE, leadId: "lead-1", conversationId: CONVERSA };
    await runToolHandler("handoff_human", ctx, { reason: "Quer fechar o tratamento hoje." });
    await runToolHandler("handoff_human", ctx, { reason: "Quer fechar o tratamento hoje." });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: CONVERSA, tenantId: TENANT, needsHuman: false }, data: { needsHuman: true },
    });
    expect(delivered).toEqual([{ number: GRUPO,
      text: `Nome: Luciane Aparecida Dos Santos\nNúmero: +55 14 99763-1563\nOrigem: não registrada\nResumo: ${RESUMO}\nMotivo: Quer fechar o tratamento hoje.`
        + "\nResponda *assumo* ou reaja 👍 para ficar com este lead. *#ia* devolve para a IA.",
    }]);
    expect([...participants]).toEqual(before);
    expect(transport).toHaveBeenCalledTimes(1);
    expect("addParticipantToGroup" in evolution).toBe(false);
  });

  it("o envio de grupo recusa destino de pessoa antes de qualquer request", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    await expect(new EvolutionProvider().sendGroupMessage("instancia-1", TELEFONE, "aviso"))
      .rejects.toThrow("ID de grupo inválido");
    expect(transport).not.toHaveBeenCalled();
  });

  it("falha do transporte deixa o handoff marcado e não derruba a tool", async () => {
    acaoConfigurada();
    db.conversation.updateMany.mockResolvedValue({ count: 1 });
    provider.isConfigured.mockReturnValue(true);
    provider.sendGroupMessage.mockRejectedValueOnce(new Error("WhatsApp fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(runToolHandler("handoff_human", { tenantId: TENANT, agentId: AGENTE,
        leadId: "lead-1", conversationId: CONVERSA }, { reason: "Prioridade" }))
        .resolves.toContain("precisa atenção");
      expect(db.conversation.updateMany).toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
