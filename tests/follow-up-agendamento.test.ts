import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Varredura do follow-up em esteira (`workers/follow-up-worker/scan.ts`).
 *
 * O estrago que cada regra evita é concreto: cobrar quem já marcou consulta,
 * mandar "oi, sumiu?" de madrugada, disparar a esteira inteira em conversas
 * antigas quando a conta liga o follow-up, e insistir com quem pediu para
 * parar.
 */

const db = vi.hoisted(() => ({
  tenantAction: { findMany: vi.fn() },
  conversation: { findMany: vi.fn(), update: vi.fn() },
  whatsappInstance: { findMany: vi.fn() },
  whatsappBlockedNumber: { findUnique: vi.fn() },
  message: { create: vi.fn() },
}));
const provider = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn(async (...args: [string, string, string]) => {
    void args;
    return "wamid-follow-up";
  }),
}));
const compose = vi.hoisted(() => ({ composeFollowUp: vi.fn() }));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/modules/whatsapp", () => ({ getWhatsAppProvider: () => provider }));
vi.mock("../src/modules/follow-up/compose", () => compose);

import {
  isStale,
  isWithinFollowUpWindow,
  nextFollowUp,
  scanAndSendFollowUps,
  stepsSentInRun,
} from "../workers/follow-up-worker/scan";
import { DEFAULT_FOLLOWUP_CONFIG, type FollowUpConfig } from "@/modules/follow-up/config";

// 09:00 em São Paulo — dentro da janela padrão (6h às 22h).
const NOW = new Date("2026-09-20T12:00:00.000Z");
const MIN = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);

const ESTEIRA: FollowUpConfig = {
  noReply: {
    enabled: true,
    steps: [
      { delayMinutes: 30, message: "Primeira, {{nome}}.", ai: false },
      { delayMinutes: 180, message: "Segunda.", ai: false },
    ],
  },
  declined: { enabled: true, steps: [{ delayMinutes: 1440, message: "Pensou melhor?", ai: false }] },
  window: { startHour: 6, endHour: 22 },
};

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: "conversa-1",
    tenantId: "tenant-1",
    agentId: "agente-1",
    needsHuman: false,
    agentPaused: false,
    lastInboundAt: ago(120),
    followUpSentAt: null,
    followUpStep: 0,
    followUpReason: null,
    variables: {},
    agent: { systemPrompt: "Você é a Ana.", enabled: true },
    lead: {
      id: "lead-1",
      name: "Maria",
      phone: "5511999999999",
      isTest: false,
      appointments: [] as { id: string }[],
    },
    messages: [{ role: "assistant", createdAt: ago(119) }],
    ...over,
  };
}

