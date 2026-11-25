import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
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
    <div className="w-full min-w-0 space-y-5">
      <PageHeader
        eyebrow="CRM"
        title="Configurar etapas"
        description={pipeline.name}
        actions={<ButtonLink href="/crm" variant="outline"><ArrowLeft size={16} aria-hidden />Voltar ao CRM</ButtonLink>}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="p-4 sm:p-6">
          <CardTitle hint="A ordem aqui é a ordem das colunas no quadro. Etapas de sistema são usadas pela IA e pelos relatórios: dá para renomear e mudar a ordem, não arquivar.">
            Etapas do funil
          </CardTitle>
          <CrmStageList stages={stages} />
        </Card>
        <div className="space-y-5 xl:sticky xl:top-0">
          <Card className="p-4 sm:p-6">
            <CardTitle hint="Entra no fim do funil; depois ajuste a posição com as setas.">Nova etapa</CardTitle>
            <StageNameForm />
          </Card>
          {lossCatalog && <Card className="p-4 sm:p-6">
            <CardTitle>Motivos de perda</CardTitle>
            <CrmLossCatalogForm labels={lossCatalog.options.map(({ label }) => label)} revision={lossCatalog.revision} />
          </Card>}
        </div>
      </div>
    </div>
  );
}
