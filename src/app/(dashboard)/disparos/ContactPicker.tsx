"use client";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterPopover, type FilterField } from "@/components/ui/filter-popover";
import type {
  BroadcastContactRow,
  LeadStatusFilter,
} from "@/modules/broadcasts/contact-search";
import { MAX_RECIPIENTS, type ListContact } from "@/modules/broadcasts/contacts";
import { listBroadcastContacts } from "./actions";
import { formatPhone } from "./labels";

export type PickedContacts = Map<string, ListContact>;

const FILTERS: FilterField[] = [
  {
    type: "select",
    key: "status",
    label: "Estágio do contato",
    options: [
      { value: "", label: "Todos os estágios" },
      { value: "new", label: "Novos" },
      { value: "warm", label: "Mornos" },
      { value: "hot", label: "Quentes" },
      { value: "scheduled", label: "Agendados" },
      { value: "lost", label: "Perdidos" },
    ],
  },
];

const STATUS_LABEL: Record<string, string> = {
  new: "novo",
  warm: "morno",
  hot: "quente",
  scheduled: "agendado",
  lost: "perdido",
};

type Page = Awaited<ReturnType<typeof listBroadcastContacts>>;

export function ContactPicker({
  picked,
  onChange,
  disabled,
}: {
  picked: PickedContacts;
  onChange: (next: PickedContacts) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<LeadStatusFilter>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const version = useRef(0);

  useEffect(() => {
    const current = ++version.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        try {
          const next = await listBroadcastContacts(q, status, page);
          if (current !== version.current) return;
          setData(next);
          setError("");
        } catch {
          if (current === version.current)
            setError("Não foi possível carregar os contatos. Tente de novo.");
        } finally {
          if (current === version.current) setLoading(false);
        }
      },
      q ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [q, status, page]);

  function toggle(row: BroadcastContactRow) {
    const next = new Map(picked);
    if (next.has(row.phone)) next.delete(row.phone);
    else if (next.size < MAX_RECIPIENTS)
      next.set(row.phone, { phone: row.phone, name: row.name });
    onChange(next);
  }

  const items = data?.items ?? [];
  const pageSelectable = items.filter((r) => !r.unavailable);
  const allOnPage =
    pageSelectable.length > 0 && pageSelectable.every((r) => picked.has(r.phone));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
            aria-hidden
          />
          <Input
            aria-label="Buscar contato por nome ou telefone"
            placeholder="Buscar por nome ou telefone"
            className="pl-9"
            value={q}
            disabled={disabled}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <FilterPopover
          label="Filtrar contatos"
          fields={FILTERS}
          value={{ status }}
          onChange={(next) => {
            setStatus((next.status ?? "") as LeadStatusFilter);
            setPage(1);
          }}
        />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="overflow-hidden rounded-control border border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/5 px-4 py-2">
          <label className="flex items-center gap-3 text-xs uppercase tracking-wide text-white/60">
            <input
              type="checkbox"
              className="accent-iris"
              checked={allOnPage}
              disabled={disabled || !pageSelectable.length}
              onChange={() => {
                const next = new Map(picked);
                for (const r of pageSelectable) {
                  if (allOnPage) next.delete(r.phone);
                  else if (next.size < MAX_RECIPIENTS)
                    next.set(r.phone, { phone: r.phone, name: r.name });
                }
                onChange(next);
              }}
            />
            Selecionar esta página
          </label>
          <p className="flex items-center gap-3 text-xs text-white/60" aria-live="polite">
            {picked.size > 0 && (
              <>
                <span className="font-medium text-white">
                  {picked.size} {picked.size === 1 ? "selecionado" : "selecionados"}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(new Map())}
                  className="inline-flex items-center gap-1 rounded-control underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris disabled:opacity-60"
                >
                  <X size={12} aria-hidden />
                  Limpar
                </button>
              </>
            )}
          </p>
        </div>
        {loading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-sm text-white/60">
            {q || status
              ? "Nenhum contato neste filtro. Mude a busca ou o estágio."
              : "Sua conta ainda não tem contatos. Digite os números na aba ao lado ou importe um arquivo."}
          </div>
        ) : (
          <ul
            className={`max-h-[calc(100vh-19rem)] min-h-64 divide-y divide-white/5 overflow-auto ${loading ? "opacity-60" : ""}`}
            aria-busy={loading}
          >
            {items.map((row) => {
              const checked = picked.has(row.phone);
              return (
                <li key={row.id}>
                  <label
                    className={`flex items-center gap-3 px-4 py-2 text-sm ${
                      row.unavailable
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-white/5"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-iris"
                      checked={checked}
                      disabled={disabled || Boolean(row.unavailable)}
                      onChange={() => toggle(row)}
                    />
                    <span className="min-w-0 flex-1 truncate text-white">
                      {row.name || <span className="text-white/45">Sem nome</span>}
                    </span>
                    <span className="hidden shrink-0 font-mono text-xs text-white/50 sm:inline">
                      {formatPhone(row.phone)}
                    </span>
                    {row.unavailable === "blocked" ? (
                      <Badge tone="danger">bloqueado</Badge>
                    ) : row.unavailable === "stopped" ? (
                      <Badge tone="warn">pediu para parar</Badge>
                    ) : (
                      <Badge tone="neutral">
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-white/60">
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {data.page} de {data.pages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= data.pages || loading}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
