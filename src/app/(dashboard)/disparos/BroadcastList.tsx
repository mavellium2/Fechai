"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Megaphone, Plus, Search } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import type { BroadcastPage, BroadcastSummary } from "@/modules/broadcasts/queries";
import { CampaignStats } from "./CampaignStats";
import { DisparosNav } from "./DisparosNav";
import { CAMPAIGN_FILTERS, campaignStatus, formatDate } from "./labels";

const FILTERS: FilterField[] = [
  { type: "select", key: "status", label: "Situação", options: [...CAMPAIGN_FILTERS] },
  { type: "period", from: "from", to: "to", label: "Período de criação" },
];
const NO_FILTERS: FilterValues = { status: "", from: "", to: "" };
import { FilterPopover, type FilterField, type FilterValues } from "@/components/ui/filter-popover";
import {
  discardBroadcastDraft,
  pauseBroadcast,
  refreshBroadcasts,
  resumeBroadcast,
} from "./actions";

export function BroadcastList({
  initial,
  connected,
  banner,
}: {
  initial: BroadcastPage;
  connected: boolean;
  /** Aviso logo abaixo das abas (ex.: conectar a Meta). */
  banner?: React.ReactNode;
}) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const first = useRef(true);
  const save = useSaveFeedback({ entity: "disparo", action: "update" });

  async function load(silent = false) {
    const current = ++version.current;
    if (!silent) setLoading(true);
    try {
      const next = await refreshBroadcasts({ query, ...filters, page });
      if (current === version.current) setData(next);
    } catch {
      // A próxima volta tenta de novo; a lista atual continua na tela.
    } finally {
      if (current === version.current) setLoading(false);
    }
  }

  // Busca enquanto digita (com respiro) e ao trocar filtro/página.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters, page]);

  // Só acompanha ao vivo quando há disparo enviando e a aba está visível.
  useEffect(() => {
    if (!data.active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.active, query, filters, page]);

  async function act(task: () => Promise<{ ok: boolean; error?: string; info?: string }>) {
    await save.run(task);
    await load(true);
  }

  const healthProblem =
    data.active > 0 && (!data.health.online || data.health.error);
  const filtered = Boolean(query || filters.status || filters.from || filters.to);

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
                aria-label="Buscar disparo pelo nome"
                placeholder="Buscar pelo nome"
                className="pl-9"
                value={query}
                maxLength={100}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <FilterPopover
              label="Filtrar disparos"
              fields={FILTERS}
              value={filters}
              loading={loading}
              onChange={(next) => {
                setFilters(next);
                setPage(1);
              }}
            />
            {connected && (
              <ButtonLink href="/disparos/novo" variant="cta">
                <Plus size={16} aria-hidden />
                Novo disparo
              </ButtonLink>
            )}
          </div>
        }
      />
      {banner}
      {healthProblem && (
        <Alert tone="warn" title="Os envios estão parados no momento">
          Seus disparos confirmados estão guardados e continuam quando o serviço
          voltar. Se isso durar mais de alguns minutos, fale com o suporte.
        </Alert>
      )}

      {data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title={filtered ? "Nenhum disparo neste filtro" : "Nenhum disparo ainda"}
            description={
              filtered
                ? "Mude a busca ou a situação para ver outros disparos."
                : "Escolha uma mensagem aprovada, selecione os contatos e acompanhe aqui quem recebeu, leu e respondeu."
            }
            action={
              filtered ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setFilters(NO_FILTERS);
                  }}
                >
                  Limpar filtros
                </Button>
              ) : connected ? (
                <ButtonLink href="/disparos/novo">
                  Criar primeiro disparo
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className={`space-y-3 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {data.items.map((c) => (
            <li key={c.id}>
              <CampaignCard c={c} pending={save.saving} onAct={act} />
            </li>
          ))}
        </ul>
      )}

      {data.pages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-white/60">
          <span>
            {data.total} disparos · página {data.page} de {data.pages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || data.page >= data.pages}
              onClick={() => setPage(data.page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignCard({
  c,
  pending,
  onAct,
}: {
  c: BroadcastSummary;
  pending: boolean;
  onAct: (task: () => Promise<{ ok: boolean; error?: string; info?: string }>) => Promise<void>;
}) {
  const state = campaignStatus(c);
  const href = c.status === "draft" ? `/disparos/novo?rascunho=${c.id}` : `/disparos/${c.id}`;
  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className="font-display text-lg font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              {c.name}
            </Link>
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-white/60">
            {c.templateName && <>{c.templateName} · </>}
            {c.status === "draft"
              ? `${c.total} contatos · criado em ${formatDate(c.createdAt, c.timezone)}`
              : c.status === "queued" && state.label === "Agendado"
                ? `começa em ${formatDate(c.scheduledAt, c.timezone)}`
                : `confirmado em ${formatDate(c.confirmedAt ?? c.createdAt, c.timezone)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === "draft" && (
            <>
              <ButtonLink href={href} size="sm">
                Continuar
              </ButtonLink>
              <ConfirmButton
                size="sm"
                variant="ghost"
                disabled={pending}
                confirm={{
                  title: "Descartar este rascunho?",
                  description: `"${c.name}" e a lista de ${c.total} contatos serão descartados. Nenhuma mensagem foi enviada a eles.`,
                  confirmLabel: "Descartar",
                  tone: "danger",
                }}
                onConfirm={() => onAct(() => discardBroadcastDraft(c.id))}
              >
                Descartar
              </ConfirmButton>
            </>
          )}
          {c.status === "queued" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onAct(() => pauseBroadcast(c.id))}
            >
              Pausar
            </Button>
          )}
          {c.status === "paused" && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => onAct(() => resumeBroadcast(c.id))}
            >
              Retomar
            </Button>
          )}
          {c.status !== "draft" && (
            <ButtonLink href={href} size="sm" variant="ghost">
              Ver detalhes
            </ButtonLink>
          )}
        </div>
      </div>
      {c.status !== "draft" && <CampaignStats c={c} compact />}
      {c.error && c.status === "paused" && (
        <p className="text-sm text-warn">{c.error}</p>
      )}
    </Card>
  );
}
