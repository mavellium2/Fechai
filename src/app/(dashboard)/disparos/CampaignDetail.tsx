"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import type { BroadcastSummary } from "@/modules/broadcasts/queries";
import { CampaignStats } from "./CampaignStats";
import { RecipientList } from "./RecipientList";
import { downloadBase64 } from "./download";
import {
  campaignStatus,
  formatDate,
  matchesRecipientFilter,
  minuteLabel,
  RECIPIENT_FILTERS,
  type RecipientFilter,
} from "./labels";
import {
  cancelBroadcast,
  exportBroadcast,
  getBroadcastCampaign,
  pauseBroadcast,
  resumeBroadcast,
} from "./actions";

type Detail = NonNullable<Awaited<ReturnType<typeof getBroadcastCampaign>>>;

const TIMEZONE_LABEL: Record<string, string> = {
  "America/Sao_Paulo": "horário de Brasília",
  "America/Manaus": "horário de Manaus",
  "America/Rio_Branco": "horário de Rio Branco",
  "America/Noronha": "horário de Fernando de Noronha",
  UTC: "UTC",
};

export function CampaignDetail({ initial }: { initial: Detail }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const save = useSaveFeedback({ entity: "disparo", action: "update" });
  const c: BroadcastSummary = data.summary;
  const state = campaignStatus(c);

  async function reload() {
    try {
      const next = await getBroadcastCampaign(c.id);
      if (next) setData(next);
    } catch {
      // Tenta de novo na próxima volta.
    }
  }

  // Ao vivo só enquanto envia, e só com a aba visível.
  useEffect(() => {
    if (c.status !== "queued") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.status, c.id]);

  async function act(task: () => Promise<{ ok: boolean; error?: string; info?: string }>) {
    await save.run(task);
    await reload();
  }

  const realRows = data.rows.filter((r) => !r.isTest);
  const tests = data.rows.filter((r) => r.isTest);
  const message = realRows[0]?.content ?? tests[0]?.content ?? "";
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return realRows
      .filter((r) => matchesRecipientFilter(r, filter))
      .filter(
        (r) =>
          !q ||
          r.name?.toLowerCase().includes(q) ||
          (digits.length >= 3 && r.phone.includes(digits)),
      );
  }, [realRows, filter, query]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        RECIPIENT_FILTERS.map((f) => [
          f.value,
          realRows.filter((r) => matchesRecipientFilter(r, f.value)).length,
        ]),
      ) as Record<RecipientFilter, number>,
    [realRows],
  );

  return (
    <div className="space-y-6">
      <Card className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-white">{c.name}</h2>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-white/60">
              {c.templateName} · envia todo dia das {minuteLabel(c.windowStart)} às{" "}
              {minuteLabel(c.windowEnd)} ({TIMEZONE_LABEL[c.timezone] ?? c.timezone})
              {c.scheduledAt && ` · início em ${formatDate(c.scheduledAt, c.timezone)}`}
            </p>
            {c.confirmedAt && (
              <p className="mt-1 text-xs text-white/50">
                Confirmado por {c.confirmedByLabel ?? "conta"} em{" "}
                {formatDate(c.confirmedAt, c.timezone)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.status === "queued" && (
              <Button
                variant="outline"
                disabled={save.saving}
                onClick={() => act(() => pauseBroadcast(c.id))}
              >
                Pausar
              </Button>
            )}
            {c.status === "paused" && (
              <Button disabled={save.saving} onClick={() => act(() => resumeBroadcast(c.id))}>
                Retomar
              </Button>
            )}
            <Button
              variant="ghost"
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  downloadBase64(
                    await exportBroadcast(c.id),
                    `disparo-${c.name.replace(/[^\w-]+/g, "-").slice(0, 40) || c.id}.csv`,
                    "text/csv;charset=utf-8",
                  );
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download size={16} aria-hidden />
              Exportar planilha
            </Button>
            {["queued", "paused"].includes(c.status) && (
              <ConfirmButton
                variant="destructive"
                disabled={save.saving}
                confirm={{
                  title: "Cancelar este disparo?",
                  description: `${c.pending} contatos que ainda não receberam ficam sem a mensagem. Quem já recebeu não é afetado. Não dá para desfazer.`,
                  confirmLabel: "Cancelar disparo",
                  cancelLabel: "Manter",
                  tone: "danger",
                }}
                onConfirm={() => act(() => cancelBroadcast(c.id))}
              >
                Cancelar disparo
              </ConfirmButton>
            )}
          </div>
        </div>

        {c.status === "paused" && c.error && <Alert tone="warn">{c.error}</Alert>}

        <CampaignStats c={c} />

        {message && (
          <details className="rounded-control border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-medium text-white">
              Mensagem enviada
            </summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-white/80">
              {message}
            </p>
            <p className="mt-2 text-xs text-white/50">
              Exemplo com os dados do primeiro contato.
            </p>
          </details>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="font-display text-lg font-semibold text-white">Contatos</h3>
          <div className="relative w-full lg:max-w-xs">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
              aria-hidden
            />
            <Input
              aria-label="Buscar contato por nome ou telefone"
              placeholder="Buscar por nome ou telefone"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <SegmentedControl
          label="Filtrar contatos por resultado"
          value={filter}
          className="flex-wrap"
          options={RECIPIENT_FILTERS.map((f) => ({
            value: f.value,
            label: `${f.label} ${counts[f.value]}`,
          }))}
          onSelect={setFilter}
        />
        <RecipientList
          rows={rows.map((r) => ({
            ...r,
            detail: r.variant === "nameless" ? "Recebeu a versão sem o nome" : undefined,
          }))}
          empty="Nenhum contato com este resultado."
        />
        {tests.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-white/70">
              Testes enviados ({tests.length})
            </summary>
            <div className="mt-3">
              <RecipientList rows={tests} />
            </div>
          </details>
        )}
        <details className="text-xs leading-relaxed text-white/55">
          <summary className="cursor-pointer text-sm text-white/70">Como contamos</summary>
          <p className="mt-2 max-w-prose">
            Respostas contam quando chegam em até 7 dias e são atribuídas ao
            último disparo anterior. Oportunidade é o contato que passou a quente
            ou agendado; agendamento é uma consulta nova encontrada ao processar
            a resposta. São registros do que aconteceu depois, não prova de que o
            disparo causou a conversão. A Meta nem sempre informa a leitura.
            Envio com resultado incerto (&quot;Conferir&quot;) nunca é repetido
            sozinho, para o contato não receber duas vezes. Testes não entram nos
            números.
          </p>
        </details>
      </Card>
    </div>
  );
}
