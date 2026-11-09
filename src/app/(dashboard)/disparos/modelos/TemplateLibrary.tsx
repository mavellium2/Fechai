"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, FileText, Plus, RefreshCw, Search, Send, Wrench } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  dayOf,
  FilterPopover,
  inPeriod,
  type FilterField,
  type FilterValues,
} from "@/components/ui/filter-popover";
import {
  templateCategoryLabel,
  templateRejectionLabel,
  templateStatusLabel,
  type ManagedTemplate,
} from "@/modules/broadcasts/template-draft";
import { listMessageTemplates } from "./actions";
import { HighlightedText } from "./WhatsAppBubble";
import { DisparosNav } from "../DisparosNav";

type Filter = "all" | "approved" | "pending" | "rejected";

const GROUP: Record<string, Filter> = {
  APPROVED: "approved",
  PENDING: "pending",
  IN_APPEAL: "pending",
  REJECTED: "rejected",
  PAUSED: "rejected",
  DISABLED: "rejected",
};

const NO_FILTERS: FilterValues = { status: "", category: "", from: "", to: "" };

const LABELS: Record<Filter, string> = {
  all: "Todas as situações",
  approved: "Aprovados",
  pending: "Em análise",
  rejected: "Com problema",
};

export function TemplateLibrary({
  initial,
  initialError,
}: {
  initial: ManagedTemplate[] | null;
  initialError: string | null;
}) {
  const [templates, setTemplates] = useState(initial);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(NO_FILTERS);
  const [query, setQuery] = useState("");

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await listMessageTemplates();
      if (result.ok) {
        setTemplates(result.templates);
        setError(null);
      } else if (!silent) setError(result.error);
    } catch {
      if (!silent) setError("Não foi possível consultar os modelos na Meta agora.");
    } finally {
      setLoading(false);
    }
  }

  // Enquanto algum modelo está em análise, acompanha sozinho (aba visível).
  const reviewing = templates?.some((t) => GROUP[t.status] === "pending") ?? false;
  useEffect(() => {
    if (!reviewing) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 15_000);
    return () => clearInterval(timer);
  }, [reviewing]);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: 0, approved: 0, pending: 0, rejected: 0 };
    for (const t of templates ?? []) {
      base.all++;
      const group = GROUP[t.status];
      if (group) base[group]++;
    }
    return base;
  }, [templates]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? [])
      .filter((t) => !filters.status || GROUP[t.status] === filters.status)
      .filter((t) => !filters.category || t.category === filters.category)
      .filter((t) => inPeriod(t.createdAt ? dayOf(t.createdAt) : null, filters.from, filters.to))
      .filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q),
      );
  }, [templates, filters, query]);

  const fields: FilterField[] = [
    {
      type: "select",
      key: "status",
      label: "Situação",
      options: (Object.keys(LABELS) as Filter[]).map((value) => ({
        value: value === "all" ? "" : value,
        label: `${LABELS[value]} ${counts[value]}`,
      })),
    },
    {
      type: "select",
      key: "category",
      label: "Tipo",
      allLabel: "Todos os tipos",
      options: [
        { value: "UTILITY", label: "Aviso ou lembrete" },
        { value: "MARKETING", label: "Promoção ou campanha" },
      ],
    },
    {
      type: "period",
      from: "from",
      to: "to",
      label: "Criado em",
      hint: "Só os modelos criados pelo Fechai têm data; os criados direto na Meta ficam de fora deste filtro.",
    },
  ];

  return (
    <div className="space-y-4">
      <DisparosNav
        actions={
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="relative w-full sm:w-64">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                aria-hidden
              />
              <Input
                aria-label="Buscar modelo pelo nome ou texto"
                placeholder="Buscar pelo nome ou texto"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <FilterPopover label="Filtrar modelos" fields={fields} value={filters} onChange={setFilters} />
            <Button
              variant="ghost"
              size="icon"
              loading={loading}
              onClick={() => void refresh()}
              aria-label="Atualizar situação dos modelos"
              title="Atualizar situação dos modelos"
            >
              <RefreshCw size={16} aria-hidden />
            </Button>
            <ButtonLink href="/disparos/modelos/novo" variant="cta">
              <Plus size={16} aria-hidden />
              Novo modelo
            </ButtonLink>
          </div>
        }
      />

      {reviewing && (
        <p className="text-sm text-white/60" aria-live="polite">
          A Meta está analisando {counts.pending === 1 ? "1 modelo" : `${counts.pending} modelos`}.
          Costuma levar de minutos a algumas horas; esta lista se atualiza sozinha.
        </p>
      )}

      {error ? (
        <Alert tone="danger">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>
            Tentar de novo
          </Button>
        </Alert>
      ) : !templates?.length ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Nenhum modelo ainda"
            description="Toda mensagem que inicia conversa pelo WhatsApp oficial precisa de um modelo aprovado pela Meta. Escreva o primeiro: depois de aprovado, ele aparece nos disparos e nos lembretes de consulta."
            action={<ButtonLink href="/disparos/modelos/novo">Escrever primeiro modelo</ButtonLink>}
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Nenhum modelo neste filtro"
            description="Mude a busca ou a situação para ver os outros."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setFilters(NO_FILTERS);
                }}
              >
                Limpar filtros
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {visible.map((t) => (
            <li key={t.id}>
              <TemplateCard t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateCard({ t }: { t: ManagedTemplate }) {
  const [open, setOpen] = useState(false);
  const status = templateStatusLabel(t.status);
  const group = GROUP[t.status];
  const long = t.body.length > 180;
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-sm text-white" title={t.name}>
          {t.name}
        </p>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge>{templateCategoryLabel(t.category)}</Badge>
      </div>

      <div className="flex-1 text-sm leading-relaxed text-white/80">
        {t.header && <p className="mb-1 font-semibold text-white">{t.header}</p>}
        <p className={open ? "whitespace-pre-wrap break-words" : "line-clamp-4 whitespace-pre-wrap break-words"}>
          <HighlightedText text={t.body} />
        </p>
        {t.footer && open && <p className="mt-2 text-xs text-white/50">{t.footer}</p>}
        {(long || t.footer) && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-2 text-xs text-white/60 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            {open ? "Mostrar menos" : "Ver texto completo"}
          </button>
        )}
      </div>

      {group === "rejected" && (
        <p className="rounded-control bg-danger/10 p-3 text-sm text-white/85">
          {t.status === "REJECTED"
            ? templateRejectionLabel(t.rejectedReason ?? "")
            : "A Meta suspendeu este modelo, em geral por denúncias ou baixa qualidade. Crie uma versão nova."}
        </p>
      )}
      {t.createdAt && (
        <p className="text-xs text-white/45">
          Criado em {new Date(t.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
        </p>
      )}
      {group === "pending" && (
        <p className="text-xs text-white/55">Aguardando a Meta. Ainda não pode ser usado.</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
        {group === "approved" && (
          <ButtonLink href={`/disparos/novo?modelo=${encodeURIComponent(t.id)}`} size="sm">
            <Send size={14} aria-hidden />
            Usar em disparo
          </ButtonLink>
        )}
        {group === "rejected" && (
          <ButtonLink href={`/disparos/modelos/novo?de=${encodeURIComponent(t.id)}`} size="sm">
            <Wrench size={14} aria-hidden />
            Corrigir
          </ButtonLink>
        )}
        <ButtonLink
          href={`/disparos/modelos/novo?de=${encodeURIComponent(t.id)}&copia=1`}
          size="sm"
          variant="ghost"
        >
          <Copy size={14} aria-hidden />
          Duplicar
        </ButtonLink>
      </div>
    </Card>
  );
}