function acao(config: unknown = { delayMinutes: 60, message: "Posso ajudar?" }) {
  db.tenantAction.findMany.mockImplementation((args: { where: { key: string } }) =>
    Promise.resolve(
      args.where.key === "follow_up"
        ? [{ tenantId: "tenant-1", agentId: "agente-1", config }]
        : [{ agentId: "agente-1", config: { timezone: "America/Sao_Paulo" } }],
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  acao();
  db.whatsappInstance.findMany.mockResolvedValue([{ externalId: "instancia-1", status: "connected" }]);
  db.message.create.mockResolvedValue({ id: "mensagem-1" });
  db.conversation.update.mockResolvedValue({});
  db.whatsappBlockedNumber.findUnique.mockResolvedValue(null);
  provider.isConfigured.mockReturnValue(true);
  provider.sendMessage.mockResolvedValue("wamid-follow-up");
});

describe("follow-up com consulta marcada", () => {
  it("a regra pura recusa contato com consulta marcada ou realizada, futura ou passada", () => {
    expect(nextFollowUp({ ...conversation(), lastMessage: { role: "assistant", createdAt: ago(119) }, hasActiveAppointment: true }, ESTEIRA)).toBeNull();
  });

  it("a busca exclui consulta vinculada ao lead, inclusive a manual", async () => {
    db.conversation.findMany.mockResolvedValue([]);

    await scanAndSendFollowUps(NOW);

    expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        lead: {
          appointments: {
            none: { status: { in: ["scheduled", "done"] } },
          },
        },
      }),
    }));
  });

  it("não envia mesmo se uma conversa com consulta escapar da consulta principal", async () => {
    db.conversation.findMany.mockResolvedValue([
      conversation({ lead: { ...conversation().lead, appointments: [{ id: "consulta-1" }] } }),
    ]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("mantém o follow-up para contato sem consulta (config antiga de mensagem única)", async () => {
    db.conversation.findMany.mockResolvedValue([conversation()]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 1 });
    expect(provider.sendMessage).toHaveBeenCalledWith("instancia-1", "5511999999999", "Posso ajudar?");
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversa-1" },
      data: { followUpSentAt: NOW, followUpStep: 1 },
    });
  });

  it("a busca exclui conversa com humano assumido e agente pausado", async () => {
    db.conversation.findMany.mockResolvedValue([]);

    await scanAndSendFollowUps(NOW);

    expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentPaused: false,
        agent: { enabled: true },
      }),
    }));
  });

  it("não envia mesmo se uma conversa com humano assumido escapar da consulta principal", async () => {
    db.conversation.findMany.mockResolvedValue([conversation({ agentPaused: true })]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("não envia mesmo se uma conversa de agente pausado escapar da consulta principal", async () => {
    db.conversation.findMany.mockResolvedValue([
      conversation({ agent: { systemPrompt: "Você é a Ana.", enabled: false } }),
    ]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("não envia nem registra follow-up para número bloqueado", async () => {
    db.conversation.findMany.mockResolvedValue([conversation()]);
    db.whatsappBlockedNumber.findUnique.mockResolvedValue({ id: "bloqueio-1" });

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });

    expect(db.whatsappBlockedNumber.findUnique).toHaveBeenCalledWith({
      where: { tenantId_phone: { tenantId: "tenant-1", phone: "1199999999" } },
      select: { id: true },
    });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("substitui variáveis conhecidas e omite campo não informado", async () => {
    acao({ delayMinutes: 60, message: "Oi {{nome}}! Endereço: {{endereco}}." });
    db.conversation.findMany.mockResolvedValue([conversation({ variables: { nome: "Alcides" } })]);

    await scanAndSendFollowUps(NOW);

    expect(provider.sendMessage).toHaveBeenCalledWith("instancia-1", "5511999999999", "Oi Alcides!");
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: "Oi Alcides!" }),
    }));
  });
});

