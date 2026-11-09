"use client";
import { Fragment, useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ManualRow = {
  id: number;
  phone: string;
  name: string;
  parameters: string[];
};

/** Teto da digitação na tela (o servidor confere de novo). */
export const MAX_MANUAL_ROWS = 200;

let nextId = 1;
export function newManualRow(): ManualRow {
  return { id: nextId++, phone: "", name: "", parameters: [] };
}

/** Linha em branco não conta: quem digita deixa uma sobrando no fim. */
export function isBlankRow(row: ManualRow) {
  return (
    !row.phone.trim() &&
    !row.name.trim() &&
    row.parameters.every((p) => !p.trim())
  );
}

/**
 * Tabela para digitar os contatos: uma linha por pessoa, uma coluna por
 * variável do template. Só edita — quem valida (DDI/DDD, variáveis, duplicados)
 * é o servidor, com as mesmas regras do arquivo. O número da linha na tabela é
 * o que o erro devolvido cita.
 */
export function ManualContacts({
  rows,
  onChange,
  parameterCount,
  errors,
  disabled,
}: {
  rows: ManualRow[];
  onChange: (rows: ManualRow[]) => void;
  parameterCount: number;
  /** Erro por número de linha da tabela (1 = primeira). */
  errors: Map<number, string>;
  disabled?: boolean;
}) {
  const phoneInputs = useRef(new Map<number, HTMLInputElement>());
  const focusAfterAdd = useRef<number | null>(null);

  useEffect(() => {
    const id = focusAfterAdd.current;
    if (id == null) return;
    focusAfterAdd.current = null;
    phoneInputs.current.get(id)?.focus();
  }, [rows.length]);

  function update(id: number, patch: Partial<ManualRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function setParameter(id: number, index: number, value: string) {
    onChange(
      rows.map((r) => {
        if (r.id !== id) return r;
        const parameters = Array.from(
          { length: Math.max(parameterCount, r.parameters.length) },
          (_, i) => r.parameters[i] ?? "",
        );
        parameters[index] = value;
        return { ...r, parameters };
      }),
    );
  }
  function add() {
    if (rows.length >= MAX_MANUAL_ROWS) return;
    const row = newManualRow();
    focusAfterAdd.current = row.id;
    onChange([...rows, row]);
  }
  function remove(id: number) {
    const left = rows.filter((r) => r.id !== id);
    // Nunca deixa a tabela sem linha: seria um beco sem saída na tela.
    onChange(left.length ? left : [newManualRow()]);
  }

  const columns = 2 + parameterCount;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-control border border-white/10">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-white/60">
              <th className="w-10 px-3 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Telefone *</th>
              <th className="px-2 py-2 font-medium">Nome (opcional)</th>
              {Array.from({ length: parameterCount }, (_, i) => (
                <th key={i} className="px-2 py-2 font-medium">
                  Variável {`{{${i + 1}}}`} *
                </th>
              ))}
              <th className="w-10 px-2 py-2">
                <span className="sr-only">Remover</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const error = errors.get(index + 1);
              const last = index === rows.length - 1;
              const onEnter = (e: React.KeyboardEvent) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (last) add();
              };
              return (
                <Fragment key={row.id}>
                  <tr className="border-t border-white/10 align-top">
                    <td className="px-3 py-2 text-white/50">{index + 1}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        ref={(el) => {
                          if (el) phoneInputs.current.set(row.id, el);
                          else phoneInputs.current.delete(row.id);
                        }}
                        aria-label={`Telefone do contato ${index + 1}`}
                        aria-invalid={error ? true : undefined}
                        inputMode="tel"
                        autoComplete="off"
                        placeholder="+55 11 98765-4321"
                        value={row.phone}
                        maxLength={30}
                        disabled={disabled}
                        onChange={(e) => update(row.id, { phone: e.target.value })}
                        onKeyDown={onEnter}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        aria-label={`Nome do contato ${index + 1}`}
                        autoComplete="off"
                        placeholder="Ana"
                        value={row.name}
                        maxLength={120}
                        disabled={disabled}
                        onChange={(e) => update(row.id, { name: e.target.value })}
                        onKeyDown={onEnter}
                      />
                    </td>
                    {Array.from({ length: parameterCount }, (_, i) => (
                      <td key={i} className="px-2 py-1.5">
                        <Input
                          aria-label={`Variável ${i + 1} do contato ${index + 1}`}
                          aria-invalid={error ? true : undefined}
                          autoComplete="off"
                          value={row.parameters[i] ?? ""}
                          maxLength={1024}
                          disabled={disabled}
                          onChange={(e) => setParameter(row.id, i, e.target.value)}
                          onKeyDown={onEnter}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        aria-label={`Remover contato ${index + 1}`}
                        disabled={disabled}
                        onClick={() => remove(row.id)}
                        className="grid size-10 place-items-center rounded-control text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris disabled:opacity-50"
                      >
                        <X size={16} aria-hidden />
                      </button>
                    </td>
                  </tr>
                  {error && (
                    <tr>
                      <td />
                      <td
                        colSpan={columns}
                        className="px-2 pb-2 text-xs text-danger"
                        role="alert"
                      >
                        {error}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || rows.length >= MAX_MANUAL_ROWS}
          onClick={add}
        >
          <Plus size={14} aria-hidden />
          Adicionar contato
        </Button>
        <p className="text-xs text-white/60">
          Inclua DDI e DDD. Enter na última linha cria outra. Até{" "}
          {MAX_MANUAL_ROWS} contatos; para listas maiores, use um arquivo.
        </p>
      </div>
    </div>
  );
}

