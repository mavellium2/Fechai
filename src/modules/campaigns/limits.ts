/**
 * Limites do formulário de campanha, num arquivo sem dependência de propósito:
 * a tela (componente de cliente) mostra o contador e o `maxLength` com estes
 * números, e importar `schema.ts` para isso levaria o zod inteiro para o
 * navegador. O servidor valida com os mesmos valores em `schema.ts`.
 */
export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const OBJECTIVE_MAX = 280;
export const DESCRIPTION_MAX = 2000;
export const KEYWORDS_MAX = 10;
export const KEYWORD_MAX = 40;
export const GOAL_MAX = 100_000;
/** R$ 10 milhões, em centavos. */
export const BUDGET_MAX_CENTS = 1_000_000_000;

export const OBJECTIVE_TYPES = ["agendamento", "reativacao", "evento", "promocao", "outro"] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];
export const OBJECTIVE_TYPE_LABEL: Record<ObjectiveType, string> = {
  agendamento: "Agendamento",
  reativacao: "Reativação",
  evento: "Evento",
  promocao: "Promoção",
  outro: "Outro",
};

export const GOAL_TYPES = ["leads", "agendamentos", "comparecimentos"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  leads: "leads",
  agendamentos: "agendamentos",
  comparecimentos: "comparecimentos",
};
