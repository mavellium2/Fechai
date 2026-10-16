import type { Metadata } from "next";
import { requireBroadcastAccess } from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import type { ManagedTemplate } from "@/modules/broadcasts/template-draft";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { TemplateManager } from "./TemplateManager";

export const metadata: Metadata = { title: "Modelos de mensagem" };

/**
 * Criar e acompanhar os modelos da Meta sem abrir o Gerenciador do WhatsApp.
 * O guarda do layout de `/disparos` vale aqui; a página repete porque é ela que
 * lê a conexão.
 */
export default async function ModelosPage() {
  const tenantId = await requireBroadcastAccess();
  const connection = await getBroadcastConnection(tenantId);

  let templates: ManagedTemplate[] | null = null;
  let loadError: string | null = null;
  if (connection) {
    try {
      templates = await connection.provider.listManagedTemplates();
    } catch (error) {
      console.error("[modelos] falha ao listar modelos da Meta", error);
      loadError = "Não foi possível consultar os modelos na Meta agora.";
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Disparos · Modelos"
        title="Modelos de mensagem"
        description="Escreva o texto, envie para a Meta aprovar e use nos Disparos e nos lembretes de consulta."
        actions={
          <ButtonLink href="/disparos" variant="outline" size="sm">
            Voltar aos Disparos
          </ButtonLink>
        }
      />
      {connection ? (
        <TemplateManager initialTemplates={templates} initialError={loadError} />
      ) : (
        <Alert tone="warn" title="Conecte seu número pela Meta">
          <p>Os modelos ficam na conta do WhatsApp conectada pela API oficial.</p>
          <ButtonLink href="/integracoes" variant="outline" size="sm" className="mt-3">
            Abrir integrações
          </ButtonLink>
        </Alert>
      )}
    </div>
  );
}
