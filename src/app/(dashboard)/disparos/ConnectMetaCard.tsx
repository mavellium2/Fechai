import { MessageCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Sem a API oficial não há disparo: uma ação só, em vez de um formulário cinza. */
export function ConnectMetaCard() {
  return (
    <Card>
      <EmptyState
        icon={MessageCircle}
        title="Conecte o WhatsApp oficial para fazer disparos"
        description="Disparos saem pela API oficial da Meta, com mensagens aprovadas. O QR Code continua funcionando ao mesmo tempo para o atendimento."
        action={
          <ButtonLink href="/integracoes" variant="cta">
            Conectar WhatsApp oficial
          </ButtonLink>
        }
      />
    </Card>
  );
}
