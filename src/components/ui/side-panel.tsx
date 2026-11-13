"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Painel lateral para editar um item sem sair da lista.
 *
 * Nasceu da tabela de contas do admin, onde cada linha carregava cinco
 * controles sempre visíveis (plano, cota, teste, personificar, suspender). Com
 * dez contas eram cinquenta controles na tela, para um admin que edita uma
 * conta por vez — e cada linha passava de 140px de altura, com a tabela rolando
 * de lado. Aqui a lista volta a ser lista, e a edição ganha um lugar com espaço
 * para rótulo e contexto.
 *
 * `<dialog>` nativo com `showModal()`, mesma escolha do `ConfirmButton`: foco
 * preso, Esc para fechar, `inert` no resto da página e o foco de volta ao
 * gatilho — tudo do navegador, sem lib nem armadilha de foco à mão.
 *
 * O `<dialog>` modal já vem centralizado; as classes de posição o encostam na
 * direita e o esticam na altura toda. Em telas estreitas ele ocupa a largura
 * inteira: um painel de 28rem numa tela de 375px seria um modal disfarçado.
 */
export function SidePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Ações fixas no rodapé, sempre à vista mesmo com o corpo rolado. */
  footer?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  // `showModal()` é imperativo: o React controla `open` e este efeito
  // sincroniza o elemento. Chamar `showModal()` num diálogo já aberto lança,
  // daí a checagem.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // `close` cobre os caminhos que fecham o diálogo de fato — `el.close()` do
      // efeito acima e o fechamento nativo — e mantém o estado de quem chama em
      // dia sozinho.
      onClose={onClose}
      // O Esc é o único caminho em que o navegador fecharia o painel ANTES de
      // quem chama poder recusar (formulário com alteração não salva). Como no
      // `Modal`, o fechamento nativo é impedido e `onClose` decide: quem fecha
      // o painel o faz pondo `open` em falso, e o efeito acima fecha o diálogo.
      // `onClose` ainda é chamado uma segunda vez pelo evento `close` desse
      // fechamento — precisa ser idempotente, como já era com o botão X.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Clique no backdrop fecha: o alvo do clique é o próprio <dialog>
      // (o backdrop é pseudo-elemento dele), nunca o conteúdo interno.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      className={cn(
        "m-0 ml-auto h-dvh max-h-dvh w-full max-w-full border-l p-0 sm:w-[28rem]",
        "border-white/10 bg-ink text-white backdrop:bg-ink/70",
        "open:flex open:flex-col",
      )}
    >
      <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
        <div className="min-w-0">
          <h2 className="font-display truncate text-lg font-semibold">{title}</h2>
          {subtitle && <div className="mt-1 text-sm text-white/55">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar painel"
          className="shrink-0 rounded-control p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      {/* `min-h-0`: sem isso o corpo cresce com o conteúdo e empurra o rodapé
          para fora da tela em vez de rolar. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

      {footer && (
        <footer className="border-t border-white/10 p-5">{footer}</footer>
      )}
    </dialog>
  );
}
