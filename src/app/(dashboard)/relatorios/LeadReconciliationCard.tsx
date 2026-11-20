import type { LeadContactReconciliation } from "@/modules/reports/service";
import { formatCount } from "@/modules/reports/monthly-format";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";

/**
 * Por que "leads novos" e "contatos atendidos" não batem. Os dois lados fecham
 * pelos mesmos registros (`LeadContactReconciliation`); nada é calculado aqui.
 */
export function LeadReconciliationCard({ data }: { data: LeadContactReconciliation }) {
  return <Card>
    <CardTitle hint="Cadastros criados no período e contatos que escreveram e foram respondidos são bases diferentes. As duas colunas fecham pelos mesmos registros.">Leads novos × contatos atendidos</CardTitle>
    <div className="grid gap-6 lg:grid-cols-2">
      <DataTable caption="Composição dos leads novos" head={[`${formatCount(data.newLeads)} leads novos`, "Leads"]}
        rows={[
          { id: "attended", cells: ["Escreveram e foram atendidos", formatCount(data.newAttended)] },
          { id: "unanswered", cells: ["Escreveram e ficaram sem resposta", formatCount(data.unanswered)] },
          { id: "noReply", cells: ["Só receberam mensagem nossa (abordagem, lembrete, disparo)", formatCount(data.noReply)] },
          { id: "noMessages", cells: ["Sem mensagem no período (cadastro manual, importação)", formatCount(data.noMessages)] },
        ]} />
      <DataTable caption="Composição dos contatos atendidos" head={[`${formatCount(data.attended)} contatos atendidos`, "Contatos"]}
        rows={[
          { id: "new", cells: ["Leads novos do período", formatCount(data.newAttended)] },
          { id: "existing", cells: ["Cadastros anteriores que voltaram a falar", formatCount(data.existingAttended)] },
        ]} />
    </div>
    {data.byContext.length > 0 && <div className="mt-6">
      <DataTable caption="Leads novos por quem iniciou" head={["Leads novos por quem iniciou", "Leads", "Atendidos"]}
        rows={data.byContext.map((g) => ({ id: g.key, cells: [g.label, formatCount(g.leads), formatCount(g.attended)] }))} />
    </div>}
    <p className="mt-3 text-sm text-neutral panel:text-white/60">Um cadastro nasce quando o contato escreve, mas também quando a clínica aborda um número novo, quando um lembrete do Clinicorp sai para um paciente que ainda não conversou ou quando um disparo é enviado. Por isso leads novos não medem aquisição, e só quem escreveu e recebeu resposta entra em contatos atendidos.</p>
  </Card>;
}
