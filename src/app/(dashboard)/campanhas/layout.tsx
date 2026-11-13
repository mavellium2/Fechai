import { requireProductAccess } from "@/lib/require-product";

/**
 * Porteira do produto: quem entrou só como afiliado não tem campanhas e é
 * levado ao painel de afiliado. Fica num layout, e não em cada page, para valer
 * também para `/campanhas/[id]`. (Cada action repete o guarda: layout não
 * autoriza uma mutação.)
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireProductAccess();
  return <>{children}</>;
}
