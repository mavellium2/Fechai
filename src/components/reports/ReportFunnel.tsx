import { FunnelChart, type FunnelStep } from "@/components/charts/FunnelChart";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";

export function ReportFunnel({ steps, description }: { steps: FunnelStep[]; description: string }) {
  return (
    <Card>
      <CardTitle hint={description} hintInline>Funil dos disparos</CardTitle>
      {steps[0]?.count > 0 && <FunnelChart steps={steps} />}
      <details className="mt-4 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink focus-visible:outline-iris panel:text-white">Ver etapas em tabela</summary>
        <DataTable caption="Contagens e diferença em relação à etapa anterior" head={["Etapa", "Total", "Diferença"]}
          rows={steps.map((step, index) => {
            const previous = steps[index - 1];
            const delta = previous ? step.count - previous.count : null;
            return { id: step.name, cells: [step.name, String(step.count), delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`] };
          })} />
      </details>
    </Card>
  );
}
