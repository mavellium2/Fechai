import type { LucideIcon } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Seção da página da campanha que ainda não existe. Diz o que vai morar ali, em
 * uma frase, e mais nada: sem data prometida e sem botão que não faz nada. O
 * fundo tracejado e neutro é "ainda não chegou", e não um erro — por isso é
 * `neutral`, nunca `danger` ou `warn`.
 *
 * `link` é a única exceção a "sem botão": um caminho que existe de verdade
 * (por exemplo, para Disparos), nunca um atalho para o que ainda não foi feito.
 */
export function SectionPlaceholder({
  id,
  title,
  description,
  icon,
  link,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  link?: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-4 p-4 sm:p-6">
      <CardTitle>{title}</CardTitle>
      <div className="rounded-control border border-dashed border-ink/20 bg-ink/[0.02] panel:border-white/20 panel:bg-white/[0.03]">
        <EmptyState icon={icon} title="Em breve" description={description} action={link} className="px-4 py-6 sm:px-6" />
      </div>
    </Card>
  );
}
