import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCrmOverview, requireCrmAccess } from "@/modules/crm/access";
import { readCrmLossCatalog } from "@/modules/crm/loss-reasons";
import { CrmLossCatalogForm, CrmStageList, StageNameForm } from "./StageForms";

export const metadata: Metadata = { title: "Etapas do CRM" };

export default async function CrmStagesPage() {
  const tenantId = await requireCrmAccess();
  const [pipeline, lossCatalog] = await Promise.all([getCrmOverview(), readCrmLossCatalog(tenantId)]);
  const stages = pipeline.stages.map((stage) => ({
    id: stage.id, name: stage.name, system: stage.kind !== null, acceptsArchive: stage.kind !== "lost", leadCount: stage._count.leads,
  }));

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        eyebrow="CRM"
        title="Configurar etapas"
        description={pipeline.name}
        actions={<ButtonLink href="/crm" variant="outline"><ArrowLeft size={16} aria-hidden />Voltar ao CRM</ButtonLink>}
      />
      <Card className="p-4 sm:p-5">
        <StageNameForm />
      </Card>
      <CrmStageList stages={stages} />
      {lossCatalog && <Card className="p-4 sm:p-5">
        <CrmLossCatalogForm labels={lossCatalog.options.map(({ label }) => label)} revision={lossCatalog.revision} />
      </Card>}
    </div>
  );
}
