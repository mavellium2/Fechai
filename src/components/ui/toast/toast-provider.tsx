"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastViewport } from "./toast-viewport";
import type { Toast, ToastInput, ToastKind } from "./types";

/**
 * Duração padrão por tipo. Todo retorno que já terminou some sozinho em 6 s, com
 * uma barra na base mostrando o tempo que falta. "Carregando" não tem prazo: fica
 * até o resultado chegar. Erro some também — quem precisa ler com calma passa o
 * mouse ou põe o foco no aviso, e a contagem pausa.
 */
export const DEFAULT_DURATION: Record<ToastKind, number | null> = {
  loading: null,
  success: 6000,
  info: 6000,
  warning: 6000,
  error: 6000,
};

/** No máximo isto na tela; o mais antigo sai. Evita uma pilha que cobre a página. */
const MAX_VISIBLE = 3;

type Shorthand = (title: string, options?: Omit<ToastInput, "kind" | "title">) => string;

export type ToastApi = {
  /** Mostra (ou atualiza, se o `id` já existe) e devolve o id. */
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  loading: Shorthand;
  success: Shorthand;
  warning: Shorthand;
  error: Shorthand;
  info: Shorthand;
};

/*
 * O contexto carrega só a API, que é estável (memoizada uma vez). A lista de
 * toasts vai por props ao viewport, dentro do próprio provider: quem dispara
 * notificações — todo formulário — NÃO re-renderiza quando uma entra ou sai.
 */
const ApiContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const show = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = input.id ?? `toast-${counter.current}`;
    const next: Omit<Toast, "revision"> = {
      ...input,
      id,
      duration: input.duration === undefined ? DEFAULT_DURATION[input.kind] : input.duration,
    };
    setToasts((current) => {
      const existing = current.find((toast) => toast.id === id);
      // Mesmo id: troca no lugar (mesma posição na pilha) e sobe a revisão.
      if (existing) {
        return current.map((toast) => (toast.id === id ? { ...next, revision: existing.revision + 1 } : toast));
      }
      return [...current, { ...next, revision: 0 }].slice(-MAX_VISIBLE);
    });
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => setToasts([]), []);

  const api = useMemo<ToastApi>(() => {
    const shorthand = (kind: ToastKind): Shorthand => (title, options) => show({ ...options, kind, title });
    return {
      show,
      dismiss,
      dismissAll,
      loading: shorthand("loading"),
      success: shorthand("success"),
      warning: shorthand("warning"),
      error: shorthand("error"),
      info: shorthand("info"),
    };
  }, [show, dismiss, dismissAll]);

  return (
    <ApiContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ApiContext.Provider>
  );
}

/**
 * API de notificações. Fora de um `ToastProvider` (páginas de login e
 * cadastro, que têm o próprio retorno inline) devolve `null` em vez de lançar:
 * um formulário compartilhado não pode quebrar por estar numa tela sem toast.
 */
export function useOptionalToast(): ToastApi | null {
  return useContext(ApiContext);
}

export function useToast(): ToastApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  return api;
}
