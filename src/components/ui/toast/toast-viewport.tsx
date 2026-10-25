"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingDots } from "../loading-dots";
import type { Toast, ToastKind } from "./types";

/**
 * Visual das notificações: pilha fixa no topo, centralizada.
 *
 * O estado e as regras moram no `ToastProvider`; aqui só desenho e tempo de
 * tela. Cada tipo tem cor, ícone e papel ARIA próprios — dá para distinguir
 * sucesso, erro e carregamento sem ler o texto, e sem depender só da cor.
 */

const TONES: Record<
  ToastKind,
  {
    icon: typeof Check;
    chip: string;
    border: string;
    bar: string;
    role: "status" | "alert";
    live: "polite" | "assertive";
  }
> = {
  // Ícone escuro sobre verde/âmbar e claro sobre íris/vermelho: contraste ≥ 3:1 nos quatro.
  loading: { icon: Check, chip: "bg-iris text-white", border: "border-iris/60", bar: "bg-iris", role: "status", live: "polite" },
  success: { icon: Check, chip: "bg-success text-ink", border: "border-success/60", bar: "bg-success", role: "status", live: "polite" },
  info: { icon: Info, chip: "bg-iris text-white", border: "border-iris/60", bar: "bg-iris", role: "status", live: "polite" },
  warning: { icon: TriangleAlert, chip: "bg-warn text-ink", border: "border-warn/70", bar: "bg-warn", role: "alert", live: "assertive" },
  error: { icon: CircleAlert, chip: "bg-danger text-white", border: "border-danger/70", bar: "bg-danger", role: "alert", live: "assertive" },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const { icon: Icon, chip, border, bar, role, live } = TONES[toast.kind];
  // Quanto ainda falta. Pausar guarda o restante em vez de recomeçar do zero:
  // quem tira o mouse de cima do aviso ganha só o tempo que faltava.
  const remaining = useRef(toast.duration ?? 0);

  // Atualizar no lugar (mesmo id) recomeça a contagem inteira.
  useEffect(() => {
    remaining.current = toast.duration ?? 0;
  }, [toast.revision, toast.duration]);

  // Timer de sumir sozinho. Vive no item: sai junto com ele (sem timer órfão) e
  // para enquanto o mouse ou o foco estão sobre ele — quem está lendo (ou
  // clicando "Tentar novamente") não perde a mensagem no meio. A barra da base
  // pausa pelo mesmo `paused`, então as duas contagens andam juntas.
  useEffect(() => {
    if (toast.duration == null || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [toast.duration, toast.revision, toast.id, paused, onDismiss]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onDismiss(toast.id);
    }
  }

  return (
    <motion.li
      layout={!reduced}
      initial={{ opacity: 0, y: reduced ? 0 : -16, scale: reduced ? 1 : 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : -8, transition: { duration: 0.15, ease: "easeIn" } }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={onKeyDown}
      className={cn(
        "pointer-events-auto relative w-full list-none overflow-hidden rounded-surface border bg-white text-ink shadow-lg",
        "panel:bg-[color-mix(in_srgb,var(--color-ink),white_9%)] panel:text-white",
        border,
      )}
    >
      {/*
        A região viva é remontada a cada revisão (`key`): trocar "Salvando…" por
        "Salvo!" no mesmo elemento nem sempre é anunciado, remontar é.
      */}
      <div
        key={toast.revision}
        role={role}
        aria-live={live}
        aria-atomic="true"
        className="flex items-start gap-3 p-3 pr-2"
      >
        <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", chip)} aria-hidden>
          {toast.kind === "loading" ? (
            <LoadingDots size={3} label={null} />
          ) : (
            <Icon size={14} strokeWidth={3} className="ttc-pop" />
          )}
        </span>

        <div className="min-w-0 flex-1 py-0.5">
          <p className="break-words text-sm font-medium leading-snug">{toast.title}</p>
          {toast.description && (
            <p className="mt-1 break-words text-sm leading-snug text-ink/70 panel:text-white/70">{toast.description}</p>
          )}
          {toast.action && <ToastActionButton toast={toast} onDismiss={onDismiss} />}
        </div>

        {toast.kind !== "loading" && (
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Fechar notificação"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink/60 transition-colors",
              "hover:bg-ink/5 hover:text-ink panel:text-white/60 panel:hover:bg-white/10 panel:hover:text-white",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
            )}
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {/*
        Tempo que falta, na base do cartão. A animação é CSS (linear, da largura
        cheia a zero) e pausa com o mesmo `paused` do timer. A `key` tem prefixo
        porque é irmã da região viva (que usa a revisão como chave): chave repetida
        entre irmãos faz o React duplicar ou omitir filhos. Atualizar no lugar
        reinicia a barra junto com a contagem.
      */}
      {toast.duration != null && (
        <span
          key={`bar-${toast.revision}`}
          aria-hidden
          className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[3px] origin-left opacity-80", bar)}
          style={{
            animation: `toast-countdown ${toast.duration}ms linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      )}
    </motion.li>
  );
}

function ToastActionButton({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const action = toast.action;
  if (!action) return null;
  const className = cn(
    "mt-2 inline-flex h-8 items-center rounded-control border border-ink/15 px-3 text-xs font-medium transition-colors",
    "hover:bg-ink/5 panel:border-white/20 panel:hover:bg-white/10",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
  );
  if (action.href) {
    return (
      <a href={action.href} className={className}>
        {action.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        action.onClick?.();
        onDismiss(toast.id);
      }}
    >
      {action.label}
    </button>
  );
}

export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const count = useRef(toasts.length);

  // Popover manual = camada superior do navegador. É o que deixa a notificação
  // aparecer POR CIMA de um `<dialog>` aberto com `showModal()` (a maior parte
  // dos formulários do produto vive em um): nenhum z-index vence a camada
  // superior. Reabrir a cada mudança recoloca o aviso acima de um diálogo que
  // tenha aberto depois dele. Sem suporte a popover, o `fixed` abaixo basta.
  useEffect(() => {
    count.current = toasts.length;
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function" || toasts.length === 0) return;
    if (el.matches(":popover-open")) {
      // Fechar com o foco dentro o devolveria ao gatilho: quem navega por teclado
      // até "Fechar" não pode perder o lugar quando outro aviso chega.
      if (el.contains(document.activeElement)) return;
      el.hidePopover();
    }
    el.showPopover();
  }, [toasts]);

  // Só fecha a camada depois da animação de saída do último toast (o callback
  // dispara a cada saída concluída, também quando ainda sobram outros).
  const onExitComplete = useCallback(() => {
    const el = ref.current;
    if (count.current === 0 && el && typeof el.hidePopover === "function" && el.matches(":popover-open")) el.hidePopover();
  }, []);

  return (
    <div
      ref={ref}
      popover="manual"
      role="region"
      aria-label="Notificações"
      // O UA dá ao popover `inset: 0`, borda, fundo e `overflow: auto`: tudo zerado
      // para sobrar só a faixa do topo. `pointer-events-none` deixa a página
      // clicável em volta; só os cartões reativam o clique.
      className="pointer-events-none fixed inset-x-0 top-0 bottom-auto m-0 h-auto w-full max-w-none overflow-visible border-0 bg-transparent p-0"
    >
      <ol className="mx-auto flex w-full max-w-md flex-col items-stretch gap-2 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <AnimatePresence initial={false} onExitComplete={onExitComplete}>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
