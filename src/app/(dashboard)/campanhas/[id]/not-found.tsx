import { Megaphone } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Campanha que não existe — ou que é de outra conta: as duas coisas aparecem
 * igual, de propósito. Dentro do painel (e não a 404 solta do site), com o
 * caminho de volta.
 */
export default function CampaignNotFound() {
  return (
    <div className="w-full space-y-6">
      <h1 className="sr-only">Campanha não encontrada</h1>
      <Card>
        <EmptyState
          icon={Megaphone}
          title="Campanha não encontrada"
          description="O endereço pode estar errado ou a campanha não existe mais. Escolha uma na lista."
          action={<ButtonLink href="/campanhas">Ver campanhas</ButtonLink>}
        />
      </Card>
    </div>
  );
}
