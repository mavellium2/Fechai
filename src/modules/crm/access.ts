import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { requireProductAccess } from "@/lib/require-product";
import { DEFAULT_PIPELINE_KEY } from "./pipeline";

/** Sessão de quem pode usar o CRM (`crm:ver`). Base de telas, rota de pulso e actions. */
export async function requireCrmSession() {
  const { session } = await requireProductAccess();
  if (!hasPermission(session.user.role, "crm:ver")) notFound();
  return session;
}

/** A navegação pode estar desatualizada. Verifique o acesso na leitura. */
export const requireCrmAccess = cache(async () => {
  const session = await requireCrmSession();
  return requireEnabledCrmTenant(session.user.tenantId);
});

export async function requireEnabledCrmTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true, crmEnabled: true },
  });
  if (!tenant?.crmEnabled || tenant.status !== "active") notFound();
  return tenant.id;
}

export async function getCrmOverview() {
  const tenantId = await requireCrmAccess();
  const pipeline = await prisma.pipeline.findUnique({
    where: {
      tenantId_key: { tenantId, key: DEFAULT_PIPELINE_KEY },
      tenant: { status: "active", crmEnabled: true },
    },
    select: {
      name: true,
      stages: {
        where: { tenantId, archivedAt: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          _count: {
            select: {
              leads: {
                where: {
                  tenantId,
                  isTest: false,
                  OR: [
                    { conversation: { is: null } },
                    { conversation: { is: { tenantId, isTest: false } } },
                  ],
                },
              },
            },
          },
        },
      },
    },
  });
  if (!pipeline) notFound();
  return pipeline;
}
