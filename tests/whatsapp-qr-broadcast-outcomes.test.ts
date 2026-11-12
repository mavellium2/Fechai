import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "@/modules/whatsapp/provider";

const mocks = vi.hoisted(() => ({
  incoming: null as IncomingMessage | null,
  instance: vi.fn(), process: vi.fn(), outcome: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsappInstance: { findFirst: mocks.instance } } }));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: () => ({ name: "evolution", parseWebhook: () => mocks.incoming }),
}));
vi.mock("@/modules/whatsapp/process-incoming", () => ({ processIncomingWhatsapp: mocks.process }));
vi.mock("@/modules/broadcasts/outcomes", () => ({ recordBroadcastResponse: mocks.outcome }));
vi.mock("@/modules/scheduling/reminder-dispatch", () => ({ recordReminderReceipt: vi.fn() }));

import { POST } from "@/app/api/webhooks/whatsapp/route";

const at = new Date("2026-11-11T15:00:00Z");
const request = (secret = "secret") => new Request("https://fechai.test/api/webhooks/whatsapp", {
  method: "POST", body: "{}", headers: { "x-webhook-secret": secret },
});
beforeEach(() => {
  vi.resetAllMocks();
  process.env.WHATSAPP_WEBHOOK_SECRET = "secret";
  mocks.incoming = {
    instanceExternalId: "qr-1", fromPhone: "5511999999999", text: "Quero agendar",
    hasAudio: false, isGroup: false, messageKeyId: "qr-reply", occurredAt: at,
  };
  mocks.instance.mockResolvedValue({ tenantId: "tenant-1" });
  mocks.process.mockResolvedValue({ body: { ok: true, silent: "human_handling" } });
});

describe("Resultados dos Disparos com atendimento somente pelo QR", () => {
  it("atribui a resposta após registrar a mensagem, inclusive com agente pausado", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.instance).toHaveBeenCalledWith({
      where: { externalId: "qr-1", provider: "evolution" }, select: { tenantId: true },
    });
    expect(mocks.outcome).toHaveBeenCalledWith("tenant-1", "5511999999999", "qr-reply", at);
    expect(mocks.process.mock.invocationCallOrder[0]).toBeLessThan(mocks.outcome.mock.invocationCallOrder[0]);
  });

  it.each([{ isFromMe: true }, { isReaction: true }, { isGroup: true }, { messageKeyId: undefined }])(
    "não atribui saída, reação, grupo ou evento sem id: %j", async (event) => {
      mocks.incoming = { ...mocks.incoming!, ...event };
      await POST(request());
      expect(mocks.outcome).not.toHaveBeenCalled();
    },
  );

  it("não atribui mensagem que falhou no processamento", async () => {
    mocks.process.mockResolvedValue({ body: { error: "falha" }, status: 500 });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.outcome).not.toHaveBeenCalled();
  });

  it("assinatura inválida não processa nem atribui", async () => {
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
  });
});
