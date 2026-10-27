import { requireProductAccess } from "@/lib/require-product";
import "./agents-workspace.css";
import "./agents-v7.css";

/**
 * Porteira do produto: quem entrou só como afiliado não tem essas telas e é
 * levado ao painel de afiliado. Fica num layout, e não em cada page, para
 * valer também para as rotas filhas (ex.: /agentes/[id]).
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireProductAccess();
  return <>{children}</>;
}
