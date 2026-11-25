import { NextResponse } from "next/server";
import { requireCrmSession, requireEnabledCrmTenant } from "@/modules/crm/access";
import { crmBoardVersion } from "@/modules/crm/board-version";

export async function GET() {
  const session = await requireCrmSession();
  const tenantId = await requireEnabledCrmTenant(session.user.tenantId);
  return NextResponse.json({ version: await crmBoardVersion(tenantId) }, { headers: { "Cache-Control": "private, no-store" } });
}
