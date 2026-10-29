import { prisma } from "@/lib/prisma";
import type { AdOrigin } from "@/modules/whatsapp/ad-origin";

export type AdOriginVia = "webhook" | "history";

/**
 * Guarda de qual anúncio o lead veio. **Nunca lança**: a origem é informação de
 * relatório, e um erro aqui não pode derrubar o atendimento de quem acabou de
 * escrever.
 *
 * O **primeiro** anúncio vence (`leadId @unique`): quem clica em outro anúncio
 * depois continua contado no primeiro, senão a semana de cada campanha mudaria
 * sozinha. Só uma coisa é completada depois — um registro que chegou sem código
 * (a Meta não manda a saudação) recebe o código se uma mensagem seguinte do
 * **mesmo anúncio** o trouxer.
 *
 * Retorna `created` para a varredura do passado contar o que gravou.
 */
export async function recordLeadAdOrigin(input: {
  tenantId: string;
  leadId: string;
  origin: AdOrigin;
  at: Date;
  via: AdOriginVia;
}): Promise<{ status: "created" | "exists" | "failed" }> {
  const { tenantId, leadId, origin, at, via } = input;
  try {
    const created = await prisma.leadAdOrigin.createMany({
      data: [
        {
          tenantId,
          leadId,
          sourceId: origin.sourceId,
          code: origin.code,
          name: origin.name,
          sourceUrl: origin.sourceUrl,
          platform: origin.platform,
          capturedVia: via,
          firstAdAt: at,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count) return { status: "created" };

    if (origin.code && origin.sourceId) {
      await prisma.leadAdOrigin.updateMany({
        where: { leadId, tenantId, code: null, sourceId: origin.sourceId },
        data: { code: origin.code, name: origin.name },
      });
    }
    return { status: "exists" };
  } catch (err) {
    console.error("[campanhas] origem do anúncio não gravada", leadId, err);
    return { status: "failed" };
  }
}
