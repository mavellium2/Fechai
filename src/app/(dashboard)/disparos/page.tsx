import type { Metadata } from "next";
import { requireBroadcastAccess } from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import { listBroadcastPage } from "@/modules/broadcasts/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { DisparosClient } from "./DisparosClient";

export const metadata: Metadata = { title: "Disparos" };

export default async function DisparosPage() {
  const tenantId = await requireBroadcastAccess();
  const [connection, campaigns] = await Promise.all([
    getBroadcastConnection(tenantId),
    listBroadcastPage(tenantId),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="WhatsApp · API oficial"
        title="Disparos"
        description="Uma lista de contatos, uma mensagem aprovada e cada envio acompanhado de perto."
        actions={
          <ButtonLink href="/disparos/modelos" variant="outline" size="sm">
            Modelos de mensagem
          </ButtonLink>
        }
      />
      {!connection && (
        <Alert tone="warn" title="Conecte seu número pela Meta">
          <p>
            Para preparar e enviar disparos, configure a API oficial do
            WhatsApp.
          </p>
          <ButtonLink
            href="/integracoes"
            variant="outline"
            size="sm"
            className="mt-3"
          >
            Abrir integrações
          </ButtonLink>
        </Alert>
      )}
      <DisparosClient
        connected={Boolean(connection)}
        displayPhone={connection?.displayPhone ?? null}
        initialCampaigns={campaigns}
      />
    </div>
  );
}
