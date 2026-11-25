import { randomUUID } from "node:crypto";
import type { CrmStageKind, LeadTransitionSource, Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const productAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/require-product", () => ({ requireProductAccess: productAccess }));

const testUrl = process.env.CRM_TEST_DATABASE_URL?.trim();
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const inboundAt = new Date("2026-01-07T13:00:00Z");
const replyAt = new Date("2026-01-07T13:01:00Z");
const inbound = { role: "user", content: "Mensagem de teste", createdAt: inboundAt };
const aiReply = { role: "assistant", content: "Mensagem de teste", sentBy: "agent", createdAt: replyAt };

type ActivationFixture = {
  expected: CrmStageKind | null;
  status?: string;
  needsHuman?: boolean;
  leadTest?: boolean;
  conversationTest?: boolean;
  messages?: Prisma.MessageCreateWithoutConversationInput[];
  automaticSend?: "followup" | "reminder" | "campaign";
};

describe.skipIf(!testUrl)("CRM no PostgreSQL", () => {
  const tenantA = `crm-qa-a-${randomUUID()}`;
  const tenantB = `crm-qa-b-${randomUUID()}`;
  const tenantIds = [tenantA, tenantB];
  let prisma: typeof import("@/lib/prisma").prisma | undefined;
  let provisionDentalPipeline: typeof import("@/modules/crm/pipeline").provisionDentalPipeline;
  let setLeadStage: typeof import("@/modules/crm/lead-stage").setLeadStage;
  let setCrmEnabled: typeof import("@/modules/crm/activation").setCrmEnabled;
  let getOrCreateConversation: typeof import("@/modules/agent-engine/conversation").getOrCreateConversation;
  let getCrmOverview: typeof import("@/modules/crm/access").getCrmOverview;
  let editCrmStages: typeof import("@/modules/crm/stage-settings").editCrmStages;
  let moveLeadToStage: typeof import("@/modules/crm/automatic-stage").moveLeadToStage;
  let getCrmBoard: typeof import("@/modules/crm/board").getCrmBoard;
  let getCrmLeadDetail: typeof import("@/modules/crm/lead-detail").getCrmLeadDetail;
  let listCrmReminders: typeof import("@/modules/crm/lead-detail").listCrmReminders;
  let editCrmLead: typeof import("@/modules/crm/lead-detail-actions").editCrmLead;
  let parseCrmTaskDue: typeof import("@/modules/crm/lead-detail-actions").parseCrmTaskDue;
  let readCrmLossCatalog: typeof import("@/modules/crm/loss-reasons").readCrmLossCatalog;
  let updateCrmLossCatalog: typeof import("@/modules/crm/loss-reasons").updateCrmLossCatalog;
  let claimCrmConversation: typeof import("@/modules/crm/assignments").claimCrmConversation;
  let crmWhatsappReplyTarget: typeof import("@/modules/crm/whatsapp-reply").crmWhatsappReplyTarget;
  let sendManualReply: typeof import("@/modules/agent-engine/conversation").sendManualReply;
  let recordWhatsappInbound: typeof import("@/modules/whatsapp/inbound-proof").recordWhatsappInbound;
  let contactWhatsappInbound: typeof import("@/modules/whatsapp/inbound-proof").contactWhatsappInbound;

  beforeAll(async () => {
    if (!testUrl) throw new Error("Defina CRM_TEST_DATABASE_URL.");
    const target = new URL(testUrl);
    const databaseName = decodeURIComponent(target.pathname.slice(1));
    if (
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      !loopback.has(target.hostname) ||
      !/(?:^|[_-])(test|teste|sandbox|lab)(?:$|[_-])/i.test(databaseName)
    ) {
      throw new Error("CRM_TEST_DATABASE_URL deve apontar para um PostgreSQL local de teste.");
    }
    const appUrl = process.env.DATABASE_URL;
    if (appUrl) {
      const app = new URL(appUrl);
      if (
        loopback.has(app.hostname) &&
        (target.port || "5432") === (app.port || "5432") &&
        target.pathname === app.pathname
      ) {
        throw new Error("A base do teste de CRM precisa ser distinta de DATABASE_URL.");
      }
    }

    // Importar após trocar a URL impede que o singleton use o banco normal.
    vi.stubEnv("DATABASE_URL", testUrl);
    ({ prisma } = await import("@/lib/prisma"));
    ({ provisionDentalPipeline } = await import("@/modules/crm/pipeline"));
    ({ setLeadStage } = await import("@/modules/crm/lead-stage"));
    ({ setCrmEnabled } = await import("@/modules/crm/activation"));
    ({ getOrCreateConversation, sendManualReply } = await import("@/modules/agent-engine/conversation"));
    ({ getCrmOverview } = await import("@/modules/crm/access"));
    ({ editCrmStages } = await import("@/modules/crm/stage-settings"));
    ({ moveLeadToStage } = await import("@/modules/crm/automatic-stage"));
    ({ getCrmBoard } = await import("@/modules/crm/board"));
    ({ getCrmLeadDetail, listCrmReminders } = await import("@/modules/crm/lead-detail"));
    ({ editCrmLead, parseCrmTaskDue } = await import("@/modules/crm/lead-detail-actions"));
    ({ readCrmLossCatalog, updateCrmLossCatalog } = await import("@/modules/crm/loss-reasons"));
    ({ claimCrmConversation } = await import("@/modules/crm/assignments"));
    ({ crmWhatsappReplyTarget } = await import("@/modules/crm/whatsapp-reply"));
    ({ recordWhatsappInbound, contactWhatsappInbound } = await import("@/modules/whatsapp/inbound-proof"));
    await prisma.tenant.createMany({ data: [
      { id: tenantA, name: "Clínica de teste A" },
      { id: tenantB, name: "Clínica de teste B" },
    ] });
  }, 15_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const tenantId = { in: tenantIds };
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
        expect(await prisma.leadTransition.count({ where: { tenantId } })).toBe(0);
        expect(await prisma.pipelineStage.count({ where: { tenantId } })).toBe(0);
        expect(await prisma.tag.count({ where: { tenantId } })).toBe(0);
        expect(await prisma.leadTag.count({ where: { tenantId } })).toBe(0);
        expect(await prisma.leadTask.count({ where: { tenantId } })).toBe(0);
      }
    } finally {
      await prisma?.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  async function stagesFor(tenantId: string) {
    const pipeline = await provisionDentalPipeline(tenantId);
    return prisma!.pipelineStage.findMany({
      where: { tenantId, pipelineId: pipeline.id },
      orderBy: { position: "asc" },
    });
  }

  async function createTenant(status = "active") {
    const tenant = await prisma!.tenant.create({ data: { name: "Clínica de teste CRM", status } });
    tenantIds.push(tenant.id);
    return tenant.id;
  }

  it("pagina 5.000 leads por etapa e aplica origem, período e isolamento sem expor telefone", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    productAccess.mockResolvedValue({ session: { user: { tenantId, role: "OWNER" } } });
    const stages = await stagesFor(tenantId);
    const stageId = stages[0].id;
    const createdAt = new Date("2026-01-07T15:00:00Z");
    for (let batch = 0; batch < 5; batch++) {
      await db.lead.createMany({ data: Array.from({ length: 1000 }, (_, index) => ({
        tenantId, stageId: stages[(batch * 1000 + index) % stages.length].id,
        phone: `551111${String(batch * 1000 + index).padStart(5, "0")}`, createdAt,
      })) });
    }
    const lead = await db.lead.findFirstOrThrow({ where: { tenantId, stageId } });
    await db.leadAdOrigin.create({ data: { tenantId, leadId: lead.id, firstAdAt: createdAt } });
    await db.conversation.create({ data: { tenantId, leadId: lead.id, messages: { create: [inbound,
      { ...aiReply, createdAt: new Date("2026-01-08T01:30:00Z") },
      { ...inbound, createdAt: new Date("2026-01-09T04:00:00Z") },
    ] } } });

    const start = performance.now();
    const board = await getCrmBoard({});
    const duration = performance.now() - start;
    console.info(`[crm] consulta de 5.000 leads: ${duration.toFixed(0)} ms`);
    expect(duration).toBeLessThan(2_000);
    expect(board.columns.reduce((count, column) => count + column.total, 0)).toBe(5000);
    expect(board.columns.every(({ cards }) => cards.length === 20)).toBe(true);
    const page2 = await getCrmBoard({ etapa: stageId, [`p_${stageId}`]: "2" });
    expect(page2.columns).toHaveLength(1);
    expect(page2.columns[0].page).toBe(2);
    expect(page2.columns[0].cards[0].id).not.toBe(board.columns[0].cards[0].id);

    const ad = await getCrmBoard({ etapa: stageId, origem: "anuncio", de: "2026-01-07", ate: "2026-01-07" });
    expect(ad.columns[0].cards.map(({ id }) => id)).toEqual([lead.id]);
    expect(ad.columns[0].cards[0].phone).toBe(`•••• ${lead.phone.slice(-4)}`);
    const unknown = await getCrmBoard({ etapa: stageId, origem: "desconhecida" });
    expect(unknown.columns[0].total).toBe(board.columns[0].total - 1);
    const activityOnEntry = await getCrmBoard({ etapa: stageId, origem: "anuncio", periodo: "atividade", ate: "2026-01-07" });
    expect(activityOnEntry.columns[0].total).toBe(0);
    const activity = await getCrmBoard({ etapa: stageId, origem: "anuncio", periodo: "atividade", de: "2026-01-09", ate: "2026-01-09" });
    expect(activity.columns[0].total).toBe(1);
    const other = await db.lead.findFirst({ where: { tenantId: tenantA } });
    await expect(getCrmLeadDetail(other?.id ?? "outro-contato")).rejects.toThrow();
  }, 15_000);

  it("isola ficha, paginação, etiquetas e tarefas da conta", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const otherTenant = await createTenant();
    await setCrmEnabled(tenantId, true);
    await setCrmEnabled(otherTenant, true);
    productAccess.mockResolvedValue({ session: { user: { tenantId, role: "OWNER" } } });
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940000020");
    const other = await getOrCreateConversation(otherTenant, "5511940000021");
    const foreign = await db.user.create({ data: { tenantId: otherTenant, email: `${randomUUID()}@example.test` } });
    const owner = await db.user.create({ data: { tenantId, email: `${randomUUID()}@example.test` } });
    await db.conversation.update({ where: { id: conversation.id }, data: { variables: { endereco: "Rua da clínica" } } });
    await db.conversationInsight.create({ data: { tenantId, conversationId: conversation.id, city: "São Paulo", procedure: "Avaliação" } });
    await db.message.createMany({ data: [
      ...Array.from({ length: 45 }, (_, index) => ({
        ...inbound, id: `${conversation.id}-${String(index).padStart(2, "0")}`, conversationId: conversation.id,
        whatsappMessageId: index === 0 ? `${conversation.id}-resposta` : null,
      })),
      { ...inbound, role: "system", conversationId: conversation.id },
      { ...inbound, id: `${other.conversation.id}-externa`, conversationId: other.conversation.id },
    ] });
    const campaign = await db.broadcastCampaign.create({ data: { tenantId, name: "Disparo de teste", phoneNumberId: "fake", template: {} } });
    await db.broadcastRecipient.create({ data: { campaignId: campaign.id, conversationId: conversation.id,
      row: 1, phone: lead.phone, parameters: {}, content: "Modelo de teste", status: "sent",
      sentAt: new Date(inboundAt.getTime() - 60_000), repliedAt: inboundAt, firstReplyMessageId: `${conversation.id}-resposta` } });
    const first = await getCrmLeadDetail(lead.id);
    expect(first.insight).toMatchObject({ city: "São Paulo", procedure: "Avaliação" });
    expect(first.conversation?.variables).toEqual({ endereco: "Rua da clínica" });
    expect(first.broadcast).toEqual({ name: campaign.name, repliedAt: inboundAt });
    expect(first.adOrigin).toBeNull();
    expect(first.history?.messages).toHaveLength(40);
    const older = await getCrmLeadDetail(lead.id, first.history?.before);
    expect(older.history?.messages).toHaveLength(5);
    expect(new Set([...older.history!.messages, ...first.history!.messages].map(({ id }) => id)).size).toBe(45);
    await expect(getCrmLeadDetail(lead.id, `${other.conversation.id}-externa`)).rejects.toThrow();

    await editCrmLead(otherTenant, other.lead.id, { kind: "newTag", name: "Outra conta" });
    const tag = await db.tag.findFirstOrThrow({ where: { tenantId: otherTenant } });
    expect(await editCrmLead(tenantId, lead.id, { kind: "addTag", tagId: tag.id })).toBe("unavailable");
    expect(await editCrmLead(tenantId, other.lead.id, { kind: "newTag", name: "Retorno" })).toBe("unavailable");
    await Promise.all(["Retorno", "retorno"].map((name) => editCrmLead(tenantId, lead.id, { kind: "newTag", name })));
    const local = await db.tag.findFirstOrThrow({ where: { tenantId } });
    expect(await db.tag.count({ where: { tenantId } })).toBe(1);
    expect(await db.leadTag.count({ where: { tenantId, leadId: lead.id } })).toBe(1);
    const board = await getCrmBoard({ etiqueta: local.id });
    expect(board.columns.flatMap(({ cards }) => cards).map(({ id, tags }) => ({ id, tags }))).toEqual([
      { id: lead.id, tags: [{ id: local.id, name: local.name }] },
    ]);
    await editCrmLead(tenantId, lead.id, { kind: "removeTag", tagId: local.id });
    expect((await getCrmLeadDetail(lead.id)).leadTags).toEqual([]);

    const dueAt = parseCrmTaskDue("2026-01-07T15:00")!;
    expect(dueAt.toISOString()).toBe("2026-01-07T18:00:00.000Z");
    expect(parseCrmTaskDue("2026-02-31T15:00")).toBeNull();
    const task = { kind: "createTask" as const, text: "Confirmar disponibilidade", dueAt };
    expect(await editCrmLead(tenantId, lead.id, { ...task, assignedUserId: foreign.id })).toBe("unavailable");
    expect(await editCrmLead(tenantId, lead.id, { ...task, assignedUserId: owner.id })).toBe("ok");
    const now = new Date("2026-01-07T12:00:00.000Z");
    const [reminder] = await listCrmReminders(tenantId, now);
    expect(reminder).toMatchObject({ text: task.text, lead: { id: lead.id } });
    expect(await listCrmReminders(otherTenant, now)).toEqual([]);
    const completion = { kind: "completeTask" as const, taskId: reminder.id };
    expect(await editCrmLead(otherTenant, other.lead.id, completion)).toBe("unavailable");
    expect(await editCrmLead(tenantId, lead.id, completion)).toBe("ok");
    const completed = (await getCrmLeadDetail(lead.id)).tasks[0];
    expect(completed).toMatchObject({ completedAt: expect.any(Date), assignedUserId: owner.id });
    expect(await editCrmLead(tenantId, lead.id, completion)).toBe("ok");
    expect((await getCrmLeadDetail(lead.id)).tasks[0].completedAt).toEqual(completed.completedAt);
    expect(await listCrmReminders(tenantId, now)).toEqual([]);
    await setCrmEnabled(tenantId, false);
    expect(await editCrmLead(tenantId, lead.id, { ...task, assignedUserId: owner.id })).toBe("unavailable");
  }, 15_000);

  it("move cards com a etapa de origem esperada e conserva motivo e justificativa de perda", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    const user = await db.user.create({ data: { tenantId, email: `${randomUUID()}@example.test` } });
    const { lead } = await getOrCreateConversation(tenantId, "5511940000018");
    const stages = await stagesFor(tenantId);
    const lost = stages.find(({ kind }) => kind === "lost")!;
    const expectedStageId = stages[0].id;
    productAccess.mockResolvedValue({ session: { user: { tenantId, role: "OWNER" } } });
    const move = { tenantId, leadId: lead.id, expectedStageId, stageId: lost.id, userId: user.id, source: "user" as const };
    const [foreign] = await stagesFor(tenantB);
    expect(await setLeadStage({ ...move, stageId: foreign.id })).toBe("not_found");
    expect(await setLeadStage(move)).toBe("loss_reason_required");
    expect(await setLeadStage({ ...move, expectedStageId: stages[1].id, reason: "preco" })).toBe("conflict");
    expect(await setLeadStage({ ...move, reason: "preco" })).toBe("loss_note_required");
    expect(await setLeadStage({ ...move, reason: "preco", lossReasonNote: "   " })).toBe("loss_note_required");
    const initial = (await readCrmLossCatalog(tenantId))!;
    expect(await updateCrmLossCatalog(tenantId, ["Sem disponibilidade"], initial.revision)).toBe("ok");
    expect(await updateCrmLossCatalog(tenantId, ["Edição concorrente"], initial.revision)).toBe("stale");
    const catalog = (await readCrmLossCatalog(tenantId))!;
    const reason = catalog.options[0].key;
    expect(await setLeadStage({ ...move, reason: "preco", lossReasonNote: "Confirmado" })).toBe("loss_reason_required");
    expect(await setLeadStage({ ...move, reason, lossReasonNote: "  Confirmado pelo contato. " })).toBe("moved");
    expect(await setLeadStage({ ...move, reason, lossReasonNote: "Outro clique" })).toBe("unchanged");
    expect(await updateCrmLossCatalog(tenantId, ["Nova opção"], catalog.revision)).toBe("ok");
    expect(await db.leadTransition.findMany({ where: { leadId: lead.id, source: "user", tenantId } }))
      .toMatchObject([{ userId: user.id, fromStageId: expectedStageId, toStageId: lost.id, reason,
        lossReasonLabel: "Sem disponibilidade", lossReasonNote: "Confirmado pelo contato." }]);
    expect((await getCrmLeadDetail(lead.id)).transitions[0]).toMatchObject({ lossReasonLabel: "Sem disponibilidade" });
  });

  it("persiste a origem comprovada na entrada, sem alterar cadastros anteriores", async () => {
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    productAccess.mockResolvedValue({ session: { user: { tenantId, role: "OWNER" } } });
    const widget = await getOrCreateConversation(tenantId, "web:crm-qa", undefined, { originChannel: "widget" });
    const organic = await getOrCreateConversation(tenantId, "5511940000063", undefined, { originChannel: "whatsapp_qr" });
    const legacy = await getOrCreateConversation(tenantId, "5511940000064");
    expect((await getOrCreateConversation(tenantId, organic.lead.phone, undefined, { originChannel: "ad" })).lead.originChannel).toBe("whatsapp_qr");
    expect((await getOrCreateConversation(tenantId, legacy.lead.phone, undefined, { originChannel: "whatsapp_meta" })).lead.originChannel).toBeNull();
    expect((await getCrmLeadDetail(widget.lead.id)).originChannel).toBe("widget");
    const filtered = await getCrmBoard({ origem: "whatsapp_qr" });
    expect(filtered.columns.flatMap(({ cards }) => cards).map(({ id, origin }) => ({ id, origin }))).toEqual([
      { id: organic.lead.id, origin: "WhatsApp direto (QR)" },
    ]);
  });

  it("grava uma única pessoa responsável e expõe seu evento e o transbordo na ficha", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    productAccess.mockResolvedValue({ session: { user: { tenantId, role: "OWNER" } } });
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940000065");
    const people = await db.user.createManyAndReturn({ data: [1, 2].map((n) => ({ tenantId, email: `${randomUUID()}@example.test`, name: `Pessoa ${n}` })) });
    const foreign = await db.user.create({ data: { tenantId: tenantB, email: `${randomUUID()}@example.test` } });
    const scope = { tenantId, leadId: lead.id, conversationId: conversation.id };
    await db.reportEvent.create({ data: { tenantId, conversationId: conversation.id, kind: "handoff", dedupKey: randomUUID() } });
    expect(await claimCrmConversation({ ...scope, userId: foreign.id })).toBe("unavailable");
    const outcomes = await Promise.all(people.map(({ id }) => claimCrmConversation({ ...scope, userId: id })));
    expect([...outcomes].sort()).toEqual(["assigned_elsewhere", "claimed"]);
    const owner = people[outcomes.indexOf("claimed")];
    const card = await getCrmLeadDetail(lead.id);
    expect(card.stage?.kind).toBe("human");
    expect(card.conversation).toMatchObject({ assignedUserId: owner.id, assignedAt: expect.any(Date),
      assignments: [{ toUserId: owner.id, via: "panel" }], reportEvents: [{ createdAt: expect.any(Date) }] });
    expect(await claimCrmConversation({ ...scope, userId: owner.id })).toBe("owned");
    expect(await db.conversationAssignment.count({ where: { tenantId, conversationId: conversation.id } })).toBe(1);
  });

  it("responde pelo número comprovado, bloqueia primeiro contato, troca de QR e janela fechada", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    await db.tenant.update({ where: { id: tenantId }, data: { metaWhatsappEnabled: true } });
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940000066");
    const user = await db.user.create({ data: { tenantId, email: `${randomUUID()}@example.test` } });
    await db.whatsappInstance.createMany({ data: [
      { tenantId, provider: "evolution", status: "connected", externalId: "qr-crm-qa" },
      { tenantId, provider: "meta", status: "connected", externalId: "meta-crm-qa" },
    ] });
    await db.message.create({ data: { conversationId: conversation.id, ...inbound, whatsappMessageId: randomUUID() } });
    const target = () => crmWhatsappReplyTarget(tenantId, lead.id, conversation.id);
    const send = () => sendManualReply(tenantId, conversation.id, "Resposta fictícia", undefined, { leadId: lead.id, userId: user.id });
    let qrPhone = "5511990000011";
    const fakeFetch = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:1/instance/fetchInstances?instanceName=qr-crm-qa") {
        return Response.json([{ name: "qr-crm-qa", connectionStatus: "open", ownerJid: `${qrPhone}:1@s.whatsapp.net` }]);
      }
      if (url === "http://127.0.0.1:1/message/sendText/qr-crm-qa") return Response.json({ key: { id: randomUUID() } });
      throw new Error("Destino externo inesperado");
    });
    const savedUrl = process.env.EVOLUTION_API_URL;
    const savedKey = process.env.EVOLUTION_API_KEY;
    process.env.EVOLUTION_API_URL = "http://127.0.0.1:1";
    process.env.EVOLUTION_API_KEY = "chave-ficticia";
    vi.stubGlobal("fetch", fakeFetch);
    try {
      expect((await target()).status).toBe("no_inbound");
      expect((await send()).ok).toBe(false);
      expect(fakeFetch).not.toHaveBeenCalled();
      const now = new Date();
      const incoming = { instanceExternalId: "qr-crm-qa", fromPhone: lead.phone, text: "Contato", isGroup: false,
        hasAudio: false, messageKeyId: randomUUID(), occurredAt: now, receiverPhone: qrPhone };
      expect(contactWhatsappInbound(tenantId, "evolution", { ...incoming, isFromMe: true })).toBeUndefined();
      await recordWhatsappInbound(conversation.id, contactWhatsappInbound(tenantId, "evolution", incoming)!);
      // Eco da equipe altera a coluna de roteamento geral. A prova do contato prevalece no CRM.
      await db.conversation.update({ where: { id: conversation.id }, data: { whatsappProvider: "meta" } });
      const olderMeta = { ...incoming, instanceExternalId: "meta-crm-qa", occurredAt: new Date(now.getTime() - 10) };
      await recordWhatsappInbound(conversation.id, contactWhatsappInbound(tenantId, "meta", olderMeta)!);
      expect((await target())).toMatchObject({ status: "ready", proof: { provider: "evolution" } });
      qrPhone = "5511990000022";
      expect((await send()).ok).toBe(false);
      expect(fakeFetch.mock.calls.some(([url]) => url.includes("/message/sendText/"))).toBe(false);
      qrPhone = incoming.receiverPhone;
      expect((await send()).ok).toBe(true);
      expect(fakeFetch.mock.calls.some(([url]) => url.endsWith("/sendText/qr-crm-qa"))).toBe(true);
      expect(await db.message.findFirst({ where: { conversationId: conversation.id, sentBy: "human", content: "Resposta fictícia" } })).toBeTruthy();
      await db.whatsappInstance.updateMany({ where: { tenantId, provider: "evolution" }, data: { status: "disconnected" } });
      expect((await target()).status).toBe("connection");
      const nextMeta = { ...olderMeta, occurredAt: new Date(), messageKeyId: randomUUID() };
      await recordWhatsappInbound(conversation.id, contactWhatsappInbound(tenantId, "meta", nextMeta)!);
      expect((await target()).status).toBe("ready");
      expect((await crmWhatsappReplyTarget(tenantId, lead.id, conversation.id, new Date(nextMeta.occurredAt.getTime() + 86_400_000))).status).toBe("window_closed");
      await db.conversation.update({ where: { id: conversation.id }, data: { followUpReason: "stop" } });
      expect((await target()).status).toBe("stopped");
    } finally {
      vi.unstubAllGlobals();
      if (savedUrl === undefined) delete process.env.EVOLUTION_API_URL;
      else process.env.EVOLUTION_API_URL = savedUrl;
      if (savedKey === undefined) delete process.env.EVOLUTION_API_KEY;
      else process.env.EVOLUTION_API_KEY = savedKey;
    }
  }, 15_000);

  it("projeta atendimento, agenda e perda explícita com origem e vínculo no histórico", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940000010");
    const { lead: disqualified } = await getOrCreateConversation(tenantId, "5511940000011");
    const event = { conversationId: conversation.id };
    expect(await moveLeadToStage(tenantId, lead.id, "ai", "ai", { ...event, reason: "agent_reply", key: "reply" })).toBe("moved");
    expect(await moveLeadToStage(tenantId, lead.id, "waiting_human", "ai", { ...event, reason: "handoff", key: "handoff" })).toBe("moved");
    expect(await moveLeadToStage(tenantId, null, "human", "user", { ...event, reason: "human_assumed" })).toBe("moved");

    const booking = await db.appointment.create({ data: { tenantId, leadId: lead.id, conversationId: conversation.id, title: "Avaliação",
      startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(), source: "manual" } });
    const bookingEvent = { appointmentId: booking.id, key: booking.id };
    expect(await moveLeadToStage(tenantId, lead.id, "scheduled", "user", { ...bookingEvent, reason: "appointment_booked" })).toBe("moved");
    expect(await moveLeadToStage(tenantId, null, "attended", "user", { ...bookingEvent, reason: "appointment_attended" })).toBe("ignored");
    await db.appointment.update({ where: { id: booking.id }, data: { attendance: "attended" } });
    expect(await moveLeadToStage(tenantId, null, "attended", "user", { ...bookingEvent, reason: "appointment_attended" })).toBe("moved");
    expect(await moveLeadToStage(tenantId, lead.id, "lost", "ai", { ...event, reason: "declared_loss", key: "loss" })).toBe("moved");
    expect(await moveLeadToStage(tenantId, disqualified.id, "lost", "ai", { reason: "disqualified", key: "disqualified" })).toBe("moved");
    expect(await moveLeadToStage(tenantId, lead.id, "scheduled", "user", { ...bookingEvent, reason: "appointment_booked" })).toBe("ignored");

    const history = await db.leadTransition.findMany({ where: { tenantId, leadId: lead.id }, orderBy: { createdAt: "asc" },
      select: { source: true, toStage: { select: { kind: true } } } });
    expect(history.map(({ source, toStage }) => [toStage?.kind, source])).toEqual([
      ["new", "system"], ["ai", "ai"], ["waiting_human", "ai"], ["human", "user"],
      ["scheduled", "user"], ["attended", "user"], ["lost", "ai"],
    ]);
  });

  it("protege decisões manuais e só aceita evento forte novo para reabrir", async () => {
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    const { lead } = await getOrCreateConversation(tenantId, "5511940000012");
    const stages = await stagesFor(tenantId);
    const won = stages.find((stage) => stage.kind === "won")!;
    expect(await setLeadStage({ tenantId, leadId: lead.id, stageId: won.id, source: "user" })).toBe("moved");
    const decision = await prisma!.leadTransition.findFirstOrThrow({ where: { tenantId, leadId: lead.id, toStageId: won.id } });
    await prisma!.leadTransition.updateMany({ where: { tenantId, leadId: lead.id, reason: "lead_created" },
      data: { createdAt: new Date(decision.createdAt.getTime() + 1) } });
    expect(await moveLeadToStage(tenantId, lead.id, "ai", "ai", { reason: "agent_reply", key: "reply" })).toBe("ignored");
    expect(await moveLeadToStage(tenantId, lead.id, "waiting_human", "system", { reason: "handoff", key: "failure" })).toBe("ignored");
    expect(await moveLeadToStage(tenantId, lead.id, "waiting_human", "ai", { reason: "handoff", at: new Date(0), key: "late" })).toBe("ignored");
    expect(await moveLeadToStage(tenantId, lead.id, "waiting_human", "ai", { reason: "handoff", key: "strong" })).toBe("moved");
    await setLeadStage({ tenantId, leadId: lead.id, stageId: won.id, source: "user" });
    expect(await moveLeadToStage(tenantId, lead.id, "waiting_human", "ai", { reason: "handoff", key: "strong" })).toBe("ignored");
  });

  it("só recua do agendamento cancelado quando não há outra consulta futura de pé", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    await setCrmEnabled(tenantId, true);
    const { lead, conversation } = await getOrCreateConversation(tenantId, "5511940000013");
    await db.conversation.update({ where: { id: conversation.id }, data: { agentPaused: true } });
    const data = { tenantId, leadId: lead.id, conversationId: conversation.id, title: "Avaliação",
      startsAt: new Date(Date.now() + 60_000), endsAt: new Date(Date.now() + 3_600_000) };
    const first = await db.appointment.create({ data });
    const second = await db.appointment.create({ data });
    const cancel = (id: string) => moveLeadToStage(tenantId, lead.id, "booking_canceled", "user", {
      reason: "appointment_canceled", appointmentId: id, key: id,
    });
    expect(await moveLeadToStage(tenantId, lead.id, "scheduled", "ai", { reason: "appointment_booked", appointmentId: first.id, key: first.id })).toBe("moved");
    await db.appointment.update({ where: { id: first.id }, data: { status: "canceled" } });
    expect(await cancel(first.id)).toBe("ignored");
    await db.appointment.update({ where: { id: second.id }, data: { status: "canceled" } });
    expect(await cancel(second.id)).toBe("moved");
    expect(await cancel(second.id)).toBe("ignored");
    expect(await db.lead.findUnique({ where: { id: lead.id }, select: { stage: { select: { kind: true } } } })).toEqual({ stage: { kind: "human" } });
  });

  it("ignora sandbox e flag desligada e isola falha de escrita do CRM", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const { lead } = await getOrCreateConversation(tenantId, "5511940000014");
    const meta = { reason: "agent_reply", key: "reply" } as const;
    expect(await moveLeadToStage(tenantId, lead.id, "ai", "ai", meta)).toBe("ignored");
    await setCrmEnabled(tenantId, true);
    const { lead: sandbox } = await getOrCreateConversation(tenantId, "sandbox:crm-automatic", undefined, { isTest: true });
    expect(await moveLeadToStage(tenantId, sandbox.id, "ai", "ai", meta)).toBe("ignored");
    expect(await moveLeadToStage(tenantId, lead.id, "ai", "invalid" as LeadTransitionSource, meta)).toBe("failed");
    expect(await db.lead.findUnique({ where: { id: lead.id }, select: { stage: { select: { kind: true } } } })).toEqual({ stage: { kind: "new" } });
    expect(await moveLeadToStage(tenantId, lead.id, "ai", "ai", meta)).toBe("moved");
  });

  it("configura nomes e ordem sem mudar o kind, com isolamento e proteção de sistema", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const { id: userId } = await db.user.create({ data: { tenantId, email: `${randomUUID()}@example.test` } });
    const actor = { tenantId, userId };
    expect(await editCrmStages(actor, { intent: "create", name: "Retorno" })).toBe("forbidden");
    await setCrmEnabled(tenantId, true);
    const [initial, next] = await stagesFor(tenantId);
    const [foreign] = await stagesFor(tenantB);
    expect(await editCrmStages(actor, { intent: "rename", stageId: foreign.id, previousName: foreign.name, name: "Confirmação" })).toBe("stale");
    expect(await editCrmStages(actor, { intent: "archive", stageId: initial.id, destinationId: "" })).toBe("system_stage");
    expect(await editCrmStages(actor, { intent: "rename", stageId: initial.id, previousName: initial.name, name: "Entrada da clínica" })).toBe("changed");
    const move = { intent: "move", direction: "down", stageId: initial.id, neighborId: next.id } as const;
    expect(await editCrmStages(actor, move)).toBe("changed");
    expect(await editCrmStages(actor, move)).toBe("unchanged");
    expect(await editCrmStages(actor, { intent: "create", name: "Retorno" })).toBe("changed");
    expect(await editCrmStages(actor, { intent: "create", name: "retorno" })).toBe("duplicate");
    const stages = await stagesFor(tenantId);
    expect(stages[1]).toMatchObject({ id: initial.id, kind: "new", name: "Entrada da clínica" });
    expect(stages.at(-1)).toMatchObject({ kind: null, name: "Retorno" });
    const { lead } = await getOrCreateConversation(tenantId, "5511940000001");
    expect(lead.stageId).toBe(initial.id);
  });

  it("exige destino ativo da mesma conta para arquivar leads e registra a migração", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const { id: userId } = await db.user.create({ data: { tenantId, email: `${randomUUID()}@example.test` } });
    const actor = { tenantId, userId };
    await setCrmEnabled(tenantId, true);
    await editCrmStages(actor, { intent: "create", name: "Retorno" });
    const stages = await stagesFor(tenantId);
    const stageId = stages.at(-1)!.id;
    const destinationId = stages[1].id;
    const [foreign] = await stagesFor(tenantB);
    const lead = await db.lead.create({ data: { tenantId, phone: "5511940000002", status: "warm", stageId } });
    const sandbox = await db.lead.create({ data: { tenantId, phone: "5511940000003", isTest: true, stageId } });
    const archive = { intent: "archive", stageId, destinationId } as const;
    expect(await editCrmStages(actor, { ...archive, destinationId: "" })).toBe("destination");
    expect(await editCrmStages(actor, { ...archive, destinationId: foreign.id })).toBe("destination");
    expect(await editCrmStages(actor, archive)).toBe("changed");
    expect(await db.lead.findUnique({ where: { id: lead.id } })).toMatchObject({ stageId: destinationId, status: lead.status, updatedAt: lead.updatedAt });
    expect(await db.leadTransition.findMany({ where: { tenantId, fromStageId: stageId } })).toMatchObject([
      { leadId: lead.id, dimension: "stage", source: "user", userId, reason: "stage_archived", toStageId: destinationId },
    ]);
    expect(await db.lead.findUnique({ where: { id: sandbox.id } })).toMatchObject({ stageId });
    expect(await db.pipelineStage.findUnique({ where: { id: stageId } })).toMatchObject({ archivedAt: expect.any(Date) });
    expect(await setLeadStage({ tenantId, leadId: lead.id, stageId, source: "system" })).toBe("not_found");
  });

  it("mantém leads ativos fora de uma etapa arquivada quando há movimentação concorrente", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const { id: userId } = await db.user.create({ data: { tenantId, email: `${randomUUID()}@example.test` } });
    const actor = { tenantId, userId };
    await setCrmEnabled(tenantId, true);
    await editCrmStages(actor, { intent: "create", name: "Retorno" });
    const stages = await stagesFor(tenantId);
    const stageId = stages.at(-1)!.id;
    const { lead } = await getOrCreateConversation(tenantId, "5511940000004");
    const [archive, move] = await Promise.all([
      editCrmStages(actor, { intent: "archive", stageId, destinationId: stages[1].id }),
      setLeadStage({ tenantId, leadId: lead.id, stageId, source: "system" }),
    ]);
    expect(archive).toBe("changed");
    expect(["moved", "not_found"]).toContain(move);
    expect(await db.lead.count({ where: { tenantId, stageId } })).toBe(0);
  });

  it("provisiona um pipeline por conta e preserva nomes editados", async () => {
    const db = prisma!;
    const [first, repeated, other] = await Promise.all([
      provisionDentalPipeline(tenantA),
      provisionDentalPipeline(tenantA),
      provisionDentalPipeline(tenantB),
    ]);
    expect(repeated.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect(await db.pipeline.count({ where: { tenantId: tenantA } })).toBe(1);
    expect(await db.tenant.findUniqueOrThrow({ where: { id: tenantA } })).toMatchObject({ crmEnabled: false });

    const stages = await stagesFor(tenantA);
    expect(stages.map((stage) => stage.kind)).toEqual([
      "new", "ai", "waiting_human", "human", "scheduled", "attended", "won", "lost",
    ]);
    expect((await stagesFor(tenantB)).map((stage) => stage.id)).not.toContain(stages[0].id);
    await db.pipelineStage.update({
      where: { tenantId_id: { tenantId: tenantA, id: stages[0].id } },
      data: { name: "Entrada da clínica" },
    });
    expect((await stagesFor(tenantA))[0]).toMatchObject({ id: stages[0].id, kind: "new", name: "Entrada da clínica" });
  });

  it("restringe a conta e grava a etapa com um único evento sem alterar o status legado", async () => {
    const db = prisma!;
    const [target] = await stagesFor(tenantA);
    const [foreignStage] = await stagesFor(tenantB);
    const lead = await db.lead.create({ data: { tenantId: tenantA, phone: "5500000000001", status: "warm" } });
    const input = { tenantId: tenantA, leadId: lead.id, stageId: target.id, source: "system" as const };

    expect(await setLeadStage({ ...input, stageId: foreignStage.id })).toBe("not_found");
    expect(await setLeadStage({ ...input, tenantId: tenantB })).toBe("not_found");
    await expect(db.lead.update({
      where: { tenantId_id: { tenantId: tenantA, id: lead.id } },
      data: { stageId: foreignStage.id },
    })).rejects.toMatchObject({ code: "P2003" });

    const outcomes = await Promise.all([setLeadStage(input), setLeadStage(input)]);
    expect(outcomes.filter((outcome) => outcome === "moved")).toHaveLength(1);
    expect(await setLeadStage(input)).toBe("unchanged");
    const current = await db.lead.findUniqueOrThrow({ where: { tenantId_id: { tenantId: tenantA, id: lead.id } } });
    expect(current).toMatchObject({ stageId: target.id, status: lead.status, updatedAt: lead.updatedAt });
    expect(await db.leadTransition.findMany({ where: { tenantId: tenantA, leadId: lead.id } })).toEqual([
      expect.objectContaining({ dimension: "stage", source: "system", fromStageId: null, toStageId: target.id }),
    ]);

    const secondStage = (await stagesFor(tenantA))[1];
    expect(await setLeadStage({ ...input, stageId: secondStage.id })).toBe("moved");
    expect(await db.leadTransition.findFirst({ where: { tenantId: tenantA, leadId: lead.id, toStageId: secondStage.id } }))
      .toMatchObject({ fromStageId: target.id, toStageId: secondStage.id });
  });

  it("exclui lead e conversa de sandbox", async () => {
    const db = prisma!;
    const [target] = await stagesFor(tenantA);
    const sandboxLead = await db.lead.create({ data: { tenantId: tenantA, phone: "5500000000002", isTest: true } });
    const sandboxConversation = await db.lead.create({ data: {
      tenantId: tenantA,
      phone: "5500000000003",
      conversation: { create: { tenantId: tenantA, isTest: true } },
    } });

    for (const lead of [sandboxLead, sandboxConversation]) {
      expect(await setLeadStage({ tenantId: tenantA, leadId: lead.id, stageId: target.id, source: "system" })).toBe("not_found");
      expect(await db.leadTransition.count({ where: { tenantId: tenantA, leadId: lead.id } })).toBe(0);
    }
  });

  it("reverte a troca de etapa quando a gravação do histórico falha", async () => {
    const db = prisma!;
    const [target] = await stagesFor(tenantA);
    const lead = await db.lead.create({ data: { tenantId: tenantA, phone: "5500000000004" } });
    // O Prisma valida `source` só na inserção do histórico, após o update.
    const source = "invalid-test-source" as LeadTransitionSource;
    await expect(setLeadStage({ tenantId: tenantA, leadId: lead.id, stageId: target.id, source }))
      .rejects.toThrow("Expected LeadTransitionSource");
    expect(await db.lead.findUniqueOrThrow({ where: { tenantId_id: { tenantId: tenantA, id: lead.id } } })).toMatchObject({ stageId: null });
    expect(await db.leadTransition.count({ where: { tenantId: tenantA, leadId: lead.id } })).toBe(0);
  });

  it("classifica os leads existentes com precedência e provas sem alterar status ou atividade", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const otherLead = await db.lead.create({ data: { tenantId: otherTenantId, phone: "5500000000100" } });
    const cases: ActivationFixture[] = [
      { expected: "scheduled", status: "scheduled", needsHuman: true, messages: [inbound, aiReply] },
      { expected: "lost", status: "lost", needsHuman: true, messages: [inbound, aiReply] },
      { expected: "waiting_human", needsHuman: true, messages: [inbound, aiReply] },
      { expected: "ai", status: "warm", messages: [inbound, aiReply] },
      { expected: "new", messages: [aiReply] },
      { expected: "new", messages: [{ ...inbound, createdAt: new Date(+replyAt + 60_000) }, aiReply] },
      { expected: "new", messages: [inbound, aiReply], automaticSend: "followup" },
      { expected: "new", messages: [inbound, aiReply], automaticSend: "reminder" },
      { expected: "new", messages: [inbound, aiReply], automaticSend: "campaign" },
      { expected: "new", messages: [inbound, { ...aiReply, recoveredAt: replyAt }] },
      { expected: "new", messages: [{ ...inbound, recoveredAt: inboundAt }, aiReply] },
      { expected: "new", messages: [inbound, { ...aiReply, sentBy: "human" }] },
      { expected: "new" },
      { expected: null, leadTest: true, messages: [inbound, aiReply] },
      { expected: null, conversationTest: true, messages: [inbound, aiReply] },
    ];
    const leads = [];
    for (const [index, fixture] of cases.entries()) {
      const lead = await db.lead.create({
        data: {
          tenantId,
          phone: `55${String(index).padStart(11, "0")}`,
          status: fixture.status,
          isTest: fixture.leadTest,
          conversation: fixture.messages ? { create: {
            tenantId,
            needsHuman: fixture.needsHuman,
            isTest: fixture.conversationTest,
            messages: { create: fixture.messages.map((message) => ({
              ...message,
              ...(fixture.automaticSend && message.role === "assistant" ? { whatsappMessageId: randomUUID() } : {}),
            })) },
          } } : undefined,
        },
        include: { conversation: { include: { messages: true } } },
      });
      leads.push(lead);
      if (fixture.automaticSend) {
        const conversation = lead.conversation!;
        const message = conversation.messages.find(({ role }) => role === "assistant")!;
        if (fixture.automaticSend === "followup") {
          const kind = "contact_followup";
          await db.reportEvent.create({ data: {
            tenantId,
            conversationId: conversation.id,
            kind,
            dedupKey: `contact-context:${tenantId}:${conversation.id}:${kind}:${message.id}`,
          } });
        } else if (fixture.automaticSend === "reminder") {
          await db.reminderDispatch.create({ data: {
            tenantId,
            sourceKey: `crm-qa:${lead.id}`,
            startsAt: replyAt,
            minutesBefore: 30,
            state: "accepted",
            messageId: message.whatsappMessageId,
            conversationId: conversation.id,
          } });
        } else {
          await db.broadcastCampaign.create({ data: {
            tenantId,
            name: "Campanha de teste",
            phoneNumberId: "crm-qa",
            template: {},
            recipients: { create: {
              row: 1,
              phone: lead.phone,
              parameters: {},
              content: "Mensagem de teste",
              status: "sent",
              whatsappMessageId: message.whatsappMessageId,
              conversationId: conversation.id,
            } },
          } });
        }
      }
    }

    expect(await setCrmEnabled(tenantId, true)).toBe("changed");
    expect(await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).toMatchObject({ crmEnabled: true });
    expect(await db.tenant.findUniqueOrThrow({ where: { id: otherTenantId } })).toMatchObject({ crmEnabled: false });
    expect(await db.lead.findUniqueOrThrow({ where: { tenantId_id: { tenantId: otherTenantId, id: otherLead.id } } }))
      .toMatchObject({ stageId: null });

    for (const [index, lead] of leads.entries()) {
      const expected = cases[index].expected;
      const current = await db.lead.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: lead.id } },
        include: { stage: true, transitions: true },
      });
      expect(current.stage?.kind ?? null).toBe(expected);
      expect(current).toMatchObject({ status: lead.status, updatedAt: lead.updatedAt });
      expect(current.transitions).toEqual(expected ? [expect.objectContaining({
        tenantId,
        dimension: "stage",
        source: "system",
        fromStageId: null,
        toStageId: current.stageId,
      })] : []);
    }

    productAccess.mockResolvedValue({ session: { user: { tenantId, role: "OWNER" } } });
    const { stages } = await getCrmOverview();
    expect(stages).toHaveLength(8);
    expect(stages.reduce((total, { _count }) => total + _count.leads, 0))
      .toBe(cases.filter(({ expected }) => expected !== null).length);
    expect(stages[0]).toMatchObject({ name: "Novo lead", _count: { leads: cases.filter(({ expected }) => expected === "new").length } });

    productAccess.mockResolvedValue({ session: { user: { tenantId: otherTenantId, role: "OWNER" } } });
    await expect(getCrmOverview()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  }, 20_000);

  it("inicializa contatos novos apenas com CRM liberado e preserva etapas ao religar", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const inactiveTenantId = await createTenant("suspended");
    expect(await setCrmEnabled(inactiveTenantId, true)).toBe("inactive");
    expect(await setCrmEnabled(`crm-ausente-${randomUUID()}`, true)).toBe("not_found");
    expect(await setCrmEnabled(tenantId, true)).toBe("changed");
    expect(await setCrmEnabled(tenantId, true)).toBe("unchanged");

    const stages = await stagesFor(tenantId);
    const newStage = stages.find(({ kind }) => kind === "new")!;
    const scheduledStage = stages.find(({ kind }) => kind === "scheduled")!;
    const { lead } = await getOrCreateConversation(tenantId, "5511999700000");
    expect(lead.stageId).toBe(newStage.id);
    expect(await setLeadStage({ tenantId, leadId: lead.id, stageId: scheduledStage.id, source: "system" })).toBe("moved");
    const { lead: sandbox } = await getOrCreateConversation(tenantId, "5511999700001", undefined, { isTest: true });
    expect(sandbox.stageId).toBeNull();

    expect(await setCrmEnabled(tenantId, false)).toBe("changed");
    expect(await setCrmEnabled(tenantId, false)).toBe("unchanged");
    const { lead: whileDisabled } = await getOrCreateConversation(tenantId, "5511999700002");
    expect(whileDisabled.stageId).toBeNull();
    expect(await setCrmEnabled(tenantId, true)).toBe("changed");
    const rows = await db.lead.findMany({ where: { tenantId }, include: { transitions: true } });
    const existing = rows.find(({ id }) => id === lead.id);
    expect(existing?.stageId).toBe(scheduledStage.id);
    expect(existing?.transitions).toHaveLength(2);
    expect(existing?.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromStageId: null, toStageId: newStage.id }),
      expect.objectContaining({ fromStageId: newStage.id, toStageId: scheduledStage.id }),
    ]));
    expect(rows.find(({ id }) => id === whileDisabled.id)).toMatchObject({ stageId: newStage.id, transitions: [
      expect.objectContaining({ fromStageId: null, toStageId: newStage.id }),
    ] });
    expect(rows.find(({ id }) => id === sandbox.id)).toMatchObject({ stageId: null, transitions: [] });
  });

  it("publica após cobrir lotes e entrada simultânea, sem duplicar eventos", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const existingCount = 265;
    await db.lead.createMany({ data: Array.from({ length: existingCount }, (_, index) => ({
      tenantId,
      phone: `55${String(index).padStart(11, "0")}`,
    })) });

    const [first, second, { lead }] = await Promise.all([
      setCrmEnabled(tenantId, true),
      setCrmEnabled(tenantId, true),
      getOrCreateConversation(tenantId, "5511999700100"),
    ]);
    expect([first, second].filter((result) => result === "changed")).toHaveLength(1);
    expect(await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).toMatchObject({ crmEnabled: true });
    expect(await db.lead.count({ where: { tenantId, stage: { kind: "new" } } })).toBe(existingCount + 1);
    expect(await db.leadTransition.count({ where: { tenantId, dimension: "stage" } })).toBe(existingCount + 1);
    expect(await db.leadTransition.count({ where: { tenantId, leadId: lead.id, dimension: "stage" } })).toBe(1);
  }, 20_000);

  it("mantém o CRM desligado quando o admin cancela durante o preparo", async () => {
    const db = prisma!;
    const tenantId = await createTenant();
    const lead = await db.lead.create({ data: { tenantId, phone: "5500000000101" } });
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${lead.id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    let activating: ReturnType<typeof setCrmEnabled> | undefined;
    let cancelling: ReturnType<typeof setCrmEnabled> | undefined;

    try {
      await Promise.race([locked.promise, blocker]);
      activating = setCrmEnabled(tenantId, true);
      void activating.catch(() => {});
      await vi.waitFor(async () => {
        const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
        expect(tenant.crmActivationToken).toBeTruthy();
        expect(tenant.crmEnabled).toBe(false);
      });
      let cancelled = false;
      cancelling = setCrmEnabled(tenantId, false).then((result) => {
        cancelled = true;
        return result;
      });
      void cancelling.catch(() => {});
      await vi.waitFor(async () => {
        const [lock] = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND mode = 'ExclusiveLock' AND NOT granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          ) AS waiting
        `;
        expect(cancelled || lock.waiting).toBe(true);
      });
      release.resolve();
      await expect(cancelling).resolves.toBe("unchanged");
      await expect(activating).resolves.toBe("superseded");
    } finally {
      release.resolve();
      await Promise.allSettled([blocker, activating, cancelling]);
    }
    expect(await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).toMatchObject({
      crmEnabled: false, crmActivationToken: null,
    });
    expect(await setCrmEnabled(tenantId, true)).toBe("changed");
    expect(await db.leadTransition.count({ where: { tenantId, leadId: lead.id } })).toBe(1);
  }, 20_000);
});
