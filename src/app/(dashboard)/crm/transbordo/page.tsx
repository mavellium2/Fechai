import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireCrmAccess } from "@/modules/crm/access";
import { loadBusinessCalendar, readHandoffSla } from "@/modules/crm/handoff-sla";
import { AUTO_RETURN_SUGGESTED_HOURS, parseAutoReturn } from "@/modules/crm/handoff-auto-return";
import { prisma } from "@/lib/prisma";
import { SlaForm } from "./SlaForm";

export const metadata: Metadata = { title: "Prazos do transbordo" };

export default async function HandoffDeadlinesPage() {
  const tenantId = await requireCrmAccess();
  const [sla, calendar, row] = await Promise.all([
    readHandoffSla(tenantId),
    loadBusinessCalendar(tenantId),
    prisma.handoffSlaSettings.findUnique({ where: { tenantId }, select: { autoReturnHours: true, autoReturnBusinessHoursOnly: true, autoReturnHumanStage: true } }),
  ]);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        eyebrow="CRM"
        title="Prazos do transbordo"
        description="Quanto tempo um lead pode esperar alguém da equipe antes de o Fechai avisar de novo ou devolver para a IA."
        actions={<ButtonLink href="/crm" variant="outline"><ArrowLeft size={16} aria-hidden />Voltar ao CRM</ButtonLink>}
      />
      <Card className="p-4 sm:p-5">
        <SlaForm sla={sla} autoReturn={parseAutoReturn(row)} suggestedHours={AUTO_RETURN_SUGGESTED_HOURS} hasSchedule={Boolean(calendar)} />
      </Card>
    </div>
  );
}
