import { requireTenant } from "@/lib/session";
import { requireProductAccess } from "@/lib/require-product";
import { prisma } from "@/lib/prisma";
import { buildCampaignDocument } from "@/modules/campaign-reports/document";
import { getCampaignSettings } from "@/modules/campaign-reports/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O PDF do relatório semanal de campanhas **exatamente como vai ao WhatsApp**:
 * a mesma montagem do envio (`buildCampaignDocument`), da última semana fechada.
 * É a prévia da aba Campanhas (`?baixar=1` entrega como arquivo). Só agregados,
 * da conta de quem está logado; nunca nome, telefone ou texto de conversa.
 *
 * O painel manda `X-Frame-Options: DENY` em tudo; esta rota é a exceção
 * (`next.config.ts`), só para o próprio site, para a prévia caber na página.
 */
export async function GET(request: Request) {
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (tenant?.status !== "active") return new Response("Conta indisponível.", { status: 403 });

  const settings = await getCampaignSettings(tenantId);
  const document = await buildCampaignDocument(tenantId, settings.timezone);
  if (!document) return new Response("Ainda não há anúncio registrado nesta conta.", { status: 404 });
  if (!document.pdf) return new Response("Não foi possível gerar o PDF agora.", { status: 500 });

  const download = new URL(request.url).searchParams.get("baixar") === "1";
  return new Response(Buffer.from(document.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${document.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
