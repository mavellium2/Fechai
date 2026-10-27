"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/ui/info-hint";
import { useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { useInlineEditor } from "./EditorLayout";

export type StepTab = {
  key: string;
  label: string;
  /** Explicação do que se responde nesta seção — vira bolinha na aba ativa. */
  hint?: string;
  content: React.ReactNode;
};

/**
 * Sub-navegação dentro de um passo do wizard de agente. Mais discreta que o
 * stepper principal (sublinhado, não pílula) para não competir com ele.
 *
 * Todo painel fica sempre montado no DOM — a troca de aba só aplica `hidden`
 * no inativo. Necessário para o Persona: os grupos continuam dentro de UM
 * `<form>` só, com um botão salvar só; se a aba trocasse por desmontagem
 * condicional, os campos das abas não-ativas sairiam do `FormData` no submit
 * e a persona seria salva incompleta sem nenhum aviso.
 */
export function StepTabs({ tabs }: { tabs: StepTab[] }) {
  const [active, setActive] = useState(0);
  const groupId = useId();
  const confirmNavigation = useUnsavedNavigation();
  const inline = useInlineEditor();

  if (inline) return <div className="agent-form-sections">{tabs.map(t => <section key={t.key} className="agent-form-section"><h3>{t.label}</h3>{t.content}</section>)}</div>;

  return (
    <div>
      <div role="tablist" aria-label="Seções" className="mb-6 flex flex-wrap gap-2 border-b border-white/10">
        {tabs.map((t, i) => {
          const on = i === active;
          const tabId = `${groupId}-tab-${t.key}`;
          const panelId = `${groupId}-panel-${t.key}`;
          return (
            // `contents`: o span some da caixa de layout, então o tablist
            // continua tendo os `role="tab"` como filhos diretos (a relação
            // ARIA quebra se houver um elemento renderizado no meio).
            <span key={t.key} role="presentation" className="contents">
              <button
                type="button"
                role="tab"
                id={tabId}
                aria-selected={on}
                aria-controls={panelId}
                tabIndex={on ? 0 : -1}
                onClick={() => { if (!on) confirmNavigation(() => setActive(i)); }}
                onKeyDown={(event) => {
                  const next = event.key === "ArrowRight" ? (i + 1) % tabs.length
                    : event.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
                    : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
                  if (next === null) return;
                  event.preventDefault();
                  confirmNavigation(() => {
                    setActive(next);
                    document.getElementById(`${groupId}-tab-${tabs[next].key}`)?.focus();
                  });
                }}
                className={cn(
                  "-mb-px rounded-t-control border-b-2 px-3 py-2 font-mono text-micro uppercase tracking-[0.15em] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                  on ? "border-iris text-white" : "border-transparent text-white/50 hover:text-white/80",
                )}
              >
                {t.label}
              </button>
              {/* Só na aba aberta: uma fileira de bolinhas viraria o ruído que
                  esta mudança veio tirar. Fora do <button> de propósito —
                  botão dentro de botão é HTML inválido. */}
              {on && t.hint && (
                <InfoHint label={t.label} className="-ml-1 self-center">
                  {t.hint}
                </InfoHint>
              )}
            </span>
          );
        })}
      </div>

      {tabs.map((t, i) => {
        const tabId = `${groupId}-tab-${t.key}`;
        const panelId = `${groupId}-panel-${t.key}`;
        return (
          <div key={t.key} id={panelId} role="tabpanel" aria-labelledby={tabId} hidden={i !== active}>
            {t.content}
          </div>
        );
      })}
    </div>
  );
}
