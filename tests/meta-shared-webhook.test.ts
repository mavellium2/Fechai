import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  update: vi.fn(),
  process: vi.fn(),
  receipt: vi.fn(),
  outcome: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { whatsappInstance: { findMany: mocks.rows, update: mocks.update } },
}));
vi.mock("@/modules/whatsapp/process-incoming", () => ({
  processIncomingWhatsapp: mocks.process,
}));
vi.mock("@/modules/broadcasts/receipts", () => ({
  receiveBroadcastReceipt: mocks.receipt,
}));
vi.mock("@/modules/broadcasts/outcomes", () => ({
  recordBroadcastResponse: mocks.outcome,
}));
vi.mock("@/modules/scheduling/reminder-dispatch", () => ({
  recordReminderReceipt: vi.fn(),
}));
vi.mock("@/modules/whatsapp/meta-config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/whatsapp/meta-config")>();
  return {
    ...actual,
    getWhatsAppProviderForInstance: () => ({ name: "meta" }),
    readMetaWebhookSecrets: (row: { secret?: string }) => ({
      appSecret: row.secret,
    }),
  };
});
import { GET, POST } from "@/app/api/webhooks/whatsapp/meta/route";

const waba = "913243131777343",
  phone = "1165376309986446",
  otherWaba = "1623216791983296",
  otherPhone = "99999999";
const change = (field: string, phoneId = phone) => ({
  field,
  value: {
    metadata: { phone_number_id: phoneId },
    messages: [
      {
        id: "wamid.in",
        from: "5514999990000",
        type: "text",
        text: { body: "olá" },
      },
    ],
    message_echoes: [
      {
        id: "wamid.manual",
        to: "5514999990000",
        from: "5514998338500",
        type: "text",
        text: { body: "Vou confirmar" },
      },
    ],
  },
});
function request(changes: unknown[], entryId = waba, signature = true) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: entryId, changes }],
  });
  return new Request("https://fechai.test/api/webhooks/whatsapp/meta", {
    method: "POST",
    body,
    headers: signature
      ? {
          "x-hub-signature-256": `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`,
        }
      : {},
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.META_APP_SECRET = "app-secret";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-global";
  mocks.rows.mockImplementation(async ({ where }) =>
    where.metaBusinessAccountId === waba
      ? [
          {
            id: "meta-1",
            tenantId: "clinic",
            status: "connected",
            provider: "meta",
            metaBusinessAccountId: waba,
            metaPhoneNumberId: phone,
            secret: "app-secret",
            metaDisplayPhone: "+55 14 99833-8500",
          },
        ]
      : [],
  );
  mocks.process.mockResolvedValue({ body: { ok: true } });
});
describe("Callback do app parceiro", () => {
  it("valida handshake pelo segredo do servidor sem depender de conexão cadastrada", async () => {
    const response = await GET(
      new Request(
        "https://fechai.test/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=verify-global&hub.challenge=challenge",
      ),
    );
    expect(await response.text()).toBe("challenge");
    expect(
      (
        await GET(
          new Request(
            "https://fechai.test/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=wrong",
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("assinatura inválida não consulta tenants nem processa mensagens", async () => {
    expect(
      (await POST(request([change("messages")], waba, false))).status,
    ).toBe(401);
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("exige WABA e telefone correspondentes, além de liberação e conta ativa", async () => {
    await POST(request([change("messages"), change("messages", otherPhone)]));
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(mocks.rows.mock.calls[0][0].where).toMatchObject({
      metaBusinessAccountId: waba,
      provider: "meta",
      tenant: { metaWhatsappEnabled: true, status: "active" },
    });
    await POST(request([change("messages")], otherWaba));
    expect(mocks.process).toHaveBeenCalledTimes(1);
  });
  it("app diferente não recebe eventos do app parceiro", async () => {
    mocks.rows.mockResolvedValueOnce([
      { tenantId: "clinic", secret: "another-app" },
    ]);
    await POST(request([change("messages")]));
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("eco do celular é mensagem humana para o destinatário e não resposta à campanha", async () => {
    await POST(request([change("smb_message_echoes")]));
    expect(mocks.process).toHaveBeenCalledWith(
      expect.objectContaining({
        isFromMe: true,
        fromPhone: "5514999990000",
        instanceExternalId: phone,
        messageKeyId: "wamid.manual",
      }),
      expect.anything(),
    );
    expect(mocks.outcome).not.toHaveBeenCalled();
  });
  it("histórico/contatos nunca entram no agente, mesmo contendo messages", async () => {
    await POST(request([change("history"), change("smb_app_state_sync")]));
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
  });
  it("remoção desconecta só a Meta e não processa mensagem do mesmo lote", async () => {
    await POST(
      request([
        {
          field: "account_update",
          value: { event: "PARTNER_REMOVED", phone_number: "5514998338500" },
        },
        change("messages"),
      ]),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "meta-1" },
      data: { status: "disconnected" },
    });
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("pedido de remoção de outro número não desconecta esta linha", async () => {
    await POST(
      request([
        {
          field: "account_update",
          value: { event: "PARTNER_REMOVED", phone_number: "5514111111111" },
        },
      ]),
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("falha em um evento pede reentrega e não bloqueia os demais", async () => {
    mocks.process.mockRejectedValueOnce(new Error("temporary"));
    expect(
      (await POST(request([change("messages"), change("smb_message_echoes")])))
        .status,
    ).toBe(500);
    expect(mocks.process).toHaveBeenCalledTimes(2);
  });
});
