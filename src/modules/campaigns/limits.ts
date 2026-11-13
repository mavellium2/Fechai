/**
 * Limites do formulário de campanha, num arquivo sem dependência de propósito:
 * a tela (componente de cliente) mostra o contador e o `maxLength` com estes
 * números, e importar `schema.ts` para isso levaria o zod inteiro para o
 * navegador. O servidor valida com os mesmos valores em `schema.ts`.
 */
export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const OBJECTIVE_MAX = 280;
