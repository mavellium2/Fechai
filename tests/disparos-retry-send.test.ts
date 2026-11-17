import { beforeEach, expect, it, vi } from "vitest";
import type { BroadcastCampaign, BroadcastRecipient } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  send: vi.fn(),
  original: vi.fn(),
  receipt: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  whatsappBlockedNumber: { findUnique: vi.fn(async () => null) },
  conversation: { findFirst: vi.fn(async () => null) },
  broadcastCampaign: { findFirst: vi.fn(async () => ({ status: "queued" })) },
  broadcastReceipt: { findFirst: mocks.receipt },
  broadcastRecipient: { findFirst: mocks.original, update: vi.fn(), updateMany: mocks.update },
} }));
vi.mock("@/modules/broadcasts/connection", () => ({ getBroadcastConnection: mocks.connection }));
vi.mock("@/modules/agent-engine/conversation", () => ({
  getOrCreateConversation: vi.fn(async () => ({ lead: { status: "new" }, conversation: { id: "conversation-a" } })),
}));
vi.mock("@/modules/whatsapp/instances", () => ({ setConversationChannel: vi.fn() }));
import { sendBroadcastRecipient } from "@/modules/broadcasts/send";
import { MetaCloudProvider } from "@/modules/whatsapp/meta";

const campaign = { id: "retry-a", tenantId: "tenant-a", retryOfCampaignId: "original-a", phoneNumberId: "number-a", template: { name: "ola" } } as unknown as BroadcastCampaign;
const recipient = { id: "retry-person", phone: "5511987654321", retryOfRecipientId: "original-person", status: "pending", isTest: false } as BroadcastRecipient;
const original = { status: "sent", deliveryStatus: "failed", whatsappMessageId: "wamid.original" };
const provider = new MetaCloudProvider({ phoneNumberId: "number-a", businessAccountId: "business-a", accessToken: "fake" });
provider.sendBroadcastTemplate = mocks.send;
const connection = { phoneNumberId: "number-a", displayPhone: null, provider };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue(connection);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.receipt.mockResolvedValue(null);
});

it.each(["late-delivery", "late-reply", "inbox-receipt"])("pula o reenvio antes de chamar a Meta quando chega %s", async (scenario) => {
  mocks.original.mockResolvedValue({
    ...original,
    deliveredAt: scenario === "late-delivery" ? new Date() : null,
    repliedAt: scenario === "late-reply" ? new Date() : null,
  });
  if (scenario === "inbox-receipt") mocks.receipt.mockResolvedValue({ id: "receipt-a" });
  await expect(sendBroadcastRecipient(campaign, recipient, connection)).resolves.toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: "retry-person", status: "sending" },
    data: expect.objectContaining({ status: "skipped" }),
  }));
});
