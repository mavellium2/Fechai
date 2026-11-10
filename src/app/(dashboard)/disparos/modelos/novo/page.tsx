import type { Metadata } from "next";
import { requireBroadcastAccess } from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import { removeVariables, templateName, type TemplateCategory } from "@/modules/broadcasts/template-draft";
import { Alert } from "@/components/ui/alert";
import { DisparosNav } from "../../DisparosNav";
import { ConnectMetaCard } from "../../ConnectMetaCard";
import { TemplateEditor, type TemplateEditorInitial } from "../TemplateEditor";

export const metadata: Metadata = { title: "Novo modelo" };

/**
 * `?de=id` abre o editor com o texto de um modelo existente: "Corrigir" um
 * recusado ou "Duplicar" (`&copia=1`). A Meta não edita modelo recusado com o
 * mesmo nome, então a versão nova sempre ganha nome novo.
 */
export default async function NovoModeloPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; copia?: string; sem?: string }>;
}) {
  const tenantId = await requireBroadcastAccess();
  const { de, copia, sem } = await searchParams;
  // "Criar versão sem o nome" (vem do disparo): quais espaços tirar.
  const without = (sem ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 20);
  const connection = await getBroadcastConnection(tenantId);
  const fixing = Boolean(de) && !copia && !without.length;
  const title = !de
    ? "Novo modelo"
    : without.length
      ? "Versão sem o nome"
      : fixing
        ? "Corrigir modelo"
        : "Duplicar modelo";
  if (!connection)
    return (
      <div className="space-y-6">
        <DisparosNav />
        <ConnectMetaCard />
      </div>
    );

  let initial: TemplateEditorInitial | null = null;
  let missing = false;
  if (de) {
    const source = await connection.provider
      .listManagedTemplates()
      .then((all) => all.find((t) => t.id === de))
      .catch(() => undefined);
    if (source) {
      const current = templateName(source.name);
      const version = /_v(\d+)$/.exec(current);
      const base = current.replace(/_v\d+$/, "");
      initial = {
        name: without.length ? `${current}_sem_nome` : `${base}_v${version ? Number(version[1]) + 1 : 2}`,
        category: source.category === "MARKETING" ? "MARKETING" : ("UTILITY" as TemplateCategory),
        header: source.header,
        headerMedia: source.headerMedia,
        body: without.length ? removeVariables(source.body, without) : source.body,
        footer: source.footer,
      };
    } else missing = true;
  }

  return (
    <div className="space-y-6">
      <DisparosNav
        actions={<p className="text-right text-sm font-medium text-white">{title}</p>}
      />
      {missing && (
        <Alert tone="warn">Não encontramos o modelo de origem. Comece um novo abaixo.</Alert>
      )}
      {without.length > 0 && initial && (
        <Alert tone="info">
          Tiramos o nome do texto. Confira se a frase ficou natural antes de enviar: depois de
          aprovada, esta versão vai para quem não tem nome nos seus disparos.
        </Alert>
      )}
      {fixing && initial && (
        <Alert tone="warn">
          A Meta não deixa editar um modelo recusado: ajuste o texto e envie como modelo novo.
        </Alert>
      )}
      <TemplateEditor initial={initial} />
    </div>
  );
}