describe("esteira (regra pura)", () => {
  const silent = (over: Record<string, unknown> = {}) => ({
    ...conversation(over),
    lastMessage: { role: "assistant", createdAt: ago(119) },
  });

  it("a primeira etapa conta da última fala do agente", () => {
    const next = nextFollowUp(silent(), ESTEIRA);
    expect(next?.index).toBe(0);
    expect(next?.dueAt).toEqual(new Date(ago(119).getTime() + 30 * MIN));
  });

  it("a segunda conta do envio anterior, não do começo do silêncio", () => {
    const next = nextFollowUp(silent({ followUpSentAt: ago(60), followUpStep: 1 }), ESTEIRA);
    expect(next?.index).toBe(1);
    expect(next?.dueAt).toEqual(new Date(ago(60).getTime() + 180 * MIN));
  });

  it("a resposta do contato encerra a esteira: o próximo silêncio recomeça da etapa 1", () => {
    // Envio da etapa 2 foi ANTES da última mensagem do contato.
    const conv = { followUpSentAt: ago(300), followUpStep: 2, lastInboundAt: ago(120) };
    expect(stepsSentInRun(conv)).toBe(0);
    expect(nextFollowUp(silent(conv), ESTEIRA)?.index).toBe(0);
  });

  it("esteira acabou: nada mais sai", () => {
    expect(nextFollowUp(silent({ followUpSentAt: ago(10), followUpStep: 2 }), ESTEIRA)).toBeNull();
  });

  it("quem não quer agendar agora vai para a esteira espaçada", () => {
    const next = nextFollowUp(silent({ followUpReason: "declined" }), ESTEIRA);
    expect(next?.step.message).toBe("Pensou melhor?");
  });

  it("quem pediu para parar não recebe nada", () => {
    expect(nextFollowUp(silent({ followUpReason: "stop" }), ESTEIRA)).toBeNull();
  });

  it("esteira desligada não manda nada", () => {
    expect(nextFollowUp(silent({ followUpReason: "declined" }), { ...ESTEIRA, declined: { ...ESTEIRA.declined, enabled: false } })).toBeNull();
  });

  it("mensagem do contato ainda sem resposta não é silêncio", () => {
    expect(nextFollowUp({ ...conversation(), lastMessage: { role: "user", createdAt: ago(119) } }, ESTEIRA)).toBeNull();
  });

  it("humano assumiu a conversa manualmente: esteira não fala por cima", () => {
    expect(nextFollowUp(silent({ agentPaused: true }), ESTEIRA)).toBeNull();
  });

  it("histórico recuperado não dispara follow-up", () => {
    expect(nextFollowUp({ ...silent(), lastMessage: { role: "assistant", createdAt: ago(119), sentBy: "history" } }, ESTEIRA)).toBeNull();
  });

  it("agente com a chave geral desligada não reengaja", () => {
    expect(nextFollowUp({ ...silent(), agentEnabled: false }, ESTEIRA)).toBeNull();
  });

  it("respeita a janela de envio no fuso da agenda", () => {
    const window = DEFAULT_FOLLOWUP_CONFIG.window;
    expect(isWithinFollowUpWindow(new Date("2026-09-20T12:00:00.000Z"), window, "America/Sao_Paulo")).toBe(true);
    // 03:00 em São Paulo.
    expect(isWithinFollowUpWindow(new Date("2026-09-20T06:00:00.000Z"), window, "America/Sao_Paulo")).toBe(false);
  });

  it("etapa vencida há mais de 26h não sai mais", () => {
    expect(isStale(ago(25 * 60), NOW)).toBe(false);
    expect(isStale(ago(27 * 60), NOW)).toBe(true);
  });
});

