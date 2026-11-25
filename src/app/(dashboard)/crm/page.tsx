import type { Metadata } from "next";
import { ChartNoAxesColumn, Settings2, Timer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { dateTimeLabel } from "@/lib/format";
import { requireCrmAccess } from "@/modules/crm/access";
import { getCrmBoard } from "@/modules/crm/board";
import { crmBoardHref, validCrmId, type CrmSearchParams } from "@/modules/crm/board-filters";
import { crmBoardVersion } from "@/modules/crm/board-version";
import { CRM_REMINDER_LIMIT, getCrmLeadDetail, listCrmReminders, listCrmTags } from "@/modules/crm/lead-detail";
import { readCrmLossCatalog } from "@/modules/crm/loss-reasons";
import { countEscalatedWaits, readHandoffSla } from "@/modules/crm/handoff-sla";
import { crmDurationLabel } from "@/modules/crm/sla";
import { Alert } from "@/components/ui/alert";
import { CrmBoard } from "./CrmBoard";
import { CrmFilters } from "./CrmFilters";
import { CrmLeadDetail } from "./CrmLeadDetail";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPage({ searchParams }: { searchParams: Promise<CrmSearchParams> }) {
  const params = await searchParams;
  const tenantId = await requireCrmAccess();
  if (params.lead !== undefined && !validCrmId(params.lead)) notFound();
  if (params.antes !== undefined && (!params.lead || !validCrmId(params.antes))) notFound();
  const now = new Date();
  const version = params.lead ? "" : await crmBoardVersion(tenantId);
  const [board, reminders, detail, boardTags, lossCatalog, sla, escalated] = await Promise.all([
    getCrmBoard(params), listCrmReminders(tenantId, now),
    params.lead ? getCrmLeadDetail(params.lead, params.antes) : null,
    params.lead ? [] : listCrmTags(tenantId),
    readCrmLossCatalog(tenantId),
    readHandoffSla(tenantId),
    countEscalatedWaits(tenantId),
  ]);
  const { pipeline, filters, columns, users, observedAt } = board;

  return (
    <div className="w-full min-w-0 max-w-full space-y-5">
      <PageHeader eyebrow="funil comercial" title="CRM" description={pipeline.name}
        actions={<>
          <ButtonLink href="/crm/indicadores" variant="outline"><ChartNoAxesColumn size={16} aria-hidden />Indicadores do transbordo</ButtonLink>
          <ButtonLink href="/crm/transbordo" variant="outline"><Timer size={16} aria-hidden />Prazos do transbordo</ButtonLink>
          <ButtonLink href="/crm/etapas" variant="outline"><Settings2 size={16} aria-hidden />Configurar etapas</ButtonLink>
        </>}
      />
      {/* Escalonamento no painel (CRM-10): esperas que passaram do 2º prazo e seguem sem ninguém. */}
      {escalated > 0 && (
        <Alert tone="warn">
          {escalated === 1 ? "Um lead passou" : `${escalated} leads passaram`} de {crmDurationLabel(sla.escalateMinutes)} aguardando
          a equipe e {escalated === 1 ? "segue sem ninguém. Ele está" : "seguem sem ninguém. Eles estão"} na coluna Aguardando humano.
        </Alert>
      )}

      {reminders.length > 0 && (
        <Card className="space-y-2 p-3">
          <h2 className="font-display text-sm font-semibold">Tarefas para hoje e vencidas</h2>
          <ul className="space-y-1 text-sm">
            {reminders.slice(0, CRM_REMINDER_LIMIT).map(({ id, text, dueAt, lead }) => (
              <li key={id} className="[overflow-wrap:anywhere]">
                <Link className="hover:underline" prefetch={false} href={crmBoardHref(params, { lead: lead.id, antes: null })}>
                  {text} <span className="text-neutral panel:text-white/55">· {lead.name?.trim() || "Contato sem nome"} · <time dateTime={dueAt.toISOString()}>{dateTimeLabel(dueAt)}</time></span>
                </Link>
              </li>
            ))}
          </ul>
          {reminders.length > CRM_REMINDER_LIMIT && <p className="text-xs text-neutral panel:text-white/55">Mostrando as {CRM_REMINDER_LIMIT} tarefas com os prazos mais próximos.</p>}
        </Card>
      )}
      <CrmFilters key={[filters.stage, filters.assignee, filters.origin, filters.tag, filters.basis, filters.from, filters.to].join("|")} filters={filters} stages={pipeline.stages} tags={detail?.tags ?? boardTags} users={users} />
      {filters.invalidRange && <p role="alert" className="text-sm text-danger">A data inicial precisa ser anterior ou igual à final.</p>}
      {columns.length > 0 ? <CrmBoard columns={columns} stages={pipeline.stages} lossReasons={lossCatalog?.options ?? []} params={params} version={version} now={observedAt}
        sla={{ alertMinutes: sla.alertMinutes, escalateMinutes: sla.escalateMinutes }} /> : (
        <Card><EmptyState title="Nenhuma etapa para exibir" description="Escolha uma etapa ativa para consultar os leads." action={<ButtonLink href="/crm" variant="outline">Limpar filtros</ButtonLink>} /></Card>
      )}
      {detail && <CrmLeadDetail key={detail.id} lead={detail} params={params} now={now} />}
    </div>
  );
}
