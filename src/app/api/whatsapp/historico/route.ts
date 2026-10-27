import { NextResponse } from "next/server";
import { requireProductAccess } from "@/lib/require-product";
import { requireSuperadmin, requireTenant } from "@/lib/session";
import { readHistoryRecovery, recoveryConnection } from "@/modules/whatsapp/history-recovery";

export async function GET() {
  await requireSuperadmin();
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  try {
    await recoveryConnection(tenantId);
    return NextResponse.json({ run: await readHistoryRecovery(tenantId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar a recuperação desta conta." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
