"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Send, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectMenu } from "@/components/ui/select-menu";
import { useSaveFeedback } from "@/components/ui/toast";
import { linkCampaignBroadcast, unlinkCampaignBroadcast } from "./setup-actions";

type Line = {
  id: string;
  name: string;
  status: string;
  confirmedAt: string | null;
  sent: number;
  delivered: number;
  read: number;
  replies: number;
  appointments: number;
  attended: number;
};
type Totals = { sent: number; delivered: number; read: number; replies: number; appointments: number; attended: number; stopped: number; blocked: number };

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const LINK =
  "wrap-anywhere rounded-control font-medium text-ink underline-offset-4 hover:underline panel:text-white " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris";

/**
 * Disparos da campanha. Um disparo pertence a no máximo uma campanha; quem
 * responde a um disparo vinculado entra na campanha (origem "disparo"). As
 * métricas são o funil de `/disparos`.
 */
export function CampaignBroadcastsPanel({
  campaignId,
  editable,
  metaEnabled,
  broadcasts,
  totals,
  available,
}: {
  campaignId: string;
  editable: boolean;
  metaEnabled: boolean;
  timezone: string;
  broadcasts: Line[];
  totals: Totals;
  available: { id: string; name: string; status: string; createdAt: string }[];
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "disparo", action: "update", gender: "m" });
  const [busy, setBusy] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const labelId = useId();

  async function run(key: string, task: () => ReturnType<typeof linkCampaignBroadcast>) {
    setBusy(key);
    try {
      const result = await save.run(task);
      if (result.ok) router.refresh();
      return result;
    } finally {
      setBusy(null);
    }
  }

  if (!metaEnabled && !broadcasts.length) {
    return (
      <Card className="p-4 sm:p-6">
        <CardTitle>Disparos</CardTitle>
        <EmptyState
          icon={Send}
          title="Disparos usam a API oficial da Meta"
          description="Quando a conta tiver a Meta liberada, os disparos da campanha aparecem aqui."
          className="px-4 py-6"
        />
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6">
      <CardTitle
        hint="Quem responde a um disparo vinculado entra na campanha. Um disparo pertence a no máximo uma campanha."
        action={
          editable && metaEnabled ? (
            <ButtonLink href={`/disparos/novo?campanha=${campaignId}`} size="sm" className="max-sm:h-11">
              <Plus size={16} aria-hidden />
              Novo disparo para esta campanha
            </ButtonLink>
          ) : undefined
        }
      >
        Disparos
      </CardTitle>

      {broadcasts.length ? (
        <>
          <DataTable
            caption="Disparos vinculados"
            head={["Disparo", "Situação", "Enviados", "Entregues", "Lidos", "Responderam", "Agendaram", ""]}
            rows={[
              ...broadcasts.map((b) => ({
                id: b.id,
                cells: [
                  <Link key="nome" href={`/disparos/${b.id}`} className={LINK}>
                    {b.name}
                  </Link>,
                  STATUS_LABEL[b.status] ?? b.status,
                  String(b.sent),
                  String(b.delivered),
                  String(b.read),
                  String(b.replies),
                  String(b.appointments),
                  editable ? (
                    <Button
                      key="remover"
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="max-sm:h-11"
                      aria-label={`Desvincular ${b.name}`}
                      loading={busy === b.id}
                      loadingLabel="Desvinculando"
                      disabled={save.saving}
                      onClick={() => void run(b.id, () => unlinkCampaignBroadcast(campaignId, b.id))}
                    >
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  ) : (
                    ""
                  ),
                ],
              })),
              {
                id: "total",
                cells: [
                  "Total",
                  "",
                  String(totals.sent),
                  String(totals.delivered),
                  String(totals.read),
                  String(totals.replies),
                  String(totals.appointments),
                  "",
                ],
              },
            ]}
          />
          <p className="mt-3 text-sm text-neutral panel:text-white/60">
            Pediram para parar: {totals.stopped} · Bloqueados: {totals.blocked} · Compareceram: {totals.attended}
          </p>
        </>
      ) : (
        <EmptyState
          icon={Send}
          title="Nenhum disparo vinculado"
          description="Vincule um disparo existente ou crie um novo já ligado a esta campanha."
          className="px-4 py-6"
        />
      )}

      {editable && metaEnabled && (
        <div className="mt-6 space-y-3 border-t border-ink/10 pt-6 panel:border-white/10">
          <p id={labelId} className="text-sm font-medium text-ink panel:text-white/90">
            Vincular disparo existente
          </p>
          {available.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <SelectMenu
                label="Disparo"
                labelledBy={labelId}
                value={choice}
                onChange={setChoice}
                placeholder="Escolha um disparo"
                options={[
                  { value: "", label: "Escolha um disparo" },
                  ...available.map((b) => ({ value: b.id, label: `${b.name} (${STATUS_LABEL[b.status] ?? b.status})` })),
                ]}
              />
              <Button
                type="button"
                variant="outline"
                className="max-sm:h-11"
                disabled={!choice || save.saving}
                loading={busy === "link"}
                loadingLabel="Vinculando"
                onClick={async () => {
                  const result = await run("link", () => linkCampaignBroadcast(campaignId, choice));
                  if (result.ok) setChoice("");
                }}
              >
                Vincular
              </Button>
            </div>
          ) : (
            <p className="text-sm text-neutral panel:text-white/60">Todos os disparos da conta já pertencem a uma campanha.</p>
          )}
        </div>
      )}
    </Card>
  );
}
