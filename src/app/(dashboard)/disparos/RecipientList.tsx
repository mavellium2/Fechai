"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { broadcastMetaErrorCode, broadcastMetaFailure } from "@/modules/broadcasts/meta-failure";
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
  conversationId?: string | null;
  retryEligible?: boolean;
  /** O que muda de um contato para outro (valores das variáveis). */
  detail?: string;
};

function recipientFailure(r: RecipientRow) {
  if (r.repliedAt) return null;
  const delivery = r.status === "sent" && r.deliveryStatus === "failed";
  if (!delivery && r.status !== "failed") return null;
  const raw = delivery ? r.deliveryError : r.error;
  const code = broadcastMetaErrorCode(raw);
  if (!delivery && raw?.startsWith("Falha ao preparar a conversa."))
    return { title: "Não foi possível preparar a conversa", next: "Confira se o telefone está correto e se existe apenas um contato para o número.", code };
  if (!delivery && raw?.startsWith("Falta o arquivo do topo"))
    return { title: "Falta o arquivo do topo da mensagem", next: "Prepare um novo disparo com o arquivo exigido pelo modelo.", code };
  return { ...broadcastMetaFailure(code, delivery), code };
}

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
        const failure = recipientFailure(r);
        const identity = <>
          <span className="block break-words font-medium">{r.name || "Sem nome"}</span>
          <span className="block font-mono text-xs text-white/60">{formatPhone(r.phone)}</span>
        </>;
        return (
          <li
            key={r.id}
            className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 sm:flex-1">
              {r.conversationId ? (
                <Link
                  href={{ pathname: "/conversas", query: { id: r.conversationId } }}
                  prefetch={false}
                  className="inline-flex max-w-full items-center gap-2 rounded text-white underline decoration-white/30 underline-offset-2 hover:decoration-current focus-visible:outline-2"
                >
                  <span className="min-w-0">{identity}</span>
                  <ArrowUpRight size={15} className="shrink-0 text-white/50" aria-hidden />
                </Link>
              ) : (
                <div className="text-white">{identity}<p className="mt-1 text-xs text-white/50">Sem conversa disponível</p></div>
              )}
              {r.isTest && <div className="mt-1"><Badge tone="neutral">Teste</Badge></div>}
              {r.detail && (
                <p className="mt-1 break-words text-xs text-white/60">{r.detail}</p>
              )}
            </div>
            {showResult && (
              <div className="min-w-0 sm:w-1/2 sm:max-w-md">
                <span title={RESULT_HINT[result.label]}>
                  <Badge tone={result.tone}>{result.label}</Badge>
                </span>
                {r.retryEligible && <span className="ml-2 text-xs text-white/60">Pode reenviar após revisão</span>}
                {failure ? (
                  <div className="mt-1 space-y-1 text-xs leading-relaxed">
                    <p className="font-medium text-white">{failure.title}{failure.code !== null && <span className="ml-2 font-mono font-normal text-white/50">Meta {failure.code}</span>}</p>
                    <p className="text-white/70">{failure.next}</p>
                  </div>
                ) : (
                  (r.status === "skipped" || r.status === "unknown") && r.error &&
                  <p className="mt-1 text-xs text-white/70">{r.error}</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
