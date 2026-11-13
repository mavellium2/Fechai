import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ campaignList: vi.fn(), campaignDetail: vi.fn(), appointments: vi.fn(), leads: vi.fn(), trackedSince: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  broadcastCampaign: { findMany: mocks.campaignList, findFirst: mocks.campaignDetail },
  appointment: { findMany: mocks.appointments },
  lead: { findMany: mocks.leads },
  leadAdOrigin: { aggregate: mocks.trackedSince },
} }));

import { getBroadcastSummary } from "@/modules/broadcasts/queries";
import { loadCampaignReport } from "@/modules/campaign-reports/queries";
import { loadBroadcastCampaignReport, sumBroadcastCampaigns } from "@/modules/reports/broadcast-campaigns";
import { resolveRange } from "@/modules/reports/service";

const day = new Date("2026-11-08T12:00:00Z");

beforeEach(() => vi.resetAllMocks());

describe("relatório de disparos", () => {
  it("compartilha as contagens do detalhe e lê só a conta, disparos confirmados e destinatários reais", async () => {
    const recipient = { status: "sent", deliveryStatus: "read", repliedAt: day, qualifiedAt: day, appointmentId: "a1" };
    const campaign = { id: "c1", name: "Novembro", recipients: [recipient], confirmedAt: day,
      createdAt: day, nextAttemptAt: day, scheduledAt: null, finishedAt: null, template: null };
    mocks.campaignList.mockResolvedValueOnce([campaign]).mockResolvedValueOnce([]);
    mocks.campaignDetail.mockResolvedValue(campaign);
    mocks.appointments.mockResolvedValue([{ id: "a1", status: "scheduled", attendance: "attended" }]);
    const range = resolveRange("7", "2026-11-07", "2026-11-13");

    const report = await loadBroadcastCampaignReport("tenant-a", range);
    const detail = await getBroadcastSummary("tenant-a", "c1");

    expect(report.previous).toEqual([]);
    expect(mocks.campaignList).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { tenantId: "tenant-a", confirmedAt: { gte: range.from, lte: range.to } },
      select: expect.objectContaining({ recipients: expect.objectContaining({ where: { isTest: false } }) }),
    }));
    expect(mocks.appointments).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-a", id: { in: ["a1"] }, status: { not: "canceled" } },
    }));
    const counts = sumBroadcastCampaigns(report.current);
    expect(counts).toMatchObject({ sent: 1, delivered: 1, read: 1, replies: 1, opportunities: 1, appointments: 1, attended: 1 });
    expect(detail).toMatchObject(counts);
  });

  it("mede presença uma vez por lead e usa o primeiro agendamento válido para a mediana por anúncio", async () => {
    const lead = { createdAt: day, status: "scheduled", disqualifiedAt: null, disqualifiedReason: null, conversation: null,
      adOrigin: { code: "AD10", name: "Implantes", sourceId: null } };
    const appointment = (minutes: number, status: string, attendance: string) => ({
      createdAt: new Date(day.getTime() + minutes * 60_000), status, attendance,
    });
    mocks.leads.mockResolvedValue([
      { ...lead, id: "lead-1", appointments: [appointment(5, "canceled", "unknown"), appointment(20, "scheduled", "attended"), appointment(60, "done", "unknown")] },
      { ...lead, id: "lead-2", appointments: [appointment(40, "scheduled", "unknown")] },
    ]);
    mocks.trackedSince.mockResolvedValue({ _min: { firstAdAt: day } });

    const report = await loadCampaignReport("tenant-a", { from: day, to: new Date("2026-11-13") }, { appointmentDetails: true });

    expect(report.current.adScheduled).toBe(2);
    expect(report.adResults?.groups.get("AD10")).toEqual({ attended: 1, medianMinutes: 30 });
    expect(report.adResults?.total).toEqual({ attended: 1, medianMinutes: 30 });
  });
});
