"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { actionFocus, actionText } from "@/components/ui/action";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CrmLeadTab = { key: string; label: string; content: ReactNode };

/**
 * Ficha do lead: janela larga em vez de gaveta lateral. A conversa é o que mais
 * se usa e ocupa a coluna principal; dados, tarefas e histórico ficam em abas na
 * coluna da direita, cada uma rolando sozinha. No celular vira uma coluna só.
 *
 * Todas as abas ficam montadas (só `hidden` na inativa): trocar de aba não perde
 * o que foi digitado num formulário.
 */
export function CrmLeadDrawer({ title, meta, back, main, tabs }: {
  title: string; meta?: ReactNode; back: string; main: ReactNode; tabs: CrmLeadTab[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [active, setActive] = useState(0);
  const groupId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby="crm-lead-title"
      onCancel={(event) => { event.preventDefault(); router.push(back); }}
      onClick={(event) => { if (event.target === dialog.current) router.push(back); }}
      className={cn(
        "m-auto h-dvh max-h-none w-full max-w-none overflow-hidden p-0 text-ink shadow-2xl",
        "sm:h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] sm:max-w-6xl sm:rounded-surface sm:border sm:border-ink/10 sm:panel:border-white/12",
        "bg-white panel:bg-ink panel:text-white backdrop:bg-ink/80 backdrop:backdrop-blur-sm open:flex open:flex-col",
      )}>
      <header className="flex items-start justify-between gap-4 border-b border-ink/10 px-4 py-4 panel:border-white/10 sm:px-6">
        <div className="min-w-0 space-y-2">
          <h2 id="crm-lead-title" className="font-display text-xl font-semibold [overflow-wrap:anywhere]">{title}</h2>
          {meta}
        </div>
        <ButtonLink href={back} variant="action" size="icon" aria-label="Voltar ao quadro"><X size={20} aria-hidden /></ButtonLink>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
        <section aria-label="Conversa" className="min-w-0 space-y-4 p-4 sm:p-6 lg:overflow-y-auto lg:overscroll-contain">{main}</section>

        <aside className="min-w-0 border-t border-ink/10 panel:border-white/10 lg:flex lg:min-h-0 lg:flex-col lg:border-l lg:border-t-0">
          <div role="tablist" aria-label="Detalhes do lead" className="flex gap-1 border-b border-ink/10 px-4 panel:border-white/10 sm:px-6">
            {tabs.map((tab, i) => {
              const on = i === active;
              return (
                <button key={tab.key} type="button" role="tab" id={`${groupId}-tab-${tab.key}`} aria-selected={on}
                  aria-controls={`${groupId}-panel-${tab.key}`} tabIndex={on ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={(event) => {
                    const next = event.key === "ArrowRight" ? (i + 1) % tabs.length
                      : event.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : null;
                    if (next === null) return;
                    event.preventDefault();
                    setActive(next);
                    document.getElementById(`${groupId}-tab-${tabs[next].key}`)?.focus();
                  }}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-3 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2",
                    actionFocus,
                    on ? `border-signal ${actionText}` : `border-transparent opacity-60 hover:opacity-100 ${actionText}`,
                  )}>
                  {tab.label}
                </button>
              );
            })}
          </div>
          {tabs.map((tab, i) => (
            <div key={tab.key} id={`${groupId}-panel-${tab.key}`} role="tabpanel" aria-labelledby={`${groupId}-tab-${tab.key}`}
              hidden={i !== active} className="min-w-0 space-y-6 p-4 sm:p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
              {tab.content}
            </div>
          ))}
        </aside>
      </div>
    </dialog>
  );
}
