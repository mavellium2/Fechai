import { prisma } from "@/lib/prisma";
import type { ManagedTemplate } from "./template-draft";

/**
 * Guarda quando o modelo foi criado pelo fechai (a Meta não informa).
 * Nunca lança: falhar aqui só deixa o modelo sem data no filtro.
 */
export async function recordTemplateCreated(
  tenantId: string,
  metaTemplateId: string,
  name: string,
): Promise<void> {
  try {
    await prisma.messageTemplateLog.upsert({
      where: { tenantId_metaTemplateId: { tenantId, metaTemplateId } },
      create: { tenantId, metaTemplateId, name },
      update: {},
    });
  } catch (error) {
    console.error("[modelos] falha ao registrar data de criação", error);
  }
}

/** Junta a data de criação conhecida; sem registro, `createdAt` é `null`. */
export async function withCreatedAt(
  tenantId: string,
  templates: ManagedTemplate[],
): Promise<ManagedTemplate[]> {
  try {
    const logs = await prisma.messageTemplateLog.findMany({
      where: { tenantId, metaTemplateId: { in: templates.map((t) => t.id) } },
      select: { metaTemplateId: true, createdAt: true },
    });
    const dates = new Map(logs.map((l) => [l.metaTemplateId, l.createdAt.toISOString()]));
    return templates.map((t) => ({ ...t, createdAt: dates.get(t.id) ?? null }));
  } catch (error) {
    console.error("[modelos] falha ao ler datas de criação", error);
    return templates.map((t) => ({ ...t, createdAt: null }));
  }
}
