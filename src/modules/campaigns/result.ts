import type { CampaignFieldErrors } from "./schema";

/**
 * Retorno das actions de campanha. É um superconjunto do `{ ok, error, info }`
 * que as demais telas usam, então `useActionToast` e `useSaveFeedback` leem
 * direto (ver `components/ui/toast/TOASTS.md`).
 *
 * `fieldErrors` é separado de `errors` do toast de propósito: `errors` faria o
 * toast dizer "Preencha os campos obrigatórios", e "o fim não pode ser antes do
 * início" não é campo faltando. Aqui o toast usa `error` (a frase) e o
 * formulário usa `fieldErrors` para marcar cada campo.
 */
export type CampaignActionResult = {
  ok: boolean;
  error?: string;
  info?: string;
  /** Campanha criada ou alterada — a tela navega para ela depois de criar. */
  id?: string;
  /** Quando a action sabe a categoria da falha (o toast escolhe o título por ela). */
  code?: "validation" | "forbidden" | "server";
  fieldErrors?: CampaignFieldErrors;
};
