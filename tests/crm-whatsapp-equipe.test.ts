import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, WhatsAppProvider } from "@/modules/whatsapp/provider";

const db = vi.hoisted(() => {
  const team = { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() };
  const client = {
    teamMemberWhatsapp: team,
    $transaction: vi.fn(),
  };
  return client;
});
const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit }));

import {
  confirmTeamWhatsappLink,
  learnTeamMemberLid,
  parseTeamLinkCommand,
  resolveGroupMember,
  startTeamWhatsappLink,
  TEAM_LINK_CODE_MINUTES,
} from "@/modules/crm/team-whatsapp";
import { handleTeamLinkCommand } from "@/modules/crm/team-whatsapp-command";
import { EvolutionProvider } from "@/modules/whatsapp/evolution";

const TENANT = "conta-a";
const USER = "usuario-1";
const NOW = new Date("2026-11-24T15:00:00Z");
const hash = (code: string, userId = USER) => createHash("sha256").update(`${TENANT}:${userId}:${code}`).digest("hex");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[])));
  db.teamMemberWhatsapp.updateMany.mockResolvedValue({ count: 1 });
});

describe("comando #vincular", () => {
  it.each(["#vincular 123456", "  #VINCULAR 123456  ", "#vincular\t000001"])("aceita %j", (text) => {
    expect(parseTeamLinkCommand(text)).toMatch(/^\d{6}$/);
  });

  it.each(["#vincular 12345", "vincular 123456", "#vincular 123456 obrigado", "oi #vincular 123456", ""])("recusa %j", (text) => {
    expect(parseTeamLinkCommand(text)).toBeNull();
  });
});

describe("gerar o código", () => {
  it("guarda o número pendente na forma canônica e só o hash do código", async () => {
    db.teamMemberWhatsapp.findFirst.mockResolvedValue(null);
    db.teamMemberWhatsapp.findUnique.mockResolvedValue(null);
    const result = await startTeamWhatsappLink(TENANT, USER, "(11) 98765-4321", NOW);
    expect(result).toMatchObject({ status: "started", phone: "5511987654321" });
    if (result.status !== "started") throw new Error("esperado started");
    expect(result.expiresAt.getTime() - NOW.getTime()).toBe(TEAM_LINK_CODE_MINUTES * 60_000);
    const saved = db.teamMemberWhatsapp.upsert.mock.calls[0][0];
    expect(saved.where).toEqual({ tenantId_userId: { tenantId: TENANT, userId: USER } });
    expect(saved.create).toMatchObject({ tenantId: TENANT, userId: USER, pendingPhone: "5511987654321", pendingKey: "1187654321" });
    expect(saved.create.codeHash).toBe(hash(result.code));
    expect(JSON.stringify(saved)).not.toContain(`"${result.code}"`);
  });

  it("recusa número já confirmado por outra pessoa da conta, nas duas grafias do celular", async () => {
    db.teamMemberWhatsapp.findFirst.mockResolvedValue({ id: "outra" });
    db.teamMemberWhatsapp.findUnique.mockResolvedValue(null);
    await expect(startTeamWhatsappLink(TENANT, USER, "1187654321", NOW)).resolves.toEqual({ status: "taken" });
    expect(db.teamMemberWhatsapp.findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, phoneKey: "1187654321", verifiedAt: { not: null }, NOT: { userId: USER } }, select: { id: true },
    });
    expect(db.teamMemberWhatsapp.upsert).not.toHaveBeenCalled();
  });

  it("recusa telefone inválido e não regrava o mesmo número já confirmado", async () => {
    await expect(startTeamWhatsappLink(TENANT, USER, "123", NOW)).resolves.toEqual({ status: "invalid" });
    db.teamMemberWhatsapp.findFirst.mockResolvedValue(null);
    db.teamMemberWhatsapp.findUnique.mockResolvedValue({ phoneKey: "1187654321", verifiedAt: NOW });
    await expect(startTeamWhatsappLink(TENANT, USER, "11 98765-4321", NOW)).resolves.toEqual({ status: "already_verified" });
  });
});

