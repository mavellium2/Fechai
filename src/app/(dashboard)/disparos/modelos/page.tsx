import type { Metadata } from "next";
import { requireBroadcastAccess } from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import type { ManagedTemplate } from "@/modules/broadcasts/template-draft";
import { withCreatedAt } from "@/modules/broadcasts/template-log";
import { ConnectMetaCard } from "../ConnectMetaCard";
import { TemplateLibrary } from "./TemplateLibrary";
import { DisparosNav } from "../DisparosNav";

export const metadata: Metadata = { title: "Modelos de mensagem" };

/** Lista primeiro: na maioria das visitas a pessoa quer ver se foi aprovado. */
export default async function ModelosPage() {
  const tenantId = await requireBroadcastAccess();
  const connection = await getBroadcastConnection(tenantId);
  if (!connection)
    return (
      <>
        <DisparosNav />
        <ConnectMetaCard />
      </>
    );

  let templates: ManagedTemplate[] | null = null;
  let loadError: string | null = null;
  try {
    templates = await withCreatedAt(tenantId, await connection.provider.listManagedTemplates());
  } catch (error) {
    console.error("[modelos] falha ao listar modelos da Meta", error);
    loadError = "Não foi possível consultar os modelos na Meta agora.";
  }
  return <TemplateLibrary initial={templates} initialError={loadError} />;
}
