/**
 * Cor de ação do produto (`signal` / laranja).
 *
 * Vale para TUDO que convida a um clique: botão, link, aba, ícone de ação,
 * "limpar", "carregar mais", resumo que abre um formulário e interruptor ligado.
 * O laranja precisa de contraste AA nos dois
 * fundos: no painel escuro (`data-surface="dark"`) o signal cheio passa; no
 * fundo `paper` ele é usado como `signal-ink`, derivado dele com `ink`.
 * Não existe cor nova: os dois vêm do mesmo par de tokens de marca.
 *
 * Use `actionText` em texto/ícone, `actionBorder` em contornos e `actionFocus`
 * quando o controle tiver foco próprio (o padrão `ring-iris` continua nos demais).
 * Botões devem usar `variant="action"` — é essa variante que junta os três.
 *
 * Regra completa: docs/plataforma/interface/cores-acao.md.
 */

export const actionText = "text-signal-ink hover:text-signal-ink/80 panel:text-signal panel:hover:text-signal/85";

export const actionBorder = "border border-signal/60 panel:border-signal/60";

export const actionFocus = "focus-visible:ring-signal-ink panel:focus-visible:ring-signal";

/**
 * Botão/link secundário: texto e borda neutros (branco no painel escuro, ink no
 * fundo claro) e laranja **só no ícone**. Assim o clique é reconhecível sem
 * pintar o rótulo de laranja; o CTA preenchido continua sendo o único bloco de
 * cor forte da seção.
 */
export const actionSurface = [
  "text-ink panel:text-white",
  "border border-ink/15 panel:border-white/20",
  actionFocus,
  "bg-transparent enabled:hover:bg-ink/5 panel:enabled:hover:bg-white/10",
  "[&_svg]:text-signal-ink panel:[&_svg]:text-signal",
].join(" ");
