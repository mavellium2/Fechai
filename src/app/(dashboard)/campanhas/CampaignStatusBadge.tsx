import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CampaignStatus } from "@/modules/campaigns/status";
import { STATUS_ICON, STATUS_LABEL, STATUS_TONE } from "./labels";

/**
 * Situação da campanha: ícone + texto sobre o `Badge` do produto — nunca só
 * cor. O texto fica em `ink` (e `white` no painel escuro) em vez da cor do
 * tom: o verde e o âmbar do `Badge` sobre o próprio fundo claro ficam abaixo de
 * 4,5:1 de contraste, e aqui a cor do estado já está no fundo da pílula.
 */
export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge
      tone={STATUS_TONE[status]}
      icon={<Icon size={12} />}
      className={cn("text-ink panel:text-white", className)}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
