import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto da página da campanha: voltar, título com selo, abas das seções e três cartões. */
export default function CampanhaLoading() {
  return (
    <div role="status" aria-label="Carregando a campanha" className="w-full space-y-6">
      <Skeleton className="h-5 w-44" />

      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-8 w-72 max-w-full" />
        <div className="mt-3 flex gap-3">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-40" />
        </div>
      </div>

      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-28 shrink-0 rounded-full" />
        ))}
      </div>

      <div className="space-y-6">
        <Card className="space-y-3 p-4 sm:p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-surface" />
        ))}
      </div>
    </div>
  );
}
