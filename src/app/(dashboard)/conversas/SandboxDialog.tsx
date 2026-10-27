"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sandbox } from "./Sandbox";

/**
 * O sandbox saiu do fluxo da página e virou um diálogo acionado pelo cabeçalho.
 *
 * Ele ocupava um card permanente numa tela cujo assunto são conversas reais, e
 * empurrava a lista para cima do dobra. Aqui continua a um clique de distância,
 * sem disputar espaço com o que a pessoa veio ver.
 *
 * `<dialog>` nativo com `showModal()`, como o `ConfirmButton` e o `MobileNav`:
 * foco preso, `Esc`, `inert` no resto da página e devolução do foco ao gatilho.
 *
 * Cada abertura é um CHAT NOVO: o `key={openCount}` remonta o `Sandbox` (tela
 * zerada) e o `DELETE /api/sandbox` arquiva a conversa de teste anterior no
 * servidor (a antiga continua salva na aba "Testes" de /conversas) — sem isso
 * o próximo teste herdava o histórico do anterior no contexto da IA.
 */
export function SandboxDialog({ label = "Testar agente" }: { label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [openCount, setOpenCount] = useState(0);
  const router = useRouter();

  function open() {
    setOpenCount((n) => n + 1);
    ref.current?.showModal();
    // Dispara sem travar a abertura; o envio da primeira mensagem vem bem
    // depois, então a arquivagem já terminou.
    fetch("/api/sandbox", { method: "DELETE" }).catch(() => {});
  }

  // Ao fechar (X ou Esc), a lista de conversas re-renderiza no servidor: o teste
  // recém-criado/arquivado aparece na aba "Testes" sem recarregar a tela.
  function handleClose() {
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={open}>
        <FlaskConical size={14} aria-hidden />
        {label}
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="sandbox-title"
        onClose={handleClose}
        // `m-auto`: o reset do Tailwind zera as margens automáticas que
        // centralizariam o dialog nativo.
        // As cores vêm dos tokens do painel, os mesmos que o `Sandbox` usa por dentro:
        // com fundo `bg-ink` fixo, no tema claro o texto digitado (`--tenant-text`,
        // escuro) ficava escuro sobre escuro e a mensagem sumia.
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-surface border border-(--tenant-line) bg-(--tenant-surface) p-6 text-(--tenant-text) backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="sandbox-title" className="font-display text-lg font-semibold">
              Testar seu agente
            </h2>
            <p className="mt-1 text-sm text-(--tenant-muted)">
              Converse como um cliente conversaria, sem precisar do WhatsApp. O teste não vira
              contato nem entra nos seus números.
            </p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Fechar teste"
            className="shrink-0 rounded-control p-1 text-(--tenant-muted) transition-colors hover:bg-(--tenant-soft) hover:text-(--tenant-text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <Sandbox key={openCount} />
      </dialog>
    </>
  );
}
