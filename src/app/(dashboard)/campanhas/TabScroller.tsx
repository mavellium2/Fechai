/**
 * Envoltório das fileiras de pílulas (`FilterTabs`) de campanhas. No celular a
 * fileira rola na horizontal em vez de quebrar em duas linhas; a partir de
 * `sm` volta a ser uma fileira comum.
 *
 * O respiro de 4 px (`px-1 py-1`) é do anel de foco — o `overflow` corta o que
 * é desenhado para fora da caixa. A margem negativa fica só nas laterais
 * (`-mx-1`): no eixo vertical ela comeria o espaçamento entre as seções, que é
 * justamente o que a página usa para respirar.
 */
export function TabScroller({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 overflow-x-auto px-1 py-1 sm:overflow-visible">{children}</div>;
}

/** As classes que o `FilterTabs` precisa dentro do `TabScroller`: sem quebra, e pílulas de altura de toque no celular. */
export const TAB_ROW_CLASS = "flex-nowrap sm:flex-wrap";
export const TAB_ITEM_CLASS = "shrink-0 whitespace-nowrap max-sm:py-3";
