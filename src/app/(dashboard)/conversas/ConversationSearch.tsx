"use client";

import { useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Busca por nome ou telefone dentro da lista.
 *
 * A lista cortava em 50 conversas sem avisar e não havia como procurar ninguém —
 * a partir da 51ª, o cliente simplesmente não existia na tela.
 *
 * Recebe `status`/`q` por prop em vez de ler `useSearchParams()`: o valor já foi
 * lido no servidor, e assim o componente não exige um limite de Suspense.
 */
export function ConversationSearch({ status, q, agentId = "" }: { status: string; q: string; agentId?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();

  function go(term: string) {
    const params = new URLSearchParams({ status });
    if (term) params.set("q", term);
    if (agentId) params.set("agent", agentId);
    router.push(`/conversas?${params}`);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(ref.current?.value.trim() ?? "");
      }}
      className="relative"
    >
      <label htmlFor={id} className="sr-only">
        Buscar conversa por nome ou telefone
      </label>
      <Search
        size={15}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
      />
      <Input
        id={id}
        ref={ref}
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Buscar nome ou telefone"
        autoComplete="off"
        className="pl-9 pr-9"
      />
      {q && (
        <button
          type="button"
          onClick={() => {
            if (ref.current) ref.current.value = "";
            go("");
          }}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </form>
  );
}