describe("confirmar pelo WhatsApp", () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    id: "linha-1", userId: USER, pendingPhone: "5511987654321", codeHash: hash("123456"), phoneKey: null, lid: null,
    user: { name: "Marina Souza", email: "marina@clinica.test" }, ...over,
  });

  it("confirma quando o código e o número de quem mandou batem, mesmo sem o nono dígito", async () => {
    db.teamMemberWhatsapp.findMany.mockResolvedValue([pending()]);
    const result = await confirmTeamWhatsappLink({ tenantId: TENANT, code: "123456", senderPhone: "551187654321", senderLid: "98765432109876", now: NOW });
    expect(result).toEqual({ status: "verified", userId: USER, name: "Marina Souza" });
    expect(db.teamMemberWhatsapp.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT, pendingKey: "1187654321", codeExpiresAt: { gt: NOW }, user: { tenantId: TENANT, usesProduct: true } },
    }));
    expect(db.teamMemberWhatsapp.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, lid: "98765432109876", NOT: { id: "linha-1" } }, data: { lid: null },
    });
    expect(db.teamMemberWhatsapp.updateMany).toHaveBeenLastCalledWith({
      where: { id: "linha-1", tenantId: TENANT, codeHash: hash("123456"), codeExpiresAt: { gt: NOW } },
      data: { phone: "5511987654321", phoneKey: "1187654321", lid: "98765432109876", verifiedAt: NOW,
        pendingPhone: null, pendingKey: null, codeHash: null, codeExpiresAt: null },
    });
  });

  it("código errado, vencido ou de outro número não confirma", async () => {
    db.teamMemberWhatsapp.findMany.mockResolvedValue([pending()]);
    await expect(confirmTeamWhatsappLink({ tenantId: TENANT, code: "654321", senderPhone: "5511987654321", now: NOW }))
      .resolves.toEqual({ status: "invalid" });
    db.teamMemberWhatsapp.findMany.mockResolvedValue([]);
    await expect(confirmTeamWhatsappLink({ tenantId: TENANT, code: "123456", senderPhone: "5521912345678", now: NOW }))
      .resolves.toEqual({ status: "invalid" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("evento de grupo só com @lid não prova o número e não confirma nada", async () => {
    await expect(confirmTeamWhatsappLink({ tenantId: TENANT, code: "123456", senderLid: "98765432109876", now: NOW }))
      .resolves.toEqual({ status: "no_phone" });
    expect(db.teamMemberWhatsapp.findMany).not.toHaveBeenCalled();
  });

  it("o mesmo código entregue duas vezes confirma uma vez só", async () => {
    db.teamMemberWhatsapp.findMany.mockResolvedValue([pending()]);
    db.teamMemberWhatsapp.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmTeamWhatsappLink({ tenantId: TENANT, code: "123456", senderPhone: "5511987654321", now: NOW }))
      .resolves.toEqual({ status: "invalid" });
  });

  it("dois usuários da mesma conta não ficam com o mesmo número (índice único)", async () => {
    db.teamMemberWhatsapp.findMany.mockResolvedValue([pending()]);
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" }));
    await expect(confirmTeamWhatsappLink({ tenantId: TENANT, code: "123456", senderPhone: "5511987654321", now: NOW }))
      .resolves.toEqual({ status: "taken" });
  });

  it("número igual ao já confirmado mantém o LID aprendido", async () => {
    db.teamMemberWhatsapp.findMany.mockResolvedValue([pending({ phoneKey: "1187654321", lid: "111112222233333" })]);
    await confirmTeamWhatsappLink({ tenantId: TENANT, code: "123456", senderPhone: "5511987654321", now: NOW });
    expect(db.teamMemberWhatsapp.updateMany.mock.calls.at(-1)?.[0].data.lid).toBe("111112222233333");
  });
});

describe("resolveGroupMember", () => {
  const member = { userId: USER, user: { name: "Marina Souza", email: "marina@clinica.test" } };

  it("acha pelo número, nas duas grafias, só com número confirmado e usuário ativo na conta", async () => {
    db.teamMemberWhatsapp.findFirst.mockResolvedValue(member);
    for (const value of ["5511987654321@s.whatsapp.net", "551187654321", "(11) 98765-4321"]) {
      await expect(resolveGroupMember(TENANT, value)).resolves.toEqual({ userId: USER, name: "Marina Souza" });
    }
    for (const [args] of db.teamMemberWhatsapp.findFirst.mock.calls) {
      expect(args.where).toEqual({ tenantId: TENANT, phoneKey: "1187654321", verifiedAt: { not: null }, user: { tenantId: TENANT, usesProduct: true } });
    }
  });

  it("acha pelo LID aprendido", async () => {
    db.teamMemberWhatsapp.findFirst.mockResolvedValue(member);
    await expect(resolveGroupMember(TENANT, "98765432109876@lid")).resolves.toMatchObject({ userId: USER });
    expect(db.teamMemberWhatsapp.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: TENANT, lid: "98765432109876", verifiedAt: { not: null }, user: { tenantId: TENANT, usesProduct: true },
    });
  });

  it("número não confirmado, lixo ou falha no banco viram null, sem lançar", async () => {
    db.teamMemberWhatsapp.findFirst.mockResolvedValue(null);
    await expect(resolveGroupMember(TENANT, "5511987654321")).resolves.toBeNull();
    await expect(resolveGroupMember(TENANT, "abc")).resolves.toBeNull();
    db.teamMemberWhatsapp.findFirst.mockRejectedValueOnce(new Error("banco fora"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(resolveGroupMember(TENANT, "5511987654321")).resolves.toBeNull();
    log.mockRestore();
  });
});

describe("aprender o LID", () => {
  it("grava o LID no número confirmado e tira de outra linha da conta", async () => {
    db.teamMemberWhatsapp.findFirst.mockResolvedValue({ id: "linha-1", lid: null });
    await learnTeamMemberLid(TENANT, "5511987654321", "98765432109876");
    expect(db.teamMemberWhatsapp.findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, phoneKey: "1187654321", verifiedAt: { not: null } }, select: { id: true, lid: true },
    });
    expect(db.teamMemberWhatsapp.updateMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, lid: "98765432109876", NOT: { id: "linha-1" } }, data: { lid: null } });
    expect(db.teamMemberWhatsapp.updateMany).toHaveBeenCalledWith({ where: { id: "linha-1", tenantId: TENANT }, data: { lid: "98765432109876" } });
  });

  it("não escreve quando já sabe o LID ou o número não é da equipe", async () => {
    db.teamMemberWhatsapp.findFirst.mockResolvedValueOnce({ id: "linha-1", lid: "98765432109876" }).mockResolvedValueOnce(null);
    await learnTeamMemberLid(TENANT, "5511987654321", "98765432109876");
    await learnTeamMemberLid(TENANT, "5511900000000", "98765432109876");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("mensagem #vincular no webhook", () => {
  const sendGroupMessage = vi.fn();
  const sendMessage = vi.fn();
  const provider = { name: "evolution", sendGroupMessage, sendMessage } as unknown as WhatsAppProvider;
  const base: IncomingMessage = {
    instanceExternalId: "tenant_conta-a", fromPhone: "5511987654321", text: "#vincular 123456",
    isGroup: false, hasAudio: false, messageKeyId: "msg-1",
  };

  beforeEach(() => {
    db.teamMemberWhatsapp.findMany.mockResolvedValue([{
      id: "linha-1", userId: USER, pendingPhone: "5511987654321", codeHash: hash("123456"), phoneKey: null, lid: null,
      user: { name: "Marina", email: "marina@clinica.test" },
    }]);
  });

  it("mensagem comum não é o comando e segue o atendimento", async () => {
    await expect(handleTeamLinkCommand({ tenantId: TENANT, incoming: { ...base, text: "oi" }, provider })).resolves.toEqual({ handled: false });
    await expect(handleTeamLinkCommand({ tenantId: TENANT, incoming: { ...base, isFromMe: true }, provider })).resolves.toEqual({ handled: false });
    await expect(handleTeamLinkCommand({ tenantId: TENANT, incoming: base, provider: { ...provider, name: "meta" } as WhatsAppProvider }))
      .resolves.toEqual({ handled: false });
    expect(db.teamMemberWhatsapp.findMany).not.toHaveBeenCalled();
  });

  it("no privado confirma e não manda nada para o celular da pessoa", async () => {
    await expect(handleTeamLinkCommand({ tenantId: TENANT, incoming: { ...base, contactLid: "98765432109876" }, provider }))
      .resolves.toEqual({ handled: true });
    expect(db.teamMemberWhatsapp.updateMany.mock.calls.at(-1)?.[0].data).toMatchObject({ phoneKey: "1187654321", lid: "98765432109876" });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      event: "account.whatsapp_verified", tenantId: TENANT, actor: { id: USER, role: "OWNER" }, meta: { via: "private" },
    }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("98765-4321");
  });

  it("no grupo usa o participante e responde no próprio grupo", async () => {
    const incoming = { ...base, isGroup: true, fromPhone: "120363012345678901", groupSender: { phone: "5511987654321", lid: "98765432109876" } };
    await expect(handleTeamLinkCommand({ tenantId: TENANT, incoming, provider })).resolves.toEqual({ handled: true });
    expect(sendGroupMessage).toHaveBeenCalledWith("tenant_conta-a", "120363012345678901@g.us", expect.stringContaining("Marina"));
  });

  it("grupo que esconde o número pede o código no privado", async () => {
    const incoming = { ...base, isGroup: true, fromPhone: "120363012345678901", groupSender: { lid: "98765432109876" } };
    await handleTeamLinkCommand({ tenantId: TENANT, incoming, provider });
    expect(db.teamMemberWhatsapp.findMany).not.toHaveBeenCalled();
    expect(sendGroupMessage).toHaveBeenCalledWith("tenant_conta-a", "120363012345678901@g.us", expect.stringContaining("privado"));
  });

  it("reentrega da mesma mensagem não processa de novo", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    await expect(handleTeamLinkCommand({ tenantId: TENANT, incoming: base, provider })).resolves.toEqual({ handled: true });
    expect(db.teamMemberWhatsapp.findMany).not.toHaveBeenCalled();
  });

  it("falha no banco ainda segura o comando fora do atendimento", async () => {
    db.teamMemberWhatsapp.findMany.mockRejectedValueOnce(new Error("banco fora"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handleTeamLinkCommand({ tenantId: TENANT, incoming: base, provider })).resolves.toEqual({ handled: true });
    log.mockRestore();
  });
});

describe("quem escreveu no grupo (EvolutionProvider.parseWebhook)", () => {
  const evolution = new EvolutionProvider();
  const event = (key: Record<string, unknown>) => ({
    instance: "tenant_conta-a",
    data: { key: { id: "m1", fromMe: false, ...key }, message: { conversation: "#vincular 123456" } },
  });

  it("grupo com @lid e o número alternativo traz os dois", () => {
    const parsed = evolution.parseWebhook(event({
      remoteJid: "120363012345678901@g.us", participant: "98765432109876@lid", participantAlt: "5511987654321@s.whatsapp.net",
    }));
    expect(parsed).toMatchObject({ isGroup: true, fromPhone: "120363012345678901", groupSender: { phone: "5511987654321", lid: "98765432109876" } });
  });

  it("grupo com só o @lid não inventa telefone", () => {
    const parsed = evolution.parseWebhook(event({ remoteJid: "120363012345678901@g.us", participant: "98765432109876@lid" }));
    expect(parsed?.groupSender).toEqual({ lid: "98765432109876" });
  });

  it("privado endereçado por @lid guarda o LID do contato e o telefone do JID alternativo", () => {
    const parsed = evolution.parseWebhook(event({ remoteJid: "98765432109876@lid", remoteJidAlt: "5511987654321@s.whatsapp.net" }));
    expect(parsed).toMatchObject({ isGroup: false, fromPhone: "5511987654321", contactLid: "98765432109876" });
    expect(parsed?.groupSender).toBeUndefined();
  });
});
