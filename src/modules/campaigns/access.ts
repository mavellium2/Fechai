import { requireProductAccess } from "@/lib/require-product";

/**
 * Quem está agindo numa tela ou action de campanhas.
 *
 * `tenantId` e `userId` vêm SEMPRE da sessão: nenhum campo de formulário, id de
 * URL ou argumento de action define de que conta é a campanha. Mesmo padrão de
 * `broadcasts/access.ts` — esconder item de menu ou botão não autoriza nada, e
 * por isso cada action repete esta chamada.
 */
export type CampaignActor = {
  tenantId: string;
  userId: string;
  /** Para a trilha de auditoria e mensagens: e-mail, nome ou, no limite, o id. */
  label: string;
  canEdit: boolean;
};

/**
 * Pode criar, editar, pausar e arquivar campanhas?
 *
 * Este é o ponto ÚNICO da permissão. Hoje não existem papéis dentro da conta
 * (todo usuário que entra no produto é o dono), então quem tem acesso ao
 * produto edita. Quando a SEG-05 criar os papéis, é aqui que "só o dono ou um
 * administrador edita" passa a ser verdade — a tela e as actions já leem
 * `canEdit` e recusam por ele, então nada mais precisa mudar.
 */
function canEditCampaigns(): boolean {
  return true;
}

/** Porteira de toda action e página de campanhas. Repassa o redirect de quem só é afiliado. */
export async function requireCampaignActor(): Promise<CampaignActor> {
  const { session } = await requireProductAccess();
  return {
    tenantId: session.user.tenantId,
    userId: session.user.id,
    label: session.user.email ?? session.user.name ?? session.user.id,
    canEdit: canEditCampaigns(),
  };
}
