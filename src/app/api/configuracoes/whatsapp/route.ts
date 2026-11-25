import { NextResponse } from "next/server";
import { requireProductAccess } from "@/lib/require-product";
import { getTeamWhatsapp } from "@/modules/crm/team-whatsapp";

/**
 * Situação do WhatsApp da própria pessoa, para a tela de Configurações saber
 * quando o `#vincular` chegou sem recarregar a página a cada volta. Devolve só
 * a situação, nunca o número.
 */
export async function GET() {
  const { session } = await requireProductAccess();
  const current = await getTeamWhatsapp(session.user.tenantId, session.user.id);
  const status = current.pendingPhone ? "pending" : current.verifiedAt ? "verified" : "none";
  return NextResponse.json(
    { status, verifiedAt: current.verifiedAt?.toISOString() ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
