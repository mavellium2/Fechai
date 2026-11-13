import { describe, expect, it, vi } from "vitest";

/**
 * CMP-01 — a trilha de auditoria das campanhas. As actions que gravam os
 * eventos estão em `campanha-entidade-actions.test.ts`; aqui só se confere que
 * os eventos existem, no grupo certo, e que nenhum é revertível: o card pede
 * auditoria de criar, editar e mudar o status, não desfazer.
 */

vi.mock("@/modules/audit/log", () => ({ recordAudit: vi.fn(), recordChange: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { AUDIT_EVENTS, eventLabel, isRevertibleEvent, type AuditEventDef } from "@/modules/audit/events";
import { isRevertibleTarget } from "@/modules/audit/revert";

describe("trilha de auditoria das campanhas", () => {
  const EVENTS = AUDIT_EVENTS as Record<string, AuditEventDef>;

  it("os seis eventos existem, no grupo de campanhas, com rótulo em português", () => {
    for (const key of ["created", "updated", "paused", "resumed", "archived", "unarchived"]) {
      const def = EVENTS[`campaign.${key}`];
      expect(def, key).toBeDefined();
      expect(def.group).toBe("campanhas");
      expect(eventLabel(`campaign.${key}`)).not.toBe(`campaign.${key}`);
    }
  });

  it("nenhum evento de campanha é revertível", () => {
    for (const key of Object.keys(EVENTS).filter((event) => event.startsWith("campaign."))) {
      expect(isRevertibleEvent(key), key).toBe(false);
    }
    expect(isRevertibleTarget("Campaign")).toBe(false);
  });
});