describe("esteira (varredura)", () => {
  it("fora da janela a etapa espera, sem consumir", async () => {
    acao({ ...ESTEIRA, window: { startHour: 10, endHour: 22 } });
    db.conversation.findMany.mockResolvedValue([conversation()]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("conta que acabou de ligar o follow-up não dispara em conversa antiga", async () => {
    acao(ESTEIRA);
    db.conversation.findMany.mockResolvedValue([
      conversation({ lastInboundAt: ago(5 * 24 * 60), messages: [{ role: "assistant", createdAt: ago(5 * 24 * 60) }] }),
    ]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("avança para a etapa seguinte e grava a posição", async () => {
    acao(ESTEIRA);
    db.conversation.findMany.mockResolvedValue([conversation({
      lastInboundAt: ago(300),
      followUpSentAt: ago(200),
      followUpStep: 1,
      messages: [{ role: "assistant", createdAt: ago(200) }],
    })]);

    await scanAndSendFollowUps(NOW);

    expect(provider.sendMessage).toHaveBeenCalledWith("instancia-1", "5511999999999", "Segunda.");
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversa-1" },
      data: { followUpSentAt: NOW, followUpStep: 2 },
    });
  });

  it("WhatsApp desconectado não consome a etapa: tenta de novo na próxima varredura", async () => {
    db.conversation.findMany.mockResolvedValue([conversation()]);
    db.whatsappInstance.findMany.mockResolvedValue([{ externalId: "instancia-1", status: "disconnected" }]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("falha no envio não registra mensagem nem consome a etapa", async () => {
    db.conversation.findMany.mockResolvedValue([conversation()]);
    provider.sendMessage.mockRejectedValue(new Error("WhatsApp indisponível"));

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("etapa com IA manda o texto composto e conta na cota", async () => {
    acao({ ...ESTEIRA, noReply: { enabled: true, steps: [{ delayMinutes: 30, message: "Base.", ai: true }] } });
    db.conversation.findMany.mockResolvedValue([conversation()]);
    compose.composeFollowUp.mockResolvedValue({ text: "Conseguiu ver os horários de quinta?", byAi: true });

    await scanAndSendFollowUps(NOW);

    expect(compose.composeFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversa-1",
      reference: "Base.",
      systemPrompt: "Você é a Ana.",
    }));
    expect(provider.sendMessage).toHaveBeenCalledWith("instancia-1", "5511999999999", "Conseguiu ver os horários de quinta?");
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sentBy: "agent" }),
    }));
  });

  it("mensagem fixa não conta na cota", async () => {
    db.conversation.findMany.mockResolvedValue([conversation()]);

    await scanAndSendFollowUps(NOW);

    expect(compose.composeFollowUp).not.toHaveBeenCalled();
    expect(db.message.create.mock.calls[0][0].data.sentBy).toBeUndefined();
  });

  it("não compõe pela IA quando o WhatsApp não tem como entregar", async () => {
    acao({ ...ESTEIRA, noReply: { enabled: true, steps: [{ delayMinutes: 30, message: "Base.", ai: true }] } });
    db.conversation.findMany.mockResolvedValue([conversation()]);
    db.whatsappInstance.findMany.mockResolvedValue([]);

    await scanAndSendFollowUps(NOW);

    expect(compose.composeFollowUp).not.toHaveBeenCalled();
  });
});

describe("follow-up com as duas conexões (QR e Meta)", () => {
  const QR = { provider: "evolution", externalId: "instancia-qr", status: "connected" };
  const META = { provider: "meta", externalId: "phone-meta", status: "connected" };

  it("sai pelo número em que o contato escreveu: Meta", async () => {
    db.conversation.findMany.mockResolvedValue([conversation({ whatsappProvider: "meta" })]);
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 1 });
    expect(provider.sendMessage).toHaveBeenCalledWith("phone-meta", "5511999999999", "Posso ajudar?");
  });

  it("sai pelo número em que o contato escreveu: QR", async () => {
    db.conversation.findMany.mockResolvedValue([conversation({ whatsappProvider: "evolution" })]);
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);

    await scanAndSendFollowUps(NOW);

    expect(provider.sendMessage).toHaveBeenCalledWith("instancia-qr", "5511999999999", "Posso ajudar?");
  });

  it("sem canal registrado, com as duas de pé, vale o QR (o padrão de antes da Meta)", async () => {
    db.conversation.findMany.mockResolvedValue([conversation({ whatsappProvider: null })]);
    db.whatsappInstance.findMany.mockResolvedValue([META, QR]);

    await scanAndSendFollowUps(NOW);

    expect(provider.sendMessage).toHaveBeenCalledWith("instancia-qr", "5511999999999", "Posso ajudar?");
  });

  it("o número do contato fora do ar espera — nunca troca para o outro (seria primeiro contato)", async () => {
    // Contato da Meta, Meta desconectada, QR de pé: mandar pelo QR seria uma
    // mensagem de número desconhecido, que é o que bloqueia o número da clínica.
    db.conversation.findMany.mockResolvedValue([conversation({ whatsappProvider: "meta" })]);
    db.whatsappInstance.findMany.mockResolvedValue([QR, { ...META, status: "disconnected" }]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    // Não consome a etapa: volta a tentar quando a Meta reconectar.
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("e o contrário: contato do QR com o QR fora não vai pela Meta", async () => {
    db.conversation.findMany.mockResolvedValue([conversation({ whatsappProvider: "evolution" })]);
    db.whatsappInstance.findMany.mockResolvedValue([{ ...QR, status: "disconnected" }, META]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it("conta só com a Meta: contato sem canal registrado ainda é atendido por ela", async () => {
    db.conversation.findMany.mockResolvedValue([conversation({ whatsappProvider: null })]);
    db.whatsappInstance.findMany.mockResolvedValue([META]);

    await scanAndSendFollowUps(NOW);

    expect(provider.sendMessage).toHaveBeenCalledWith("phone-meta", "5511999999999", "Posso ajudar?");
  });
});
