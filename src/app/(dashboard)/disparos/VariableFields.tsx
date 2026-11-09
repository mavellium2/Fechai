"use client";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import type { VariableSource } from "@/modules/broadcasts/contacts";

const OPTIONS = [
  { value: "firstName", label: "Primeiro nome" },
  { value: "name", label: "Nome completo" },
  { value: "text", label: "Mesmo texto para todos" },
];

/**
 * Como preencher cada espaço da mensagem quando os contatos não vêm de arquivo.
 * O que fazer com quem não tem nome fica no bloco "Quem não tem nome".
 */
export function VariableFields({
  variables,
  onChange,
  disabled,
}: {
  variables: VariableSource[];
  onChange: (next: VariableSource[]) => void;
  disabled?: boolean;
}) {
  if (!variables.length) return null;
  const update = (i: number, patch: Partial<VariableSource>) =>
    onChange(variables.map((v, j) => (i === j ? { ...v, ...patch } : v)));
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-white">O que vai em cada espaço</h3>
        <p className="mt-1 text-xs text-white/55">Os espaços são as partes destacadas na mensagem.</p>
      </div>
      <ul className="space-y-3">
        {variables.map((v, i) => {
          const labelId = `broadcast-var-${i}-label`;
          return (
            <li key={i} className="grid gap-2 sm:grid-cols-[4.5rem_13rem_1fr] sm:items-center">
              <span id={labelId} className="font-mono text-xs text-white/60">
                {`Espaço ${i + 1}`}
              </span>
              <SelectMenu
                label={`O que vai no espaço ${i + 1}`}
                labelledBy={labelId}
                value={v.source}
                disabled={disabled}
                className="w-full"
                options={OPTIONS}
                onChange={(source) => update(i, { source: source as VariableSource["source"] })}
              />
              {v.source === "text" ? (
                <Input
                  aria-label={`Texto do espaço ${i + 1}`}
                  value={v.text}
                  maxLength={1024}
                  disabled={disabled}
                  placeholder="Ex.: 20% de desconto"
                  onChange={(e) => update(i, { text: e.target.value })}
                />
              ) : (
                <span className="text-xs text-white/50">
                  {v.source === "firstName" ? "Ex.: Daniela" : "Ex.: Daniela Reis"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
