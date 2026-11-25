"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { actionFocus, actionText } from "@/components/ui/action";
import { Input } from "@/components/ui/input";
import { crmBoardHref, type CrmSearchParams } from "@/modules/crm/board-filters";

/**
 * Espera depois da última tecla antes de consultar o banco. Mesmo intervalo da
 * busca de contas e da trilha: uma palavra digitada deixa de ser 6 consultas e
 * passa a ser 1, sem dar a sensação de que o quadro travou.
 */
const DEBOUNCE_MS = 350;

/**
 * Busca do quadro que filtra enquanto se digita. Serve tanto para a barra geral
 * (`q`) quanto para a de cada coluna (`q_<etapa>`): a diferença é só a chave na
 * URL. Toda a navegação passa por `crmBoardHref`, então etapa, responsável,
 * etiqueta, origem, período, datas e as outras buscas seguem intactas.
 *
 * O campo é controlado por state próprio para as teclas aparecerem antes da
 * viagem ao servidor. A URL também muda por fora (limpar, voltar no histórico,
 * link compartilhado); quando isso acontece o valor acompanha. A comparação com
 * a última navegação evita que a resposta da minha própria busca apague letras
 * digitadas enquanto ela vinha.
 */
export function CrmLiveSearch({ params, term, name, label, placeholder, className, inputClassName }: {
  params: CrmSearchParams;
  /** Valor já lido e higienizado no servidor. */
  term: string;
  /** `q` ou `q_<id da etapa>`. */
  name: string;
  label: string;
  placeholder: string;
  className?: string;
  inputClassName?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState(term);
  const [lastTerm, setLastTerm] = useState(term);
  const [lastSent, setLastSent] = useState(term);

  if (term !== lastTerm) {
    setLastTerm(term);
    // Só substitui o que a pessoa digitou se a mudança veio de fora: a minha
    // própria busca já terminou com o texto que ela escreveu.
    if (term !== lastSent) setText(term);
  }

  const href = crmBoardHref(params, { [name]: text.trim() || null });
  const synced = text.trim() === term;

  useEffect(() => {
    if (synced) return;
    const timer = window.setTimeout(() => {
      setLastSent(text.trim());
      router.replace(href);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [href, synced, text, router]);

  const clear = () => {
    setLastSent("");
    setText("");
  };

  return (
    <div role="search" className={`relative min-w-0 ${className ?? ""}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search size={15} aria-hidden className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${actionText}`} />
      {/*
       * `type="text"` é de propósito: `type="search"` faz Chromium/Edge desenharem
       * um x nativo dentro do campo, que aparecia junto do nosso botão de limpar.
       * O wrapper já tem `role="search"` e o rótulo, então a semântica fica; o
       * teclado continua oferecendo a tecla de busca (`inputMode`/`enterKeyHint`).
       */}
      <Input id={id} type="text" inputMode="search" enterKeyHint="search" value={text}
        onChange={(event) => setText(event.target.value)} placeholder={placeholder}
        className={`pl-9 focus-visible:border-signal-ink panel:focus-visible:border-signal ${actionFocus} ${text ? "pr-9" : ""} ${inputClassName ?? ""}`} />
      {text && (
        <button type="button" aria-label={`Limpar: ${label.toLowerCase()}`} title="Limpar busca"
          onClick={clear} className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-control p-1.5 focus-visible:outline-none focus-visible:ring-2 ${actionText} ${actionFocus}`}>
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
