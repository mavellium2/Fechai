import { describe, expect, it, vi } from "vitest";

/**
 * URG-01/URG-04 — os eventos de auditoria da regra provisória. Gravados por script
 * (`recordAudit`, que nunca lança); aqui só se confere o catálogo.
 */

vi.mock("@/modules/audit/log", () => ({ recordAudit: vi.fn(), recordChange: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AUDIT_EVENTS, eventLabel, isRevertibleEvent, type AuditEventDef } from "@/modules/audit/events";

describe("eventos da regra provisória da campanha", () => {
  const EVENTS = AUDIT_EVENTS as Record<string, AuditEventDef>;
  const keys = [
    "campaign_override.created",
    "campaign_override.updated",
    "campaign_override.reschedule_list_generated",
    "campaign_override.reminders_cleared",
  ];

  it("existem no grupo de campanhas, com rótulo em português", () => {
    for (const key of keys) {
      expect(EVENTS[key], key).toBeDefined();
      expect(EVENTS[key].group).toBe("campanhas");
      expect(eventLabel(key)).not.toBe(key);
    }
    expect(EVENTS["campaign_override.created"].kind).toBe("create");
    expect(EVENTS["campaign_override.updated"].kind).toBe("update");
  });

  it("nenhum é revertível", () => {
    for (const key of keys) expect(isRevertibleEvent(key), key).toBe(false);
  });
});
