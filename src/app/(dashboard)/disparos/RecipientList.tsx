"use client";
import { Badge } from "@/components/ui/badge";
import { formatPhone, recipientResult, RESULT_HINT } from "./labels";

export type RecipientRow = {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  error?: string | null;
  isTest?: boolean;
  deliveryStatus?: string | null;
  deliveryError?: string | null;
  repliedAt?: Date | string | null;
  /** O que muda de um contato para outro (valores das variáveis). */
  detail?: string;
};

/**
 * Lista de contatos que vira cartão no celular. A mensagem inteira não se
 * repete por linha: ela é igual para todos, só as variáveis mudam (`detail`).
 */
export function RecipientList({
  rows,
  showResult = true,
  empty = "Nenhum contato aqui.",
}: {
  rows: RecipientRow[];
  showResult?: boolean;
  empty?: string;
}) {
  if (!rows.length)
    return <p className="py-8 text-center text-sm text-white/60">{empty}</p>;
  return (
    <ul className="max-h-[28rem] divide-y divide-white/5 overflow-auto rounded-control border border-white/10">
      {rows.map((r) => {
        const result = recipientResult(r);
        const reason = r.deliveryError ?? r.error;
        return (
          <li
            key={r.id}
            className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-white">
                {r.name || "Sem nome"}
                {r.isTest && (
                  <span className="ml-2 align-middle">
                    <Badge tone="neutral">teste</Badge>
                  </span>
                )}
              </p>
              <p className="font-mono text-xs text-white/50">{formatPhone(r.phone)}</p>
              {r.detail && (
                <p className="mt-1 break-words text-xs text-white/60">{r.detail}</p>
              )}
            </div>
            {showResult && (
              <div className="shrink-0 sm:max-w-xs sm:text-right">
                <span title={RESULT_HINT[result.label]}>
                  <Badge tone={result.tone}>{result.label}</Badge>
                </span>
                {reason && (
                  <p className="mt-1 text-xs text-warn">{reason}</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
