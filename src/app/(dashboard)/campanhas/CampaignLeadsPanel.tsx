"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useSaveFeedback } from "@/components/ui/toast";
import { addLeadToCampaign, removeLeadFromCampaign, searchLeadsForCampaign } from "./setup-actions";

type Lead = {
  leadId: string;
  name: string | null;
  phone: string;
  source: "anuncio" | "disparo" | "palavra_chave" | "manual";
  assignedAt: string;
  stage: "new" | "talking" | "qualified" | "scheduled" | "attended";
  outcome: "scheduled" | "handoff" | "lost" | "open";
  conversationId: string | null;
  appointment: { startsAt: string; canceled: boolean; attendance: string } | null;
};

const SOURCE: Record<Lead["source"], string> = { anuncio: "Anúncio", disparo: "Disparo", palavra_chave: "Palavra-chave", manual: "Manual" };
const STAGE: Record<Lead["stage"], string> = {
  new: "Novo",
  talking: "Em conversa",
  qualified: "Qualificado",
  scheduled: "Agendado",
  attended: "Compareceu",
};
const OUTCOME: Partial<Record<Lead["outcome"], { label: string; tone: "warn" | "danger" }>> = {
  handoff: { label: "Com a equipe", tone: "warn" },
  lost: { label: "Perdido", tone: "danger" },
};

const LINK =
  "rounded-control text-sm font-medium text-iris underline-offset-4 hover:underline " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris";

function phoneLabel(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return phone;
}

/**
 * Leads da campanha. A conversa (`/conversas?id=`) é também o card do CRM do
 * lead — é lá que ficam etapa, notas e o botão de assumir. Adicionar à mão
 * busca na base de contatos da conta.
 */
export function CampaignLeadsPanel({
  campaignId,
  canAdd,
  canRemove,
  timezone,
  leads,
}: {
  campaignId: string;
  canAdd: boolean;
  canRemove: boolean;
  timezone: string;
  leads: Lead[];
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "lead", action: "update", gender: "m" });
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; phone: string; inCampaign: boolean }[]>([]);
  const [searching, setSearching] = useState(false);
  const searchId = useId();

  const when = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  // Busca curta demais não mostra resultado (sem apagar o estado num efeito).
  const searchable = canAdd && query.trim().length >= 2;
  const shown = searchable ? found : [];

  useEffect(() => {
    if (!searchable) return;
    let live = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchLeadsForCampaign(campaignId, query).catch(() => null);
      if (live) {
        setFound(result?.ok ? result.leads : []);
        setSearching(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, campaignId, searchable]);

  async function run(key: string, task: () => ReturnType<typeof addLeadToCampaign>) {
    setBusy(key);
    try {
      const result = await save.run(task);
      if (result.ok) router.refresh();
      return result;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <CardTitle hint="Entram sozinhos pelos anúncios e disparos vinculados e pelas palavras-chave, ou à mão. As regras do agente valem para eles enquanto a campanha vale.">
        Leads ({leads.length})
      </CardTitle>

      {canAdd && (
        <div className="mb-6 space-y-2">
          <label htmlFor={searchId} className="text-sm font-medium text-ink panel:text-white/90">
            Adicionar contato à campanha
          </label>
          <div className="relative">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral panel:text-white/55" />
            <Input
              id={searchId}
              className="pl-8 max-sm:h-11"
              placeholder="Nome ou telefone"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {searching && <p className="text-sm text-neutral panel:text-white/60">Buscando…</p>}
          {!searching && searchable && !shown.length && (
            <p className="text-sm text-neutral panel:text-white/60">Nenhum contato encontrado.</p>
          )}
          {shown.length > 0 && (
            <ul className="divide-y divide-ink/10 rounded-control border border-ink/10 panel:divide-white/10 panel:border-white/15">
              {shown.map((lead) => (
                <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="min-w-0 text-sm text-ink panel:text-white/90">
                    {lead.name} {lead.phone && <span className="text-neutral panel:text-white/60">· {phoneLabel(lead.phone)}</span>}
                  </span>
                  {lead.inCampaign ? (
                    <Badge tone="neutral">Já está</Badge>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="max-sm:h-11"
                      loading={busy === lead.id}
                      loadingLabel="Adicionando"
                      disabled={save.saving}
                      onClick={async () => {
                        const result = await run(lead.id, () => addLeadToCampaign(campaignId, lead.id));
                        if (result.ok) setFound((list) => list.map((l) => (l.id === lead.id ? { ...l, inCampaign: true } : l)));
                      }}
                    >
                      <Plus size={16} aria-hidden />
                      Adicionar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {leads.length ? (
        <DataTable
          caption="Leads da campanha"
          head={["Lead", "Etapa", "Origem", "Agendamento", "Entrou em", ""]}
          columnAlign={["left", "left", "left", "left", "left", "right"]}
          headerAlign="left"
          rows={leads.map((lead) => {
            const outcome = OUTCOME[lead.outcome];
            return {
              id: lead.leadId,
              cells: [
                <span key="lead" className="block min-w-0">
                  <span className="wrap-anywhere">{lead.name ?? "Sem nome"}</span>
                  {lead.phone && <span className="block text-sm font-normal text-neutral panel:text-white/60">{phoneLabel(lead.phone)}</span>}
                </span>,
                <span key="etapa" className="flex flex-wrap gap-1">
                  <Badge tone={lead.stage === "attended" ? "success" : lead.stage === "scheduled" ? "iris" : "neutral"}>{STAGE[lead.stage]}</Badge>
                  {outcome && <Badge tone={outcome.tone}>{outcome.label}</Badge>}
                </span>,
                SOURCE[lead.source],
                lead.appointment ? (
                  <span key="agenda" className="whitespace-nowrap">
                    {when(lead.appointment.startsAt)}
                    {lead.appointment.canceled ? " (cancelada)" : ""}
                  </span>
                ) : (
                  "—"
                ),
                <span key="entrou" className="whitespace-nowrap">
                  {when(lead.assignedAt)}
                </span>,
                <span key="acoes" className="flex flex-wrap items-center justify-end gap-2">
                  {lead.conversationId && (
                    <Link href={`/conversas?status=all&id=${lead.conversationId}`} className={LINK}>
                      Conversa e card
                    </Link>
                  )}
                  {canRemove && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="max-sm:h-11"
                      aria-label={`Tirar ${lead.name ?? "contato"} da campanha`}
                      loading={busy === `rm-${lead.leadId}`}
                      loadingLabel="Tirando"
                      disabled={save.saving}
                      onClick={() => void run(`rm-${lead.leadId}`, () => removeLeadFromCampaign(campaignId, lead.leadId))}
                    >
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  )}
                </span>,
              ],
            };
          })}
        />
      ) : (
        <EmptyState icon={Users} title="Nenhum lead na campanha" description="Vincule anúncios ou disparos, configure palavras-chave ou adicione à mão." className="px-4 py-6" />
      )}
    </Card>
  );
}
