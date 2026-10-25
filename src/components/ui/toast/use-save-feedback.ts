"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { announceLoading, announceResult, type ToastSink } from "./announce";
import { readResult } from "./messages";
import { errorToResult, isFrameworkSignal } from "./save-service";
import { useOptionalToast } from "./toast-provider";
import type { ActionResult, SaveContext, SaveStatus } from "./types";

/*
 * Dois jeitos de ligar um salvamento ao toast, conforme como o formulário envia:
 *
 *  - `useActionToast`  → formulário com `useActionState` (o padrão do produto).
 *  - `useSaveFeedback` → envio imperativo (`fetch`, várias chamadas, botão fora
 *                         de <form>), com try/catch/finally dentro do `run`.
 *
 * Os dois falam com o mesmo `announce*`, então a mensagem é igual nos dois.
 */

/** Sem provider (login, cadastro) o toast simplesmente não existe: a tela mantém o retorno inline. */
const NO_SINK: ToastSink = { show: () => "", dismiss: () => {} };

/**
 * Toast de um formulário `useActionState`:
 *
 * ```tsx
 * const [state, formAction, pending] = useActionState(saveClient, null);
 * useActionToast(state, pending, { entity: "cliente" });
 * ```
 *
 * "Salvando…" aparece enquanto `pending`, e no mesmo lugar vira sucesso ou o
 * erro da categoria certa quando o retorno chega. Cada retorno novo notifica —
 * inclusive o mesmo erro duas vezes seguidas — porque a identidade do objeto
 * muda a cada envio; se a action devolver sempre o mesmo objeto, o fim do
 * `pending` é o que conta.
 */
export function useActionToast(
  state: ActionResult | null | undefined,
  pending: boolean,
  context: SaveContext,
  options: { retry?: () => void } = {},
): SaveStatus {
  const toast = useOptionalToast();
  const id = `save-${useId()}`;

  // Último contexto/retry sem entrar nas dependências: o objeto literal do
  // chamador muda a cada render e faria o efeito disparar de novo.
  const latest = useRef({ context, retry: options.retry });
  useEffect(() => {
    latest.current = { context, retry: options.retry };
  });

  const handled = useRef(state);
  const wasPending = useRef(false);
  const loadingShown = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const { context: ctx, retry } = latest.current;

    if (pending) {
      wasPending.current = true;
      loadingShown.current = true;
      announceLoading(toast, id, ctx);
      return;
    }

    const finishedNow = wasPending.current;
    wasPending.current = false;
    if (!finishedNow && state === handled.current) return;

    handled.current = state;
    loadingShown.current = false;
    // Formulários que zeram o retorno ao editar (`setState(null)`) não podem
    // apagar o toast que já está na tela: qualquer resultado some sozinho em 6 s.
    if (!finishedNow && readResult(state).status === "idle") return;
    announceResult(toast, id, ctx, state, retry);
  }, [pending, state, toast, id]);

  // Formulário desmontado com "Salvando…" na tela (diálogo que fechou): sem isso o spinner ficaria para sempre.
  useEffect(
    () => () => {
      if (loadingShown.current) toast?.dismiss(id);
    },
    [toast, id],
  );

  // Derivado, não guardado: não há segunda fonte de verdade para dessincronizar.
  return pending ? "loading" : readResult(state).status;
}

/**
 * Envio imperativo com estado explícito (`idle | loading | success | error`):
 *
 * ```tsx
 * const save = useSaveFeedback({ entity: "cliente", action: "create" });
 * <Button loading={save.status === "loading"} onClick={() => save.run(() => requestSave("/api/clientes", init))}>
 * ```
 *
 * `run` nunca lança: exceção vira toast de erro (redirects do Next passam
 * intactos), e o `finally` garante que "Salvando…" nunca fica órfão.
 */
export function useSaveFeedback(context: SaveContext) {
  const toast = useOptionalToast();
  const id = `save-${useId()}`;
  const [status, setStatus] = useState<SaveStatus>("idle");
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });
  const inFlight = useRef<Promise<ActionResult> | null>(null);
  // "Tentar novamente" chama o `run` mais recente (a função não pode se referenciar).
  const runRef = useRef<((task: () => Promise<ActionResult | void>) => Promise<ActionResult>) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    (task: () => Promise<ActionResult | void>): Promise<ActionResult> => {
      // Duplo clique: reaproveita o envio em andamento em vez de salvar duas vezes.
      if (inFlight.current) return inFlight.current;

      const sink = toast ?? NO_SINK;
      const ctx = contextRef.current;

      const attempt = async (): Promise<ActionResult> => {
        setStatus("loading");
        announceLoading(sink, id, ctx);
        let result: ActionResult = { ok: false };
        let settled = false;
        try {
          result = (await task()) ?? { ok: true };
          settled = true;
        } catch (error) {
          if (isFrameworkSignal(error)) throw error;
          result = errorToResult(error);
          settled = true;
        } finally {
          inFlight.current = null;
          if (!settled) {
            // Relançou (redirect): a navegação assume; só limpa o aviso.
            sink.dismiss(id);
          }
        }
        const next = announceResult(sink, id, ctx, result, () => void runRef.current?.(task));
        if (mounted.current) setStatus(next);
        return result;
      };

      const promise = attempt();
      inFlight.current = promise;
      return promise;
    },
    [toast, id],
  );

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const reset = useCallback(() => {
    toast?.dismiss(id);
    setStatus("idle");
  }, [toast, id]);

  // Desmontou no meio do envio: tira o "Salvando…"; o resultado ainda vira toast.
  useEffect(
    () => () => {
      if (inFlight.current) toast?.dismiss(id);
    },
    [toast, id],
  );

  return { status, saving: status === "loading", run, reset };
}
