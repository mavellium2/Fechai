import { History } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { CampaignHistoryEntry } from "@/modules/campaigns/detail";
import { formatDateTime } from "@/modules/campaigns/period";

/** A trilha de auditoria da campanha: quem fez o quê e quando. */
export function HistoryTab({ history, timezone }: { history: CampaignHistoryEntry[]; timezone: string }) {
  return (
    <Card className="p-4 sm:p-6">
      <CardTitle hint="Criação, edição, ativação, pausa, encerramento, regras e vínculos, com quem fez e quando. Os valores de antes e depois ficam na auditoria da conta.">
        Histórico
      </CardTitle>
      {history.length ? (
        <ol className="space-y-3">
          {history.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/10 pb-3 last:border-0 panel:border-white/10">
              <span className="text-sm font-medium text-ink panel:text-white/90">{entry.label}</span>
              <span className="text-sm text-neutral panel:text-white/60">
                {formatDateTime(entry.createdAt, timezone)} · {entry.actor}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={History} title="Sem registros" description="As alterações desta campanha aparecem aqui." className="px-4 py-6" />
      )}
    </Card>
  );
}
