import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * CRM-03 (responsável no quadro), CRM-05 (WhatsApp da equipe) e CRM-06 (aviso
 * de transbordo) contra um PostgreSQL de verdade: índices únicos, a trava
 * `FOR UPDATE` escrita à mão e o fechamento da espera nos caminhos reais.
 * Mesma trava de segurança de `crm-foundation.integration.test.ts`.
 */

const productAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/require-product", () => ({ requireProductAccess: productAccess }));

// CRM-07: o grupo é o do provedor simulado quando o teste liga `fakeGroup.on`,
// ou quando a conta tem uma conexão cujo id começa com "qa-grupo".
const fakeGroup = vi.hoisted(() => ({
  on: false,
  sends: [] as { groupId: string; text: string; quoted: string | null | undefined }[],
  direct: [] as { to: string; text: string }[],
}));
// Ações de /conversas chamadas direto: sessão da pessoa da equipe e sem cache do Next.
const sessionUser = vi.hoisted(() => ({ tenantId: "", id: "" }));
vi.mock("@/lib/session", () => ({
  requireTenant: vi.fn(async () => ({ tenantId: sessionUser.tenantId, session: { user: { id: sessionUser.id, tenantId: sessionUser.tenantId } } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// CRM-10: o escalonamento por e-mail fica guardado aqui em vez de sair.
const mails = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => true,
  sendMail: vi.fn(async (mail: { to: string; subject: string; text: string }) => { mails.push(mail); return { ok: true }; }),
}));
vi.mock("@/modules/whatsapp/instances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/whatsapp/instances")>();
  return {
    ...actual,
    findWhatsappChannel: (async (tenantId: string, provider: "evolution" | "meta") =>
      fakeGroup.on && provider === "evolution"
        ? { id: "qa", tenantId, provider: "evolution", externalId: "qa-grupo", status: "connected" }
        : actual.findWhatsappChannel(tenantId, provider)) as typeof actual.findWhatsappChannel,
  };
});
vi.mock("@/modules/whatsapp/meta-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/whatsapp/meta-config")>();
  return {
    ...actual,
    getWhatsAppProviderForInstance: ((instance: { externalId?: string | null }) => instance.externalId?.startsWith("qa-grupo")
      ? {
          name: "evolution",
          isConfigured: () => true,
          sendGroupMessage: async (_external: string, groupId: string, text: string, quoted?: string | null) => {
            fakeGroup.sends.push({ groupId, text, quoted });
            return `resposta-${fakeGroup.sends.length}`;
          },
          sendMessage: async (_external: string, to: string, text: string) => {
            fakeGroup.direct.push({ to, text });
            return `direta-${randomUUID()}`;
          },
        }
      : actual.getWhatsAppProviderForInstance(instance as never)) as typeof actual.getWhatsAppProviderForInstance,
  };
});

const testUrl = process.env.CRM_TEST_DATABASE_URL?.trim();
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

