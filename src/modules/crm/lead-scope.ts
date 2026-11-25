import type { Prisma } from "@prisma/client";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";

export const activeCrm = { status: "active", crmEnabled: true };

export function realBoardLeads(tenantId: string): Prisma.LeadWhereInput {
  return {
    tenantId, tenant: activeCrm, isTest: false,
    stage: { tenantId, archivedAt: null, pipeline: { key: DEFAULT_PIPELINE_KEY } },
    OR: [{ conversation: null }, { conversation: { is: { tenantId, isTest: false } } }],
  };
}
