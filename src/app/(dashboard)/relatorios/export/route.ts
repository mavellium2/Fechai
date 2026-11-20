import { LEAD_STATUS } from "../../conversas/leadStatus";
import { requireTenant } from "@/lib/session";
import { computePeriodReport, resolveRange, type PeriodKey } from "@/modules/reports/service";

/**
 * Exporta o relatório atual como CSV (separador `;` + BOM, para abrir direto no
 * Excel brasileiro). Reusa `resolveRange` da página, então `?periodo=` e
 * `?de=&ate=` se comportam igual.
 */
export async function GET(request: Request) {
  const { tenantId } = await requireTenant();
  const url = new URL(request.url);
  const periodo = url.searchParams.get("periodo") ?? "30";
  const de = url.searchParams.get("de") ?? undefined;
  const ate = url.searchParams.get("ate") ?? undefined;
  const valid: PeriodKey[] = ["hoje", "7", "30", "mes", "ano", "tudo"];
  const key = (valid as string[]).includes(periodo) ? (periodo as PeriodKey) : "30";

  const range = resolveRange(key, de, ate);
  const r = await computePeriodReport(tenantId, range);
  const prev = r.kpis.prev;

  const cell = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = (label: string, value: number, previous: number | undefined): string[] => [
    `${cell(label)};${value};${previous === undefined ? "" : previous}`,
  ];

  const weekdayLabel = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const lines = [
    "indicador;valor;periodo_anterior",
    ...rows("Contatos que escreveram", r.kpis.conversations, prev?.conversations),
    ...rows("Contatos atendidos", r.kpis.attendedContacts, prev?.attendedContacts),
    ...rows("Leads novos", r.kpis.leads, prev?.leads),
    ...rows("Agendamentos criados", r.kpis.scheduled, prev?.scheduled),
    ...rows("Avaliações agendadas pelo agente", r.kpis.evaluations, prev?.evaluations),
    ...rows("Mensagens recebidas", r.kpis.inbound, prev?.inbound),
    ...rows("Mensagens enviadas", r.kpis.outbound, prev?.outbound),
    ...rows("Taxa de resposta (%)", Math.round(r.kpis.responseRate * 100), prev ? Math.round(prev.responseRate * 100) : undefined),
    ...rows("Leads quentes (agora)", r.kpis.hotLeads, undefined),
    ...rows("Precisam de você (agora)", r.kpis.needsHuman, undefined),
    ...rows("Resolução autônoma (%) - conversas iniciadas pelo paciente", Math.round(r.autonomyRate.current * 100), r.autonomyRate.previous !== null ? Math.round(r.autonomyRate.previous * 100) : undefined),
    ...rows("Iniciadas pelo paciente e respondidas (base da autonomia)", r.contexts.autonomy?.base ?? 0, undefined),
    ...rows("Iniciadas pelo paciente: só IA", r.contexts.autonomy?.aiOnly ?? 0, undefined),
    ...rows("Iniciadas pelo paciente: IA + humano", r.contexts.autonomy?.aiAndHuman ?? 0, undefined),
    ...rows("Iniciadas pelo paciente: só humano", r.contexts.autonomy?.humanOnly ?? 0, undefined),
    "",
    "contexto;contatos;atendidos;so_ia;ia_e_humano;so_humano;contatos_que_agendaram;avaliacoes;conversao_percentual",
    ...r.contexts.groups.filter((g) => g.contacts > 0).map((g) => `${cell(g.label)};${g.contacts};${g.attended};${g.aiOnly ?? ""};${g.aiAndHuman ?? ""};${g.humanOnly ?? ""};${g.scheduledContacts};${g.evaluations};${g.conversionPercent ?? ""}`),
    "Origem de aquisição;não registrada",
    "",
    "leads_novos_x_atendidos;contagem",
    `Leads novos;${r.leadReconciliation.newLeads}`,
    `Leads novos atendidos;${r.leadReconciliation.newAttended}`,
    `Leads novos que escreveram sem resposta;${r.leadReconciliation.unanswered}`,
    `Leads novos que só receberam mensagem nossa;${r.leadReconciliation.noReply}`,
    `Leads novos sem mensagem no período;${r.leadReconciliation.noMessages}`,
    `Contatos atendidos;${r.leadReconciliation.attended}`,
    `Atendidos com cadastro anterior ao período;${r.leadReconciliation.existingAttended}`,
    "",
    "bucket;recebidas;enviadas",
    ...r.flow.map((p) => `${cell(p.label)};${p.inbound};${p.outbound}`),
    "",
    "bucket;iniciadas_pelo_paciente_so_ia;ia_e_humano;so_humano",
    ...r.attendance.map((p) => `${cell(p.label)};${p.ai};${p.aiAndHuman};${p.humanOnly}`),
    "",
    "bucket;ia;humano",
    ...r.closed.map((p) => `${cell(p.label)};${p.ai};${p.human}`),
    "",
    "status;leads_novos",
    ...r.byStatus.map((s) => `${cell(LEAD_STATUS[s.status]?.label ?? s.status)};${s.count}`),
    "",
    "volume_no_periodo;contagem",
    ...r.funnel.map((f) => `${cell(f.name)};${f.count}`),
    "",
    "dia_da_semana;hora;mensagens",
    ...r.peakHours.filter((c) => c.count > 0).map((c) => `${cell(weekdayLabel[c.weekday])};${c.hour}h;${c.count}`),
    "",
    "faixa_de_resposta;ia;humano",
    ...r.firstResponseTime.map((b) => `${cell(b.label)};${b.ai};${b.human}`),
    "",
    "follow_up;valor",
    `${cell("Enviados")};${r.followUpRecovery.sent}`,
    `${cell("Com resposta depois")};${r.followUpRecovery.recovered}`,
    "",
    "bucket;compareceu;faltou;nao_verificado",
    ...r.attendanceOutcome.map((p) => `${cell(p.label)};${p.attended};${p.noShow};${p.unknown}`),
  ];

  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-${de ?? key}.csv"`,
    },
  });
}