describe.skipIf(!testUrl)("transbordo e equipe no PostgreSQL", () => {
  const tenantIds: string[] = [];
  let prisma: typeof import("@/lib/prisma").prisma;
  let setCrmEnabled: typeof import("@/modules/crm/activation").setCrmEnabled;
  let getOrCreateConversation: typeof import("@/modules/agent-engine/conversation").getOrCreateConversation;
  let getCrmBoard: typeof import("@/modules/crm/board").getCrmBoard;
  let claimCrmConversation: typeof import("@/modules/crm/assignments").claimCrmConversation;
  let team: typeof import("@/modules/crm/team-whatsapp");
  let notices: typeof import("@/modules/agent-engine/handoff-notice");
  let runToolHandler: typeof import("@/modules/agent-engine/tools").runToolHandler;
  let panel: typeof import("@/modules/crm/handoff-panel");
  let processIncomingWhatsapp: typeof import("@/modules/whatsapp/process-incoming").processIncomingWhatsapp;
  let EvolutionProvider: typeof import("@/modules/whatsapp/evolution").EvolutionProvider;

  beforeAll(async () => {
    if (!testUrl) throw new Error("Defina CRM_TEST_DATABASE_URL.");
    const target = new URL(testUrl);
    const databaseName = decodeURIComponent(target.pathname.slice(1));
    if (!["postgres:", "postgresql:"].includes(target.protocol) || !loopback.has(target.hostname)
      || !/(?:^|[_-])(test|teste|sandbox|lab)(?:$|[_-])/i.test(databaseName)) {
      throw new Error("CRM_TEST_DATABASE_URL deve apontar para um PostgreSQL local de teste.");
    }
    const appUrl = process.env.DATABASE_URL;
    if (appUrl) {
      const app = new URL(appUrl);
      if (loopback.has(app.hostname) && (target.port || "5432") === (app.port || "5432") && target.pathname === app.pathname) {
        throw new Error("A base do teste precisa ser distinta de DATABASE_URL.");
      }
    }
    vi.stubEnv("DATABASE_URL", testUrl);
    vi.stubEnv("AUTH_URL", "https://app.fechai.test");
    ({ prisma } = await import("@/lib/prisma"));
    ({ setCrmEnabled } = await import("@/modules/crm/activation"));
    ({ getOrCreateConversation } = await import("@/modules/agent-engine/conversation"));
    ({ getCrmBoard } = await import("@/modules/crm/board"));
    ({ claimCrmConversation } = await import("@/modules/crm/assignments"));
    team = await import("@/modules/crm/team-whatsapp");
    notices = await import("@/modules/agent-engine/handoff-notice");
    ({ runToolHandler } = await import("@/modules/agent-engine/tools"));
    panel = await import("@/modules/crm/handoff-panel");
    ({ processIncomingWhatsapp } = await import("@/modules/whatsapp/process-incoming"));
    ({ EvolutionProvider } = await import("@/modules/whatsapp/evolution"));
  }, 15_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
        expect(await prisma.teamMemberWhatsapp.count({ where: { tenantId: { in: tenantIds } } })).toBe(0);
        expect(await prisma.handoffNotice.count({ where: { tenantId: { in: tenantIds } } })).toBe(0);
      }
    } finally {
      await prisma?.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  async function createTenant(crm = true) {
    const tenant = await prisma.tenant.create({ data: { name: "Clínica de teste do transbordo" } });
    tenantIds.push(tenant.id);
    if (crm) await setCrmEnabled(tenant.id, true);
    productAccess.mockResolvedValue({ session: { user: { tenantId: tenant.id, role: "OWNER" } } });
    return tenant.id;
  }

  const person = (tenantId: string, name: string) =>
    prisma.user.create({ data: { tenantId, name, email: `${randomUUID()}@example.test` } });

  it("CRM-03: filtra o quadro por pessoa, sem responsável e humano não identificado", async () => {
    const tenantId = await createTenant();
    const marina = await person(tenantId, "Marina");
    const humanStage = await prisma.pipelineStage.findFirstOrThrow({ where: { tenantId, kind: "human" } });
    const assigned = await getOrCreateConversation(tenantId, "5511940001001");
    const unidentified = await getOrCreateConversation(tenantId, "5511940001002");
    const nobody = await getOrCreateConversation(tenantId, "5511940001003");
    await prisma.conversation.update({ where: { id: assigned.conversation.id }, data: { assignedUserId: marina.id, assignedAt: new Date() } });
    await prisma.lead.update({ where: { id: unidentified.lead.id }, data: { stageId: humanStage.id } });

    const ids = (board: Awaited<ReturnType<typeof getCrmBoard>>) => board.columns.flatMap(({ cards }) => cards.map(({ id }) => id));
    const byMarina = await getCrmBoard({ responsavel: marina.id });
    expect(ids(byMarina)).toEqual([assigned.lead.id]);
    expect(byMarina.columns.flatMap(({ cards }) => cards)[0].assignee).toEqual({ kind: "user", label: "Marina" });
    expect(byMarina.users).toEqual(expect.arrayContaining([{ id: marina.id, name: "Marina" }]));
    expect(ids(await getCrmBoard({ responsavel: "nao-identificado" }))).toEqual([unidentified.lead.id]);
    expect(ids(await getCrmBoard({ responsavel: "sem" }))).toEqual([nobody.lead.id]);
    expect(ids(await getCrmBoard({})).sort()).toEqual([assigned.lead.id, unidentified.lead.id, nobody.lead.id].sort());
    // Combinado com etapa, continua na URL e não mistura filtros.
    expect(ids(await getCrmBoard({ responsavel: "sem", etapa: humanStage.id }))).toEqual([]);
  });

  it("CRM-05: confirma pelo código, mantém o número único na conta e acha pelo número e pelo LID", async () => {
    const tenantId = await createTenant(false);
    const otherTenant = await createTenant(false);
    const ana = await person(tenantId, "Ana");
    const bruno = await person(tenantId, "Bruno");

    const started = await team.startTeamWhatsappLink(tenantId, ana.id, "(11) 98765-4321");
    if (started.status !== "started") throw new Error(started.status);
    const stored = await prisma.teamMemberWhatsapp.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId: ana.id } } });
    expect(stored.codeHash).not.toContain(started.code);
    expect(await team.resolveGroupMember(tenantId, "5511987654321")).toBeNull();

    expect(await team.confirmTeamWhatsappLink({ tenantId, code: started.code === "000000" ? "111111" : "000000", senderPhone: "5511987654321" }))
      .toEqual({ status: "invalid" });
    // Sem o nono dígito, como o WhatsApp às vezes entrega: é o mesmo celular.
    expect(await team.confirmTeamWhatsappLink({ tenantId, code: started.code, senderPhone: "551187654321", senderLid: "123451234512345" }))
      .toEqual({ status: "verified", userId: ana.id, name: "Ana" });
    expect(await team.confirmTeamWhatsappLink({ tenantId, code: started.code, senderPhone: "5511987654321" })).toEqual({ status: "invalid" });

    expect(await team.resolveGroupMember(tenantId, "5511987654321@s.whatsapp.net")).toEqual({ userId: ana.id, name: "Ana" });
    expect(await team.resolveGroupMember(tenantId, "123451234512345@lid")).toEqual({ userId: ana.id, name: "Ana" });
    expect(await team.resolveGroupMember(otherTenant, "5511987654321")).toBeNull();

    // A mesma pessoa não pode ser ligada a dois usuários da conta.
    expect(await team.startTeamWhatsappLink(tenantId, bruno.id, "11 98765-4321")).toEqual({ status: "taken" });
    const brunoStart = await team.startTeamWhatsappLink(tenantId, bruno.id, "(21) 91234-5678");
    expect(brunoStart.status).toBe("started");
    await expect(prisma.teamMemberWhatsapp.update({
      where: { tenantId_userId: { tenantId, userId: bruno.id } }, data: { phoneKey: stored.pendingKey, verifiedAt: new Date() },
    })).rejects.toMatchObject({ code: "P2002" } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
    expect(await team.resolveGroupMember(tenantId, "5521912345678")).toBeNull();

    await team.learnTeamMemberLid(tenantId, "5511987654321", "999998888877777");
    expect(await team.resolveGroupMember(tenantId, "999998888877777@lid")).toMatchObject({ userId: ana.id });
    expect(await team.resolveGroupMember(tenantId, "123451234512345@lid")).toBeNull();
  });

  it("CRM-06: uma espera aberta por conversa mesmo com dois transbordos ao mesmo tempo, e fechamento no Assumir", async () => {
    const tenantId = await createTenant();
    const marina = await person(tenantId, "Marina");
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940002001");
    const open = () => notices.openHandoffNotice({ tenantId, conversationId: conversation.id, trigger: "agent", reason: "Quer fechar hoje" });

    const results = await Promise.all([open(), open()]);
    expect(results.map((r) => r?.created).sort()).toEqual([false, true]);
    const waiting = await prisma.handoffNotice.findMany({ where: { tenantId, conversationId: conversation.id, status: "waiting" } });
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ trigger: "agent", repeatCount: 1, reason: "Quer fechar hoje" });

    await notices.recordHandoffNoticeSent(tenantId, waiting[0].id, { groupId: "120363012345678901@g.us", messageId: "msg-grupo-1" });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: waiting[0].id } })).toMatchObject({ messageId: "msg-grupo-1", sentAt: expect.any(Date) });

    expect(await claimCrmConversation({ tenantId, leadId: lead.id, conversationId: conversation.id, userId: marina.id })).toBe("claimed");
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: waiting[0].id } })).toMatchObject({
      status: "assumed", assumedVia: "panel", assignedUserId: marina.id, assumedAt: expect.any(Date), closedAt: expect.any(Date),
    });
    // Espera fechada: o próximo transbordo abre outra e volta a avisar.
    expect((await open())?.created).toBe(true);
    expect(await notices.closeHandoffNotices(tenantId, conversation.id, { status: "returned" })).toBe(1);
  });

  it("CRM-06: conta só com a Meta transborda pela tool, com o card em Aguardando humano e a IA pausada", async () => {
    const tenantId = await createTenant();
    const agent = await prisma.agent.create({ data: { tenantId } });
    await prisma.tenantAction.create({ data: { tenantId, agentId: agent.id, key: "handoff_human", enabled: true,
      config: { notifyGroup: true, groupId: "120363012345678901@g.us", whileWaiting: "pause" } } });
    await prisma.whatsappInstance.create({ data: { tenantId, provider: "meta", status: "connected", externalId: `meta-${randomUUID()}` } });
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940003001");
    await prisma.conversation.update({ where: { id: conversation.id }, data: { agentId: agent.id } });

    const reply = await runToolHandler("handoff_human", { tenantId, agentId: agent.id, leadId: lead.id, conversationId: conversation.id },
      { reason: "Pediu a recepção" });
    expect(reply).toContain("precisa atenção");

    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { needsHuman: true, agentPaused: true } }))
      .toEqual({ needsHuman: true, agentPaused: true });
    const stage = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { stage: { select: { kind: true } } } });
    expect(stage.stage?.kind).toBe("waiting_human");
    expect(await prisma.handoffNotice.findMany({ where: { tenantId }, select: { status: true, trigger: true, messageId: true, groupId: true } }))
      .toEqual([{ status: "waiting", trigger: "agent", messageId: null, groupId: null }]);
  });

  async function sentNotice(tenantId: string, conversationId: string) {
    const notice = await notices.openHandoffNotice({ tenantId, conversationId, trigger: "agent", reason: "Quer falar com a recepção" });
    await notices.recordHandoffNoticeSent(tenantId, notice!.id, { groupId: "120363012345678901@g.us", messageId: "aviso-original" });
    await prisma.conversation.update({ where: { id: conversationId }, data: { needsHuman: true } });
    return notice!.id;
  }

  it("CRM-07: duas pessoas assumem ao mesmo tempo, só uma fica, e o grupo recebe a resposta citando o aviso", async () => {
    const tenantId = await createTenant();
    const [ana, bia] = await Promise.all([person(tenantId, "Ana"), person(tenantId, "Bia")]);
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940007001");
    await sentNotice(tenantId, conversation.id);
    fakeGroup.on = true; fakeGroup.sends.length = 0;
    try {
      const results = await Promise.all([ana, bia].map((user) =>
        claimCrmConversation({ tenantId, leadId: lead.id, conversationId: conversation.id, userId: user.id })));
      expect(results.sort()).toEqual(["assigned_elsewhere", "claimed"]);
      const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { assignedUserId: true, agentPaused: true } });
      const winner = row.assignedUserId === ana.id ? "Ana" : "Bia";
      expect(row.agentPaused).toBe(true);
      expect(fakeGroup.sends).toEqual([{ groupId: "120363012345678901@g.us", text: `✅ ${winner} assumiu pelo Fechai`, quoted: "aviso-original" }]);
      expect(await panel.currentAssigneeName(tenantId, conversation.id)).toBe(winner);
    } finally {
      fakeGroup.on = false;
    }
  });

  it("CRM-07: transferir troca o responsável só se ele não mudou, e devolver leva o card à IA com a espera devolvida", async () => {
    const tenantId = await createTenant();
    await prisma.agent.create({ data: { tenantId, enabled: true } });
    const [ana, bia] = await Promise.all([person(tenantId, "Ana"), person(tenantId, "Bia")]);
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940007002");
    const noticeId = await sentNotice(tenantId, conversation.id);
    fakeGroup.on = true; fakeGroup.sends.length = 0;
    try {
      expect(await claimCrmConversation({ tenantId, leadId: lead.id, conversationId: conversation.id, userId: ana.id })).toBe("claimed");
      // A tela ainda mostrava ninguém/outra pessoa: nada muda.
      expect(await panel.transferCrmConversation({ tenantId, conversationId: conversation.id, actorUserId: bia.id, toUserId: bia.id, expectedUserId: randomUUID() }))
        .toEqual({ status: "changed", currentUserId: ana.id });
      expect(await panel.transferCrmConversation({ tenantId, conversationId: conversation.id, actorUserId: ana.id, toUserId: bia.id, expectedUserId: ana.id }))
        .toEqual({ status: "transferred" });
      expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { assignedUserId: true } })).toEqual({ assignedUserId: bia.id });
      expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { status: true, assignedUserId: true } }))
        .toEqual({ status: "assumed", assignedUserId: bia.id });

      expect(await panel.returnConversationToAi({ tenantId, conversationId: conversation.id, actorUserId: bia.id }))
        .toMatchObject({ status: "returned" });
      expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id },
        select: { assignedUserId: true, agentPaused: true, needsHuman: true, agentId: true } }))
        .toEqual({ assignedUserId: null, agentPaused: false, needsHuman: false, agentId: expect.any(String) });
      const stage = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { stage: { select: { kind: true } } } });
      expect(stage.stage?.kind).toBe("ai");
      expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { status: true } })).toEqual({ status: "returned" });
      expect(await prisma.conversationAssignment.count({ where: { tenantId, conversationId: conversation.id } })).toBe(3);

      expect(fakeGroup.sends.map(({ text, quoted }) => [text, quoted])).toEqual([
        ["✅ Ana assumiu pelo Fechai", "aviso-original"],
        ["🔁 Transferido para Bia por Ana", "aviso-original"],
        ["↩️ Lead devolvido para a IA por Bia", "aviso-original"],
      ]);
      // Reativar de novo, sem atendimento em curso, não reabre o assunto no grupo.
      await panel.returnConversationToAi({ tenantId, conversationId: conversation.id, actorUserId: ana.id });
      expect(fakeGroup.sends).toHaveLength(3);
    } finally {
      fakeGroup.on = false;
    }
  });

  it("CRM-07: em Conversas, sem CRM, assumir, responder, transferir, resolver e reativar contam no grupo só com atendimento em curso", async () => {
    const tenantId = await createTenant(false);
    const [ana, bia] = await Promise.all([person(tenantId, "Ana"), person(tenantId, "Bia")]);
    await prisma.agent.create({ data: { tenantId, enabled: true } });
    await prisma.whatsappInstance.create({ data: { tenantId, provider: "evolution", status: "connected", externalId: `qa-grupo-${randomUUID()}` } });
    const actions = await import("@/app/(dashboard)/conversas/actions");
    const { sendManualReply } = await import("@/modules/agent-engine/conversation");
    const as = (userId: string) => Object.assign(sessionUser, { tenantId, id: userId });
    const row = (id: string) => prisma.conversation.findUniqueOrThrow({ where: { id }, select: { assignedUserId: true, agentPaused: true, needsHuman: true } });
    fakeGroup.sends.length = 0; fakeGroup.direct.length = 0;

    // Assumir (botão de Conversas) define a responsável mesmo sem CRM; a segunda pessoa ouve com quem está.
    const { conversation: first } = await getOrCreateConversation(tenantId, "5511940007101");
    await sentNotice(tenantId, first.id);
    as(ana.id);
    expect(await actions.setConversationAgentPaused(first.id, true)).toEqual({ ok: true });
    as(bia.id);
    expect(await actions.setConversationAgentPaused(first.id, true)).toEqual({ ok: false, error: "Esta conversa já está com Ana." });
    expect(await row(first.id)).toEqual({ assignedUserId: ana.id, agentPaused: true, needsHuman: false });

    // Transferir em Conversas.
    as(ana.id);
    expect(await actions.transferConversation(first.id, bia.id, ana.id)).toMatchObject({ ok: true });
    expect((await row(first.id)).assignedUserId).toBe(bia.id);

    // Responder pelo painel: quem respondeu assume e o grupo fica sabendo; a segunda resposta não repete.
    const { conversation: second } = await getOrCreateConversation(tenantId, "5511940007102");
    await sentNotice(tenantId, second.id);
    expect(await sendManualReply(tenantId, second.id, "Oi, aqui é a Bia.", undefined, undefined, bia.id)).toEqual({ ok: true });
    expect(await sendManualReply(tenantId, second.id, "Já te ajudo.", undefined, undefined, bia.id)).toEqual({ ok: true });
    expect((await row(second.id)).assignedUserId).toBe(bia.id);
    expect(fakeGroup.direct.map(({ text }) => text)).toEqual(["Oi, aqui é a Bia.", "Já te ajudo."]);

    // Resolver encerra a espera aberta e conta no grupo; sem espera aberta, fica quieto.
    const { conversation: third } = await getOrCreateConversation(tenantId, "5511940007103");
    await sentNotice(tenantId, third.id);
    as(ana.id);
    expect(await actions.resolveConversation(third.id)).toEqual({ ok: true });
    expect(await actions.resolveConversation(third.id)).toEqual({ ok: true });

    // Reativar o agente devolve: tira a responsável, conta no grupo uma vez.
    expect(await actions.setConversationAgentPaused(first.id, false)).toMatchObject({ ok: true });
    expect(await row(first.id)).toEqual({ assignedUserId: null, agentPaused: false, needsHuman: false });
    expect(await actions.setConversationAgentPaused(first.id, false)).toMatchObject({ ok: true });

    expect(fakeGroup.sends.map(({ text, quoted }) => [text, quoted])).toEqual([
      ["✅ Ana assumiu pelo Fechai", "aviso-original"],
      ["🔁 Transferido para Bia por Ana", "aviso-original"],
      ["✅ Bia assumiu pelo Fechai", "aviso-original"],
      ["✅ Ana resolveu pelo Fechai", "aviso-original"],
      ["↩️ Lead devolvido para a IA por Ana", "aviso-original"],
    ]);
  });

  it("CRM-07: devolvida para a IA, a próxima mensagem do contato passa pela trava da pausa", async () => {
    const tenantId = await createTenant();
    // Cota zerada: o turno para logo depois da trava da pausa, sem chamar a IA de verdade.
    await prisma.tenant.update({ where: { id: tenantId }, data: { messageLimitOverride: 0 } });
    await prisma.agent.create({ data: { tenantId, enabled: true } });
    const ana = await person(tenantId, "Ana");
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940007201");
    const { runAgentTurn } = await import("@/modules/agent-engine/orchestrator");
    const turn = (userMessage: string) => runAgentTurn({ tenantId, conversationId: conversation.id, leadId: lead.id, userMessage });

    expect(await claimCrmConversation({ tenantId, leadId: lead.id, conversationId: conversation.id, userId: ana.id })).toBe("claimed");
    expect((await turn("Oi, ainda está aí?")).status).toBe("human_handling");

    expect(await panel.returnConversationToAi({ tenantId, conversationId: conversation.id, actorUserId: ana.id }))
      .toMatchObject({ status: "returned" });
    expect((await turn("Quero agendar")).status).toBe("limit_reached");
  });

  // CRM-08: o grupo de transbordo pelo mesmo caminho do webhook (parser da
  // Evolution + processIncomingWhatsapp), com o envio ao grupo simulado.
  const GROUP = "120363012345678901@g.us";

  async function groupAccount(ignoreGroups: boolean) {
    const tenantId = await createTenant();
    await prisma.tenant.update({ where: { id: tenantId }, data: { whatsappIgnoreGroups: ignoreGroups } });
    const externalId = `qa-${randomUUID()}`;
    await prisma.whatsappInstance.create({ data: { tenantId, provider: "evolution", status: "connected", externalId } });
    const agent = await prisma.agent.create({ data: { tenantId, enabled: true } });
    await prisma.tenantAction.create({ data: { tenantId, agentId: agent.id, key: "handoff_human", enabled: true,
      config: { notifyGroup: true, groupId: GROUP } } });
    const replies: { text: string; quoted: string | null | undefined }[] = [];
    const provider = new EvolutionProvider();
    provider.sendGroupMessage = async (_external, _group, text, quoted) => {
      replies.push({ text, quoted });
      return `resposta-${replies.length}`;
    };
    const deliver = (key: Record<string, unknown>, message: Record<string, unknown>) => {
      const incoming = provider.parseWebhook({ event: "messages.upsert", instance: externalId,
        data: { key: { remoteJid: GROUP, fromMe: false, id: `QA-${randomUUID()}`, ...key }, message } });
      if (!incoming) throw new Error("payload não reconhecido");
      return processIncomingWhatsapp(incoming, provider);
    };
    return { tenantId, replies, deliver };
  }

  async function linkedMember(tenantId: string, name: string, phone: string) {
    const user = await person(tenantId, name);
    const started = await team.startTeamWhatsappLink(tenantId, user.id, phone);
    if (started.status !== "started") throw new Error(started.status);
    await team.confirmTeamWhatsappLink({ tenantId, code: started.code, senderPhone: phone });
    return user;
  }

  async function waitingLead(tenantId: string, phone: string, messageId: string) {
    const { lead, conversation } = await getOrCreateConversation(tenantId, phone);
    const notice = await notices.openHandoffNotice({ tenantId, conversationId: conversation.id, trigger: "agent", reason: "Quer fechar" });
    await notices.recordHandoffNoticeSent(tenantId, notice!.id, { groupId: GROUP, messageId });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { needsHuman: true } });
    return { lead, conversation, noticeId: notice!.id };
  }

  const leadCount = (tenantId: string) => prisma.lead.count({ where: { tenantId } });
  const quote = (text: string, stanzaId?: string) =>
    ({ extendedTextMessage: { text, ...(stanzaId ? { contextInfo: { stanzaId } } : {}) } });
  const stageOf = async (leadId: string) =>
    (await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { stage: { select: { kind: true } } } })).stage?.kind;

  it("CRM-08: \"assumo\" citando o aviso define o responsável; o segundo ouve com quem está; sem citação é ignorado", async () => {
    const { tenantId, replies, deliver } = await groupAccount(true);
    const ana = await linkedMember(tenantId, "Ana", "5511987654321");
    await linkedMember(tenantId, "Bia", "5521912345678");
    const { lead, conversation, noticeId } = await waitingLead(tenantId, "5511940008001", "AVISO-A");
    const leads = await leadCount(tenantId);

    // Sem citar o aviso: nada muda e nada é respondido, mesmo com "ignorar grupos" ligado.
    expect((await deliver({ participant: "5511987654321@s.whatsapp.net" }, quote("assumo"))).body)
      .toMatchObject({ silent: "grupo de transbordo" });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { assignedUserId: true } }))
      .toEqual({ assignedUserId: null });
    expect(replies).toEqual([]);

    await deliver({ participant: "5511987654321@s.whatsapp.net" }, quote("Assumo!", "AVISO-A"));
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id },
      select: { assignedUserId: true, agentPaused: true, needsHuman: true } }))
      .toEqual({ assignedUserId: ana.id, agentPaused: true, needsHuman: false });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { status: true, assumedVia: true, assignedUserId: true } }))
      .toEqual({ status: "assumed", assumedVia: "group", assignedUserId: ana.id });
    expect(await stageOf(lead.id)).toBe("human");
    expect(await prisma.conversationAssignment.findFirst({ where: { tenantId, conversationId: conversation.id }, select: { via: true, toUserId: true } }))
      .toEqual({ via: "group", toUserId: ana.id });

    // O segundo a responder não toma o lead.
    await deliver({ participant: "5521912345678@s.whatsapp.net" }, quote("eu", "AVISO-A"));
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { assignedUserId: true } }))
      .toEqual({ assignedUserId: ana.id });
    expect(replies).toEqual([
      { text: "✅ Ana assumiu este lead.", quoted: "AVISO-A" },
      { text: "Este lead já está com Ana.", quoted: "AVISO-A" },
    ]);
    expect(await leadCount(tenantId)).toBe(leads);
  });

  it("CRM-08: 👍 de número não vinculado assume como humano não identificado, e \"#ia\" devolve para a IA", async () => {
    const { replies, deliver, tenantId } = await groupAccount(true);
    const { lead, conversation, noticeId } = await waitingLead(tenantId, "5511940008002", "AVISO-B");

    await deliver({ participant: "5531999998888@s.whatsapp.net" },
      { reactionMessage: { text: "👍🏽", key: { remoteJid: GROUP, id: "AVISO-B", fromMe: true } } });
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { assignedUserId: true, agentPaused: true } }))
      .toEqual({ assignedUserId: null, agentPaused: true });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { status: true, assumedVia: true, assumedByPhone: true } }))
      .toEqual({ status: "assumed", assumedVia: "group", assumedByPhone: "5531999998888" });
    expect(replies.at(-1)?.text).toContain("número ainda não ligado ao Fechai (final 8888)");
    // Em atendimento humano sem pessoa é o "humano não identificado" do quadro (CRM-03).
    expect(await stageOf(lead.id)).toBe("human");

    fakeGroup.on = true; fakeGroup.sends.length = 0;
    try {
      await deliver({ participant: "5531999998888@s.whatsapp.net" }, quote("#ia", "AVISO-B"));
    } finally {
      fakeGroup.on = false;
    }
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id },
      select: { agentPaused: true, needsHuman: true, assignedUserId: true } }))
      .toEqual({ agentPaused: false, needsHuman: false, assignedUserId: null });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { status: true } })).toEqual({ status: "returned" });
    expect(await stageOf(lead.id)).toBe("ai");
    expect(fakeGroup.sends).toEqual([{ groupId: GROUP, text: "↩️ Lead devolvido para a IA por Alguém da equipe", quoted: "AVISO-B" }]);
  });

  it("CRM-08: com \"ignorar grupos\" desligado, nada do grupo de transbordo vira lead, conversa, mensagem ou turno", async () => {
    const { tenantId, replies, deliver } = await groupAccount(false);
    await waitingLead(tenantId, "5511940008003", "AVISO-C");
    const count = () => Promise.all([
      leadCount(tenantId),
      prisma.conversation.count({ where: { tenantId } }),
      prisma.message.count({ where: { conversation: { tenantId } } }),
    ]);
    const before = await count();

    for (const body of [quote("bom dia, pessoal"), quote("alguém viu o aviso?", "OUTRA"), quote("assumo")]) {
      expect((await deliver({ participant: "5511987654321@s.whatsapp.net" }, body)).body)
        .toMatchObject({ silent: "grupo de transbordo" });
    }
    // O eco das nossas próprias respostas no grupo também para aqui.
    expect((await deliver({ fromMe: true }, quote("✅ Ana assumiu este lead.", "AVISO-C"))).body)
      .toMatchObject({ silent: "grupo de transbordo" });

    expect(await count()).toEqual(before);
    expect(replies).toEqual([]);
  });

  // CRM-09: resposta da equipe pelo celular da clínica, pelo caminho real do
  // webhook (eco `fromMe` da Evolution). A conexão "qa-grupo-…" faz o aviso no
  // grupo cair no provedor simulado (`fakeGroup.sends`).
  async function phoneAccount() {
    const tenantId = await createTenant();
    const externalId = `qa-grupo-${randomUUID()}`;
    await prisma.whatsappInstance.create({ data: { tenantId, provider: "evolution", status: "connected", externalId } });
    const agent = await prisma.agent.create({ data: { tenantId, enabled: true } });
    await prisma.tenantAction.create({ data: { tenantId, agentId: agent.id, key: "handoff_human", enabled: true,
      config: { notifyGroup: true, groupId: GROUP } } });
    const groupReplies: string[] = [];
    const provider = new EvolutionProvider();
    provider.sendGroupMessage = async (_external, _group, text) => {
      groupReplies.push(text);
      return `resposta-${groupReplies.length}`;
    };
    const deliver = (key: Record<string, unknown>, message: Record<string, unknown>) => {
      const incoming = provider.parseWebhook({ event: "messages.upsert", instance: externalId,
        data: { key: { fromMe: false, id: `QA-${randomUUID()}`, ...key }, message } });
      if (!incoming) throw new Error("payload não reconhecido");
      return processIncomingWhatsapp(incoming, provider);
    };
    /** O atendente escrevendo pelo celular da clínica para o contato. */
    const fromPhone = (phone: string, text: string, id = `QA-${randomUUID()}`) =>
      deliver({ remoteJid: `${phone}@s.whatsapp.net`, fromMe: true, id }, { conversation: text });
    fakeGroup.sends.length = 0;
    return { tenantId, agentId: agent.id, deliver, fromPhone, groupReplies };
  }

  const humanReplies = (conversationId: string) => prisma.message.findMany({
    where: { conversationId, sentBy: "human" }, orderBy: { createdAt: "asc" }, select: { content: true, sentVia: true, sentByUserId: true },
  });

  it("CRM-09: resposta pelo celular sem responsável move o card, pausa a IA, fica como não identificada e o grupo pergunta quem foi; \"Fui eu\" identifica", async () => {
    const { tenantId, fromPhone } = await phoneAccount();
    const ana = await person(tenantId, "Ana");
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940009001");
    const noticeId = await sentNotice(tenantId, conversation.id);

    expect((await fromPhone("5511940009001", "Oi! Aqui é da clínica.")).body).toMatchObject({ silent: "manual pelo whatsapp" });
    await fromPhone("5511940009001", "Consigo te encaixar amanhã.");

    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id },
      select: { agentPaused: true, needsHuman: true, assignedUserId: true } }))
      .toEqual({ agentPaused: true, needsHuman: false, assignedUserId: null });
    expect(await stageOf(lead.id)).toBe("human");
    expect(await humanReplies(conversation.id)).toEqual([
      { content: "Oi! Aqui é da clínica.", sentVia: "phone", sentByUserId: null },
      { content: "Consigo te encaixar amanhã.", sentVia: "phone", sentByUserId: null },
    ]);
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { status: true, assumedVia: true, assignedUserId: true } }))
      .toEqual({ status: "assumed", assumedVia: "phone", assignedUserId: null });
    // Uma pergunta só, na resposta que encerrou a espera, citando o aviso.
    expect(fakeGroup.sends).toEqual([
      { groupId: "120363012345678901@g.us", text: "📱 Alguém respondeu pelo celular da clínica. Quem foi? Responda *assumo*", quoted: "aviso-original" },
    ]);

    const { claimPhoneReplies } = await import("@/modules/crm/phone-reply");
    expect(await claimPhoneReplies({ tenantId, leadId: lead.id, conversationId: conversation.id, userId: ana.id })).toBe("identified");
    expect((await humanReplies(conversation.id)).map(({ sentByUserId }) => sentByUserId)).toEqual([ana.id, ana.id]);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { assignedUserId: true } }))
      .toEqual({ assignedUserId: ana.id });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { assignedUserId: true } }))
      .toEqual({ assignedUserId: ana.id });
    expect(fakeGroup.sends.at(-1)?.text).toBe("📱 Ana respondeu pelo celular da clínica.");
  });

  it("CRM-09: com responsável, a resposta pelo celular fica atribuída a ele", async () => {
    const { tenantId, fromPhone } = await phoneAccount();
    const bia = await person(tenantId, "Bia");
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940009002");
    expect(await claimCrmConversation({ tenantId, leadId: lead.id, conversationId: conversation.id, userId: bia.id })).toBe("claimed");

    await fromPhone("5511940009002", "Já te ligo.");
    expect(await humanReplies(conversation.id)).toEqual([{ content: "Já te ligo.", sentVia: "phone", sentByUserId: bia.id }]);
    // Sem espera aberta, o grupo não é incomodado.
    expect(fakeGroup.sends).toEqual([]);
  });

  it("CRM-09: \"assumo\" no grupo depois da resposta pelo celular identifica quem respondeu", async () => {
    const { tenantId, fromPhone, deliver, groupReplies } = await phoneAccount();
    const bia = await linkedMember(tenantId, "Bia", "5521912345678");
    const { conversation } = await getOrCreateConversation(tenantId, "5511940009003");
    await sentNotice(tenantId, conversation.id);

    await fromPhone("5511940009003", "Oi, tudo bem?");
    await deliver({ remoteJid: GROUP, participant: "5521912345678@s.whatsapp.net" },
      { extendedTextMessage: { text: "assumo", contextInfo: { stanzaId: "aviso-original" } } });

    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { assignedUserId: true } }))
      .toEqual({ assignedUserId: bia.id });
    expect(await humanReplies(conversation.id)).toEqual([{ content: "Oi, tudo bem?", sentVia: "phone", sentByUserId: bia.id }]);
    expect(groupReplies).toEqual(["✅ Bia assumiu este lead."]);
  });

  it("CRM-09: os ecos da IA, do lembrete, da pesquisa e dos avisos no grupo não viram resposta humana nem mudam a etapa", async () => {
    const { tenantId, fromPhone, deliver } = await phoneAccount();
    const phone = "5511940009004";
    const { lead, conversation } = await getOrCreateConversation(tenantId, phone);
    const before = await stageOf(lead.id);
    const { appendMessage } = await import("@/modules/agent-engine/conversation");

    // IA: o eco chega com o id que o orquestrador gravou…
    // (a reentrega com id já gravado para antes mesmo do caminho do `fromMe`).
    await appendMessage(conversation.id, "assistant", "Olá! Posso ajudar?", "agent", "ECO-IA-1");
    expect((await fromPhone(phone, "Olá! Posso ajudar?", "ECO-IA-1")).body).toMatchObject({ silent: "mensagem já registrada" });
    // …ou antes de o id ser gravado: mesmo texto da IA nos últimos 15 s.
    await appendMessage(conversation.id, "assistant", "Tenho horário amanhã às 9h.", "agent");
    expect((await fromPhone(phone, "Tenho horário amanhã às 9h.")).body).toMatchObject({ silent: "fromMe eco" });
    // Lembrete cujo histórico o worker ainda não gravou: a prova é o id do envio.
    await prisma.reminderDispatch.create({ data: { tenantId, sourceKey: `qa-${randomUUID()}`, startsAt: new Date(Date.now() + 86_400_000),
      minutesBefore: 1440, state: "accepted", provider: "evolution", messageId: "ECO-LEMBRETE-1", conversationId: conversation.id } });
    expect((await fromPhone(phone, "Lembrete: sua consulta é amanhã.", "ECO-LEMBRETE-1")).body).toMatchObject({ silent: "fromMe eco" });
    // Pesquisa de satisfação.
    await prisma.satisfactionSurvey.create({ data: { tenantId, conversationId: conversation.id, provider: "evolution", status: "awaiting_rating",
      ratingMsgId: "ECO-PESQUISA-1" } });
    expect((await fromPhone(phone, "De 1 a 5, como foi o atendimento?", "ECO-PESQUISA-1")).body).toMatchObject({ silent: "pesquisa de satisfação" });
    // Avisos da equipe no grupo (transbordo, alerta, devolução): eco de grupo.
    expect((await deliver({ remoteJid: GROUP, fromMe: true }, { conversation: "⏰ Aguardando há 15 min" })).body)
      .toMatchObject({ silent: "grupo de transbordo" });

    expect(await humanReplies(conversation.id)).toEqual([]);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, select: { agentPaused: true } }))
      .toEqual({ agentPaused: false });
    expect(await stageOf(lead.id)).toBe(before);
    expect(fakeGroup.sends).toEqual([]);
  });

  // CRM-10: o relógio é simulado no passado (10+ dias atrás), então as esperas
  // criadas agora pelos outros testes ficam com tempo zero nessas voltas.
  async function slaWait(tenantId: string, phone: string, createdAt: Date, messageId: string) {
    const { lead, conversation } = await getOrCreateConversation(tenantId, phone);
    const notice = await notices.openHandoffNotice({ tenantId, conversationId: conversation.id, trigger: "agent", reason: "Quer agendar" });
    await notices.recordHandoffNoticeSent(tenantId, notice!.id, { groupId: GROUP, messageId });
    await prisma.handoffNotice.update({ where: { id: notice!.id }, data: { createdAt } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { needsHuman: true } });
    return { lead, conversation, noticeId: notice!.id };
  }

  it("CRM-10: com o relógio simulado, o alerta no grupo sai no 15º minuto e o escalonamento no 60º, uma vez cada", async () => {
    const tenantId = await createTenant();
    await prisma.whatsappInstance.create({ data: { tenantId, provider: "evolution", status: "connected", externalId: `qa-grupo-${randomUUID()}` } });
    const owner = await person(tenantId, "Dona da clínica");
    const t0 = new Date(Date.now() - 10 * 86_400_000);
    const { lead, noticeId } = await slaWait(tenantId, "5511940010001", t0, "aviso-sla");
    const { scanHandoffSla } = await import("@/modules/crm/handoff-sla");
    const scan = (minutes: number) => scanHandoffSla(new Date(+t0 + minutes * 60_000));
    fakeGroup.sends.length = 0; mails.length = 0;

    // Sem horário de atendimento cadastrado, o prazo corre o tempo todo.
    expect(await scan(14)).toEqual({ alerts: 0, escalations: 0 });
    expect(await scan(15)).toEqual({ alerts: 1, escalations: 0 });
    expect(await scan(16)).toEqual({ alerts: 0, escalations: 0 });
    expect(fakeGroup.sends).toEqual([{ groupId: GROUP, text: "⏰ Aguardando há 15 min", quoted: "aviso-sla" }]);
    expect(await scan(59)).toEqual({ alerts: 0, escalations: 0 });
    expect(await scan(60)).toEqual({ alerts: 0, escalations: 1 });
    expect(await scan(120)).toEqual({ alerts: 0, escalations: 0 });

    // Escalonamento: e-mail aos donos com o link do card, sem nome nem telefone do contato.
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: owner.email, subject: "Um lead passou do prazo de espera da equipe" });
    expect(mails[0].text).toContain(`https://app.fechai.test/crm?lead=${lead.id}`);
    expect(mails[0].text).not.toContain("5511940010001");
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { alertedAt: true, escalatedAt: true } }))
      .toEqual({ alertedAt: new Date(+t0 + 15 * 60_000), escalatedAt: new Date(+t0 + 60 * 60_000) });
    expect(fakeGroup.sends).toHaveLength(1);
  });

  it("CRM-10: fora do expediente não há alerta (padrão), e assumir para o relógio e mostra quanto levou", async () => {
    const tenantId = await createTenant();
    await prisma.whatsappInstance.create({ data: { tenantId, provider: "evolution", status: "connected", externalId: `qa-grupo-${randomUUID()}` } });
    const ana = await person(tenantId, "Ana");
    const agent = await prisma.agent.create({ data: { tenantId, enabled: true, isPrimary: true } });
    const weekday = [{ start: 8 * 60, end: 18 * 60 }];
    await prisma.tenantAction.create({ data: { tenantId, agentId: agent.id, key: "schedule_meeting", enabled: true,
      config: { timezone: "America/Sao_Paulo", weeklyAvailability: [[], weekday, weekday, weekday, weekday, weekday, []] } } });
    // Um sábado às 10h (Brasília), pelo menos 9 dias atrás.
    const saturday = new Date(Date.now() - 9 * 86_400_000);
    while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() - 1);
    saturday.setUTCHours(13, 0, 0, 0);
    const { lead, conversation, noticeId } = await slaWait(tenantId, "5511940010002", saturday, "aviso-fim-de-semana");
    const { scanHandoffSla } = await import("@/modules/crm/handoff-sla");
    const monday = (hour: number, minute: number) => new Date(+saturday + 2 * 86_400_000 + ((hour - 10) * 60 + minute) * 60_000);
    fakeGroup.sends.length = 0; mails.length = 0;

    // Sábado à tarde e domingo: o tempo não corre.
    expect(await scanHandoffSla(new Date(+saturday + 5 * 3600_000))).toEqual({ alerts: 0, escalations: 0 });
    expect(await scanHandoffSla(new Date(+saturday + 30 * 3600_000))).toEqual({ alerts: 0, escalations: 0 });
    // Segunda: 8h14 ainda não; 8h15 é o 15º minuto de expediente.
    expect(await scanHandoffSla(monday(8, 14))).toEqual({ alerts: 0, escalations: 0 });
    expect(await scanHandoffSla(monday(8, 15))).toEqual({ alerts: 1, escalations: 0 });
    expect(fakeGroup.sends[0]?.text).toMatch(/^⏰ Aguardando há /);

    // Assumir fecha a espera: o escalonamento das 9h não sai mais.
    expect(await claimCrmConversation({ tenantId, leadId: lead.id, conversationId: conversation.id, userId: ana.id })).toBe("claimed");
    expect(await scanHandoffSla(monday(9, 30))).toEqual({ alerts: 0, escalations: 0 });
    expect(mails).toEqual([]);
    const { getCrmLeadDetail } = await import("@/modules/crm/lead-detail");
    const detail = await getCrmLeadDetail(lead.id);
    expect(detail.handoff).toMatchObject({ status: "assumed", createdAt: saturday, escalatedAt: null });
    expect(detail.handoff?.assumedAt).toBeInstanceOf(Date);
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: noticeId }, select: { status: true } })).toEqual({ status: "assumed" });
  });

  // CRM-11: a trilha do CRM e do transbordo na AuditLog, um evento por ação.
  const trailOf = (tenantId: string, leadId: string) => prisma.auditLog.findMany({
    where: { tenantId, targetType: "Lead", targetId: leadId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { event: true, actorId: true, actorRole: true, meta: true },
  });
  const viaOf = (meta: unknown) => (meta as Record<string, unknown> | null)?.via;

  it("CRM-11: cada ação gera exatamente um evento, com ator e via certos, sem telefone nem texto da conversa", async () => {
    const { tenantId, fromPhone, deliver } = await phoneAccount();
    const ana = await person(tenantId, "Ana");
    const bia = await linkedMember(tenantId, "Bia", "5521912345678");
    const tenMinutesAgo = new Date(Date.now() - 600_000);
    // Cada espera com o próprio aviso no grupo (ids de mensagem nunca se repetem).
    const waitFrom = async (conversationId: string) => {
      const noticeId = await sentNotice(tenantId, conversationId);
      const messageId = `aviso-${conversationId}`;
      await prisma.handoffNotice.update({ where: { id: noticeId }, data: { createdAt: tenMinutesAgo, messageId } });
      return messageId;
    };

    // Painel: assumir, transferir e devolver.
    const a = await getOrCreateConversation(tenantId, "5511940011001");
    await waitFrom(a.conversation.id);
    expect(await claimCrmConversation({ tenantId, leadId: a.lead.id, conversationId: a.conversation.id, userId: ana.id })).toBe("claimed");
    expect(await panel.transferCrmConversation({ tenantId, conversationId: a.conversation.id, actorUserId: ana.id, toUserId: bia.id, expectedUserId: ana.id }))
      .toEqual({ status: "transferred" });
    expect(await panel.returnConversationToAi({ tenantId, conversationId: a.conversation.id, actorUserId: bia.id })).toMatchObject({ status: "returned" });
    const trailA = await trailOf(tenantId, a.lead.id);
    expect(trailA.map(({ event, actorId, actorRole }) => [event, actorId, actorRole])).toEqual([
      ["handoff.requested", null, "SYSTEM"],
      ["handoff.assumed", ana.id, "OWNER"],
      ["handoff.transferred", ana.id, "OWNER"],
      ["handoff.returned_to_ai", bia.id, "OWNER"],
    ]);
    expect(trailA.map(({ meta }) => viaOf(meta))).toEqual([undefined, "panel", "panel", "panel"]);
    expect((trailA[1].meta as Record<string, number>).waitSeconds).toBeGreaterThanOrEqual(599);
    expect(trailA[2].meta).toMatchObject({ fromUserId: ana.id, toUserId: bia.id });

    // Grupo: número não vinculado assume (mascarado) e a Bia (vinculada) devolve com #ia.
    const b = await getOrCreateConversation(tenantId, "5511940011002");
    const avisoB = await waitFrom(b.conversation.id);
    await deliver({ remoteJid: GROUP, participant: "5531999998888@s.whatsapp.net" },
      { extendedTextMessage: { text: "assumo", contextInfo: { stanzaId: avisoB } } });
    await deliver({ remoteJid: GROUP, participant: "5521912345678@s.whatsapp.net" },
      { extendedTextMessage: { text: "#ia", contextInfo: { stanzaId: avisoB } } });
    const trailB = await trailOf(tenantId, b.lead.id);
    expect(trailB.map(({ event, actorId, actorRole }) => [event, actorId, actorRole])).toEqual([
      ["handoff.requested", null, "SYSTEM"],
      ["handoff.assumed", null, "GROUP"],
      ["handoff.returned_to_ai", bia.id, "GROUP"],
    ]);
    expect(trailB[1].meta).toMatchObject({ via: "group", actorPhone: "•••• 8888" });
    expect(viaOf(trailB[2].meta)).toBe("group");

    // Celular: a resposta pelo celular encerra a espera sem responsável.
    const c = await getOrCreateConversation(tenantId, "5511940011003");
    await waitFrom(c.conversation.id);
    await fromPhone("5511940011003", "Oi, aqui é da clínica, tudo bem?");
    const trailC = await trailOf(tenantId, c.lead.id);
    expect(trailC.map(({ event, actorId, actorRole }) => [event, actorId, actorRole])).toEqual([
      ["handoff.requested", null, "SYSTEM"],
      ["handoff.assumed", null, "PHONE"],
    ]);
    expect(viaOf(trailC[1].meta)).toBe("phone");

    // Mover o card à mão.
    const { setLeadStage } = await import("@/modules/crm/lead-stage");
    const stages = await prisma.pipelineStage.findMany({ where: { tenantId }, select: { id: true, kind: true, name: true } });
    const current = await prisma.lead.findUniqueOrThrow({ where: { id: c.lead.id }, select: { stageId: true } });
    const scheduled = stages.find(({ kind }) => kind === "scheduled")!;
    expect(await setLeadStage({ tenantId, leadId: c.lead.id, expectedStageId: current.stageId!, stageId: scheduled.id, source: "user", userId: ana.id }))
      .toBe("moved");
    const moved = (await trailOf(tenantId, c.lead.id)).at(-1)!;
    expect(moved).toMatchObject({ event: "crm.stage_changed", actorId: ana.id,
      meta: { fromStage: stages.find(({ id }) => id === current.stageId)?.name, toStage: scheduled.name } });

    // Alerta do prazo do transbordo: um evento do Fechai por alerta.
    const d = await getOrCreateConversation(tenantId, "5511940011004");
    const t0 = new Date(Date.now() - 10 * 86_400_000);
    const notice = await notices.openHandoffNotice({ tenantId, conversationId: d.conversation.id, trigger: "agent" });
    await prisma.handoffNotice.update({ where: { id: notice!.id }, data: { createdAt: t0 } });
    const { scanHandoffSla } = await import("@/modules/crm/handoff-sla");
    await scanHandoffSla(new Date(+t0 + 15 * 60_000));
    await scanHandoffSla(new Date(+t0 + 16 * 60_000));
    const alerts = (await trailOf(tenantId, d.lead.id)).filter(({ event }) => event === "handoff.sla_alerted");
    expect(alerts.map(({ actorRole, meta }) => [actorRole, (meta as Record<string, unknown>).level])).toEqual([["SYSTEM", "alert"]]);

    // Nenhum evento leva telefone completo nem texto da conversa.
    const everything = JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId }, select: { meta: true, targetLabel: true } }));
    for (const forbidden of ["5511940011", "5531999998888", "5521912345678", "Oi, aqui é da clínica", "Quer falar com a recepção"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("CRM-11: os indicadores por pessoa batem com os eventos do período", async () => {
    const { tenantId } = await phoneAccount();
    const ana = await person(tenantId, "Ana");
    const bia = await person(tenantId, "Bia");
    const { sendManualReply } = await import("@/modules/agent-engine/conversation");
    const { handoffIndicators } = await import("@/modules/crm/handoff-indicators");
    const wait = async (phone: string, minutesAgo: number) => {
      const { lead, conversation } = await getOrCreateConversation(tenantId, phone);
      const noticeId = await sentNotice(tenantId, conversation.id);
      await prisma.handoffNotice.update({ where: { id: noticeId }, data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) } });
      return { leadId: lead.id, conversationId: conversation.id, noticeId };
    };

    // Ana assume duas esperas (10 e 30 min) e responde a primeira; a Bia devolve a segunda para a IA.
    const first = await wait("5511940012001", 10);
    const second = await wait("5511940012002", 30);
    for (const target of [first, second]) {
      expect(await claimCrmConversation({ tenantId, leadId: target.leadId, conversationId: target.conversationId, userId: ana.id })).toBe("claimed");
    }
    expect(await sendManualReply(tenantId, first.conversationId, "Oi! Já te ajudo.", undefined, undefined, ana.id)).toEqual({ ok: true });
    expect(await panel.returnConversationToAi({ tenantId, conversationId: second.conversationId, actorUserId: bia.id })).toMatchObject({ status: "returned" });

    const rows = await handoffIndicators(tenantId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000));
    const anaRow = rows.find(({ key }) => key === ana.id)!;
    const biaRow = rows.find(({ key }) => key === bia.id)!;
    // Conferido contra a própria trilha e as esperas.
    const assumed = await prisma.auditLog.findMany({ where: { tenantId, event: "handoff.assumed", actorId: ana.id }, select: { meta: true } });
    const waits = assumed.map(({ meta }) => (meta as Record<string, number>).waitSeconds).sort((x, y) => x - y);
    expect(anaRow.assumed).toBe(assumed.length);
    expect(anaRow.assumed).toBe(2);
    expect(anaRow.medianAssumeSeconds).toBe((waits[0] + waits[1]) / 2);
    expect(anaRow.medianAssumeSeconds).toBeGreaterThanOrEqual(20 * 60 - 2);
    const replied = await prisma.handoffNotice.findUniqueOrThrow({ where: { id: first.noticeId }, select: { createdAt: true, firstReplyAt: true } });
    expect(anaRow.medianFirstReplySeconds).toBe(Math.round((+replied.firstReplyAt! - +replied.createdAt) / 1000));
    expect(anaRow.returned).toBe(0);
    expect(biaRow).toMatchObject({ assumed: 0, returned: 1, medianAssumeSeconds: null });
  });

  // CRM-12: devolução automática com o relógio simulado no passado.
  async function autoReturnAccount() {
    const tenantId = await createTenant();
    await prisma.whatsappInstance.create({ data: { tenantId, provider: "evolution", status: "connected", externalId: `qa-grupo-${randomUUID()}` } });
    await prisma.agent.create({ data: { tenantId, enabled: true, isPrimary: true } });
    const stages = await prisma.pipelineStage.findMany({ where: { tenantId }, select: { id: true, kind: true } });
    const stageId = (kind: string) => stages.find((stage) => stage.kind === kind)!.id;
    const t0 = new Date(Date.now() - 10 * 86_400_000);
    const at = (minutes: number) => new Date(+t0 + minutes * 60_000);
    /** Uma espera enviada ao grupo em t0, com a IA pausada e o card em Aguardando humano (ou outra etapa). */
    const waiting = async (phone: string, kind = "waiting_human") => {
      const { lead, conversation } = await getOrCreateConversation(tenantId, phone);
      const notice = await notices.openHandoffNotice({ tenantId, conversationId: conversation.id, trigger: "agent" });
      await notices.recordHandoffNoticeSent(tenantId, notice!.id, { groupId: GROUP, messageId: `aviso-${conversation.id}` });
      await prisma.handoffNotice.update({ where: { id: notice!.id }, data: { createdAt: t0 } });
      await prisma.conversation.update({ where: { id: conversation.id }, data: { needsHuman: true, agentPaused: true } });
      await prisma.lead.update({ where: { id: lead.id }, data: { stageId: stageId(kind) } });
      return { leadId: lead.id, conversationId: conversation.id, noticeId: notice!.id };
    };
    const message = (conversationId: string, role: "user" | "assistant", sentBy: "agent" | "human" | null, minutes: number) =>
      prisma.message.create({ data: { conversationId, role, content: "mensagem de teste", sentBy, createdAt: at(minutes) } });
    const { scanAutoReturn } = await import("@/modules/crm/handoff-auto-return");
    const scan = (minutes: number) => scanAutoReturn(at(minutes));
    fakeGroup.sends.length = 0;
    return { tenantId, waiting, message, scan, at };
  }

  it("CRM-12: desligado por padrão; ligado, sem resposta humana em N h o lead volta para a IA uma vez, com o aviso no grupo", async () => {
    const { tenantId, waiting, scan } = await autoReturnAccount();
    const lead = await waiting("5511940013001");

    // Sem configuração (o padrão), nada muda, nem depois de dias.
    expect(await scan(3 * 24 * 60)).toEqual({ returned: 0 });
    await prisma.handoffSlaSettings.create({ data: { tenantId, autoReturnHours: 4 } });

    expect(await scan(4 * 60 - 1)).toEqual({ returned: 0 });
    expect(await scan(4 * 60)).toEqual({ returned: 1 });
    expect(await scan(5 * 60)).toEqual({ returned: 0 });

    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: lead.conversationId }, select: { agentPaused: true, needsHuman: true } }))
      .toEqual({ agentPaused: false, needsHuman: false });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: lead.noticeId }, select: { status: true, returnedVia: true } }))
      .toEqual({ status: "returned", returnedVia: "auto" });
    expect(await stageOf(lead.leadId)).toBe("ai");
    expect(fakeGroup.sends).toEqual([{ groupId: GROUP, text: "↩️ Sem resposta em 4 h — a IA voltou a atender", quoted: `aviso-${lead.conversationId}` }]);
    // Na trilha, uma devolução automática do Fechai.
    expect(await prisma.auditLog.findMany({ where: { tenantId, event: "handoff.returned_to_ai" }, select: { actorRole: true, meta: true } }))
      .toEqual([{ actorRole: "SYSTEM", meta: expect.objectContaining({ via: "auto" }) }]);

    // A próxima resposta da IA reconhece a espera, uma vez só.
    const { autoReturnTurnInstruction, AUTO_RETURN_INSTRUCTION } = await import("@/modules/agent-engine/handoff-notice");
    expect(await autoReturnTurnInstruction(tenantId, lead.conversationId)).toBe(AUTO_RETURN_INSTRUCTION);
    await prisma.message.create({ data: { conversationId: lead.conversationId, role: "assistant", content: "Desculpe a demora!", sentBy: "agent" } });
    expect(await autoReturnTurnInstruction(tenantId, lead.conversationId)).toBe("");
  });

  it("CRM-12: resposta humana antes do prazo cancela; em atendimento humano conta da mensagem sem resposta; Fechado e Perdido nunca voltam", async () => {
    const { tenantId, waiting, message, scan, at } = await autoReturnAccount();
    await prisma.handoffSlaSettings.create({ data: { tenantId, autoReturnHours: 4, autoReturnHumanStage: true } });

    // Esperando, mas alguém respondeu 1 h depois do transbordo: não volta.
    const answered = await waiting("5511940013101");
    await message(answered.conversationId, "assistant", "human", 60);
    // Em atendimento humano: assumida aos 10 min, respondida em 1 h; o contato
    // escreve de novo às 2 h (e a IA, que segue respondendo, não conta).
    const human = await waiting("5511940013102", "human");
    await prisma.handoffNotice.update({ where: { id: human.noticeId }, data: { status: "assumed", assumedVia: "panel", assumedAt: at(10), closedAt: at(10) } });
    await message(human.conversationId, "assistant", "human", 60);
    await message(human.conversationId, "user", null, 120);
    await message(human.conversationId, "assistant", "agent", 121);
    // Card fechado como Perdido e como Fechado: nunca voltam.
    await waiting("5511940013103", "lost");
    await waiting("5511940013104", "won");

    expect(await scan(5 * 60)).toEqual({ returned: 0 });
    expect(await scan(6 * 60 - 1)).toEqual({ returned: 0 });
    expect(await scan(6 * 60)).toEqual({ returned: 1 });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: human.noticeId }, select: { status: true, returnedVia: true } }))
      .toEqual({ status: "returned", returnedVia: "auto" });
    expect(await prisma.handoffNotice.findUniqueOrThrow({ where: { id: answered.noticeId }, select: { status: true } })).toEqual({ status: "waiting" });
    expect(await scan(3 * 24 * 60)).toEqual({ returned: 0 });
  });
});
