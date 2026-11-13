import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto da lista no formato da página pronta (cabeçalho, abas e cinco
 * linhas), para a tela não "pular" quando os dados chegam. As abas ficam em
 * uma linha só, como na página.
 */
export default function CampanhasLoading() {
  return (
    <div role="status" aria-label="Carregando as campanhas" className="w-full space-y-6">
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>

      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>

      <Card className="space-y-3 p-4 md:p-6">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </Card>
    </div>
  );
}
